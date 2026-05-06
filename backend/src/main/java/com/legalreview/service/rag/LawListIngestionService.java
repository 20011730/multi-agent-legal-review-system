package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.domain.LawList;
import com.legalreview.dto.rag.LawListImportRow;
import com.legalreview.repository.LawListRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 법령 목록(law_list) 메타데이터 적재 서비스.
 *
 * 지원 입력 형식:
 *   1) classpath 시드 JSON       — {@link #ingestLawListSeed()}
 *   2) JSON 배열 InputStream     — {@link #ingestJson(InputStream)}
 *   3) CSV InputStream           — {@link #ingestCsv(InputStream)}
 *   4) 임의의 row 리스트         — {@link #ingestRows(List)}
 *
 * Excel(.xlsx/.xls)은 현재 backend에 Apache POI 의존성이 없으므로 미지원.
 *  → 사용자가 CSV로 변환 후 ingestCsv 사용 권장 (RagDevController 응답에서 안내).
 *
 * API 응답은 외부 시스템에 따라 필드명이 다를 수 있으므로, 별도 adapter에서
 * {@link LawListImportRow}로 매핑한 뒤 {@link #ingestRows(List)}를 호출하는 방식 권장.
 *
 * 멱등성: lawMst(PK) 기준 upsert. 같은 데이터 재실행 시 row 폭증 없음.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LawListIngestionService {

    private final LawListRepository lawListRepository;
    private final LawListImportMapper mapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String SEED_PATH = "rag-seed/law-list.json";

    // ─────────────────────── 1. classpath 시드 ───────────────────────

    /**
     * classpath의 law-list.json을 읽어 PostgreSQL에 upsert.
     * @return 저장된 row 수
     */
    @Transactional
    public int ingestLawListSeed() {
        try (InputStream is = new ClassPathResource(SEED_PATH).getInputStream()) {
            return ingestJson(is);
        } catch (Exception e) {
            log.error("[LAW-LIST-INGEST] 시드 로드 실패: {}", e.getMessage());
            return 0;
        }
    }

    // ─────────────────────── 2. JSON 입력 ───────────────────────

    /**
     * JSON 배열 (LawListImportRow 목록 구조)을 읽고 upsert.
     * @return 저장된 row 수
     */
    @Transactional
    public int ingestJson(InputStream inputStream) {
        try {
            List<LawListImportRow> rows = objectMapper.readValue(
                    inputStream,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, LawListImportRow.class)
            );
            return ingestRows(rows);
        } catch (Exception e) {
            log.error("[LAW-LIST-INGEST] JSON 파싱 실패: {}", e.getMessage());
            return 0;
        }
    }

    // ─────────────────────── 3. CSV 입력 ───────────────────────

    /**
     * CSV(헤더 포함) InputStream을 읽고 upsert.
     * 헤더는 snake_case 또는 camelCase 모두 지원 (예: law_mst / lawMst).
     * 한국어 본문에 콤마/큰따옴표가 들어갈 수 있으므로 RFC 4180 quoted field 처리.
     */
    @Transactional
    public int ingestCsv(InputStream inputStream) {
        List<LawListImportRow> rows = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            // 헤더 라인 (하나의 논리적 레코드)
            List<String> header = readCsvRecord(br);
            if (header == null || header.isEmpty()) {
                log.warn("[LAW-LIST-INGEST] CSV 헤더가 비어 있음");
                return 0;
            }
            Map<String, Integer> idx = buildHeaderIndex(header);

            // 데이터 라인
            List<String> record;
            while ((record = readCsvRecord(br)) != null) {
                if (record.isEmpty() || (record.size() == 1 && record.get(0).isEmpty())) continue;
                rows.add(toRow(record, idx));
            }
        } catch (Exception e) {
            log.error("[LAW-LIST-INGEST] CSV 파싱 실패: {}", e.getMessage());
            return 0;
        }
        return ingestRows(rows);
    }

    // ─────────────────────── 4. 공통 row → DB ───────────────────────

    /**
     * row 리스트를 upsert.
     * 필수 필드 누락(lawMst/lawId/lawNameKr) 시 skip + 카운트.
     * @return 저장된(신규+갱신) row 수
     */
    @Transactional
    public int ingestRows(List<LawListImportRow> rows) {
        if (rows == null || rows.isEmpty()) {
            log.warn("[LAW-LIST-INGEST] 입력 row가 비어 있음");
            return 0;
        }

        int saved = 0;
        int skipped = 0;
        List<String> skipReasons = new ArrayList<>();

        for (int i = 0; i < rows.size(); i++) {
            LawListImportRow row = rows.get(i);
            String validationError = mapper.validate(row);
            if (validationError != null) {
                skipped++;
                if (skipReasons.size() < 10) {
                    skipReasons.add(String.format("row#%d: %s", i + 1, validationError));
                }
                continue;
            }
            try {
                LawList existing = lawListRepository.findById(row.getLawMst()).orElse(null);
                LawList entity = mapper.apply(row, existing);
                lawListRepository.save(entity);
                saved++;
            } catch (Exception e) {
                skipped++;
                if (skipReasons.size() < 10) {
                    skipReasons.add(String.format("row#%d (lawMst=%s): save failed — %s",
                            i + 1, row.getLawMst(), e.getMessage()));
                }
            }
        }

        log.info("[LAW-LIST-INGEST] 완료 — saved={}, skipped={}, total={}",
                saved, skipped, rows.size());
        if (!skipReasons.isEmpty()) {
            log.warn("[LAW-LIST-INGEST] skip 사유 (최대 10건): {}", skipReasons);
        }
        return saved;
    }

    // ─────────────────────── CSV 헬퍼 ───────────────────────

    /**
     * 헤더 컬럼명 → row index 매핑.
     * snake_case / camelCase 둘 다 같은 표준 키로 정규화.
     * 알 수 없는 헤더는 무시.
     */
    private static Map<String, Integer> buildHeaderIndex(List<String> header) {
        Map<String, Integer> map = new LinkedHashMap<>();
        for (int i = 0; i < header.size(); i++) {
            String key = canonicalHeader(header.get(i));
            if (key != null) map.put(key, i);
        }
        return map;
    }

    /** snake_case 또는 camelCase 헤더를 표준 키(camelCase 비슷)로 변환. */
    private static String canonicalHeader(String raw) {
        if (raw == null) return null;
        String h = raw.trim();
        if (h.isEmpty()) return null;
        // BOM 제거
        if (h.charAt(0) == '﻿') h = h.substring(1);
        switch (h.toLowerCase()) {
            case "law_mst":            case "lawmst":             return "lawMst";
            case "law_id":             case "lawid":              return "lawId";
            case "current_history_code": case "currenthistorycode": return "currentHistoryCode";
            case "law_name_kr":        case "lawnamekr":          return "lawNameKr";
            case "law_name_short":     case "lawnameshort":       return "lawNameShort";
            case "law_type_name":      case "lawtypename":        return "lawTypeName";
            case "dept_name":          case "deptname":           return "deptName";
            case "dept_code":          case "deptcode":           return "deptCode";
            case "promulgate_date":    case "promulgatedate":     return "promulgateDate";
            case "enforce_date":       case "enforcedate":        return "enforceDate";
            case "promulgate_no":      case "promulgateno":       return "promulgateNo";
            case "amend_type":         case "amendtype":          return "amendType";
            case "detail_link":        case "detaillink":         return "detailLink";
            case "self_other_law":     case "selfotherlaw":       return "selfOtherLaw";
            case "joint_dept_info":    case "jointdeptinfo":      return "jointDeptInfo";
            case "joint_promulgate_no":case "jointpromulgateno":  return "jointPromulgateNo";
            default: return null;
        }
    }

    private static LawListImportRow toRow(List<String> record, Map<String, Integer> idx) {
        LawListImportRow r = new LawListImportRow();
        r.setLawMst(parseInt(get(record, idx, "lawMst")));
        r.setLawId(get(record, idx, "lawId"));
        r.setCurrentHistoryCode(get(record, idx, "currentHistoryCode"));
        r.setLawNameKr(get(record, idx, "lawNameKr"));
        r.setLawNameShort(get(record, idx, "lawNameShort"));
        r.setLawTypeName(get(record, idx, "lawTypeName"));
        r.setDeptName(get(record, idx, "deptName"));
        r.setDeptCode(get(record, idx, "deptCode"));
        r.setPromulgateDate(get(record, idx, "promulgateDate"));
        r.setEnforceDate(get(record, idx, "enforceDate"));
        r.setPromulgateNo(get(record, idx, "promulgateNo"));
        r.setAmendType(get(record, idx, "amendType"));
        r.setDetailLink(get(record, idx, "detailLink"));
        r.setSelfOtherLaw(get(record, idx, "selfOtherLaw"));
        r.setJointDeptInfo(get(record, idx, "jointDeptInfo"));
        r.setJointPromulgateNo(get(record, idx, "jointPromulgateNo"));
        return r;
    }

    private static String get(List<String> record, Map<String, Integer> idx, String key) {
        Integer i = idx.get(key);
        if (i == null || i >= record.size()) return null;
        String v = record.get(i);
        return v == null ? null : v;
    }

    private static Integer parseInt(String v) {
        if (v == null) return null;
        String t = v.trim();
        if (t.isEmpty()) return null;
        try { return Integer.parseInt(t); } catch (NumberFormatException e) { return null; }
    }

    /**
     * RFC 4180 minimal CSV record reader.
     * - 큰따옴표 quoted field 지원 (필드 내 콤마/줄바꿈/이중따옴표 escape "" )
     * - quoted 안에서 \r\n, \n 모두 line break로 처리
     * - 한 record가 여러 line에 걸칠 수 있음 (quoted multi-line)
     * @return 한 논리적 record의 필드 리스트. EOF면 null.
     */
    private static List<String> readCsvRecord(BufferedReader br) throws Exception {
        StringBuilder field = new StringBuilder();
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        int c;
        boolean readAny = false;

        while ((c = br.read()) != -1) {
            readAny = true;
            char ch = (char) c;
            if (inQuotes) {
                if (ch == '"') {
                    int next = br.read();
                    if (next == '"') {
                        field.append('"'); // escaped double quote
                    } else {
                        inQuotes = false;
                        if (next == -1) break;
                        if (next == ',') {
                            fields.add(field.toString());
                            field.setLength(0);
                        } else if (next == '\r') {
                            int peek = br.read();
                            if (peek != '\n' && peek != -1) {
                                // 단독 \r — 다음 문자를 다시 처리해야 하나, 단순화 위해 무시
                            }
                            fields.add(field.toString());
                            field.setLength(0);
                            return fields;
                        } else if (next == '\n') {
                            fields.add(field.toString());
                            field.setLength(0);
                            return fields;
                        } else {
                            field.append((char) next);
                        }
                    }
                } else {
                    field.append(ch);
                }
            } else {
                if (ch == '"' && field.length() == 0) {
                    inQuotes = true;
                } else if (ch == ',') {
                    fields.add(field.toString());
                    field.setLength(0);
                } else if (ch == '\r') {
                    int peek = br.read();
                    if (peek != '\n' && peek != -1) {
                        // 단독 \r — 단순화 위해 record 종료로 처리
                    }
                    fields.add(field.toString());
                    return fields;
                } else if (ch == '\n') {
                    fields.add(field.toString());
                    return fields;
                } else {
                    field.append(ch);
                }
            }
        }
        if (!readAny) return null;
        // 파일이 개행 없이 끝난 경우
        fields.add(field.toString());
        return fields;
    }

    // ─────────────────────── 호환성 (참고: 단건 upsert 헬퍼) ───────────────────────

    /** 직접 LawList 인스턴스로 upsert (외부 코드 호환용). */
    Optional<LawList> findById(Integer lawMst) {
        return lawListRepository.findById(lawMst);
    }
}
