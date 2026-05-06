package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.config.LawApiProperties;
import com.legalreview.domain.LawList;
import com.legalreview.dto.rag.LawListApiIngestionResult;
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
import java.util.Iterator;
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
    private final LawListApiClient lawListApiClient;
    private final LawApiProperties lawApiProperties;
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

    // ─────────────────────── 5. 법령 목록 API 적재 ───────────────────────

    /**
     * 국가법령정보센터 법령 목록 API에서 페이지 단위로 데이터를 받아 law_list에 적재.
     *
     * 안전장치:
     *  - {@code maxPages <= 0}이면 LawApiProperties의 maxPages 사용 (기본 1)
     *  - {@code display}는 1~100 범위로 clamp
     *  - LAW_API_OC 미설정 시 즉시 에러 결과 반환 (실제 호출 안 함)
     *  - 페이지 사이 requestDelayMs sleep
     *
     * @return API 호출 통계 (totalCnt / pagesProcessed / savedCount / completedAll 등)
     */
    public LawListApiIngestionResult ingestLawListFromApi(int maxPagesArg, int displayArg) {
        if (!lawApiProperties.isConfigured()) {
            log.error("[LAW-LIST-API] LAW_API_OC 미설정 — 호출 중단");
            return LawListApiIngestionResult.builder()
                    .totalCnt(-1).pagesProcessed(0).savedCount(0)
                    .display(displayArg).completedAll(false)
                    .skippedRows(0).failedPages(List.of())
                    .build();
        }

        int display = clampDisplay(displayArg <= 0 ? lawApiProperties.getDefaultDisplay() : displayArg);
        int maxPages = (maxPagesArg <= 0) ? lawApiProperties.getMaxPages() : maxPagesArg;
        int delayMs = Math.max(0, lawApiProperties.getRequestDelayMs());

        int totalCnt = -1;
        int pagesProcessed = 0;
        int savedTotal = 0;
        int skippedTotal = 0;
        List<Integer> failedPages = new ArrayList<>();

        for (int page = 1; page <= maxPages; page++) {
            JsonNode body = lawListApiClient.fetchLawListPage(page, display);
            if (body == null) {
                log.warn("[LAW-LIST-API] page {} 응답 실패 — 다음 페이지로", page);
                failedPages.add(page);
                sleepQuiet(delayMs);
                continue;
            }

            // 첫 페이지에서 totalCnt 추출
            if (totalCnt < 0) {
                totalCnt = extractTotalCnt(body);
                log.info("[LAW-LIST-API] 시작 — totalCnt={}, display={}, maxPages={}",
                        totalCnt, display, maxPages);
            }

            List<JsonNode> lawNodes = extractLawNodes(body);
            if (lawNodes.isEmpty()) {
                log.info("[LAW-LIST-API] page {} — 결과 없음 (남은 페이지 종료)", page);
                pagesProcessed++;
                break;
            }

            List<LawListImportRow> rows = new ArrayList<>(lawNodes.size());
            for (JsonNode node : lawNodes) {
                LawListImportRow row = toRowFromApi(node);
                if (row != null) rows.add(row);
            }

            int beforeSkip = rows.size();
            int saved = ingestRows(rows);
            // ingestRows 내부에서 필수필드 누락 row를 skip — 그 차이를 skippedTotal에 누적
            skippedTotal += Math.max(0, beforeSkip - saved);
            savedTotal += saved;
            pagesProcessed++;

            log.info("[LAW-LIST-API] page {} — fetched={}, saved={} (누적 saved={})",
                    page, lawNodes.size(), saved, savedTotal);

            // 다음 페이지가 의미 없을 때 조기 종료
            if (totalCnt > 0 && page * display >= totalCnt) {
                log.info("[LAW-LIST-API] totalCnt 도달 — 조기 종료 (page={}, page*display={}, totalCnt={})",
                        page, page * display, totalCnt);
                break;
            }
            sleepQuiet(delayMs);
        }

        boolean completedAll = (totalCnt > 0) && (pagesProcessed * display >= totalCnt);
        return LawListApiIngestionResult.builder()
                .totalCnt(totalCnt)
                .pagesProcessed(pagesProcessed)
                .savedCount(savedTotal)
                .display(display)
                .completedAll(completedAll)
                .skippedRows(skippedTotal)
                .failedPages(failedPages)
                .build();
    }

    private static int clampDisplay(int v) {
        if (v < 1) return 1;
        if (v > 100) return 100;
        return v;
    }

    private static void sleepQuiet(int ms) {
        if (ms <= 0) return;
        try { Thread.sleep(ms); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
    }

    /**
     * 응답에서 totalCnt 추출.
     * 법제처 API 응답 구조 *(추정)*: {"LawSearch": {"totalCnt": "...", "law": [...]}}
     * - totalCnt가 다른 위치/대소문자/타입(string|number)으로 올 수 있어 모든 후보 탐색.
     */
    private static int extractTotalCnt(JsonNode body) {
        for (String key : new String[]{"totalCnt", "TotalCnt", "totalCount"}) {
            JsonNode n = findFirstByKey(body, key);
            if (n != null && !n.isNull()) {
                try {
                    return Integer.parseInt(n.asText().trim());
                } catch (NumberFormatException ignored) { /* try next */ }
            }
        }
        return -1;
    }

    /**
     * 응답 본문에서 법령 row 노드 목록 추출.
     * 응답은 {"LawSearch":{"law":[...]}} 형태로 추정.
     */
    private static List<JsonNode> extractLawNodes(JsonNode body) {
        // 1순위: LawSearch.law (배열)
        JsonNode lawNode = body.has("LawSearch") ? body.get("LawSearch").get("law") : null;
        // 2순위: 최상위 law
        if (lawNode == null || lawNode.isNull()) lawNode = body.get("law");
        // 3순위: 키 트리에서 첫 "law" 찾기
        if (lawNode == null || lawNode.isNull()) lawNode = findFirstByKey(body, "law");

        if (lawNode == null || lawNode.isNull()) return List.of();

        List<JsonNode> out = new ArrayList<>();
        if (lawNode.isArray()) {
            for (JsonNode it : lawNode) out.add(it);
        } else if (lawNode.isObject()) {
            // display=1 등으로 단일 객체일 수 있음
            out.add(lawNode);
        }
        return out;
    }

    /** Jackson 노드 트리에서 처음 만나는 key의 값을 반환 (DFS). */
    private static JsonNode findFirstByKey(JsonNode root, String key) {
        if (root == null) return null;
        if (root.isObject()) {
            JsonNode hit = root.get(key);
            if (hit != null) return hit;
            Iterator<String> it = root.fieldNames();
            while (it.hasNext()) {
                JsonNode child = findFirstByKey(root.get(it.next()), key);
                if (child != null) return child;
            }
        } else if (root.isArray()) {
            for (JsonNode it : root) {
                JsonNode hit = findFirstByKey(it, key);
                if (hit != null) return hit;
            }
        }
        return null;
    }

    /**
     * 법제처 API JSON 한 row → LawListImportRow.
     * 한글 필드명이 표준이며, 누락된 필드는 null.
     *
     * lawId 정책 *(추정)*:
     *  - 응답에서 "법령ID"가 숫자 문자열로 올 경우 그대로 사용
     *  - 만약 6자리 미만이고 모두 숫자면 zero-padding(예: "1546" → "011546") 적용
     *  - 6자리 이상 또는 비숫자면 그대로 보존
     */
    private static LawListImportRow toRowFromApi(JsonNode node) {
        if (node == null) return null;
        LawListImportRow r = new LawListImportRow();
        r.setLawMst(parseInteger(text(node, "법령일련번호")));
        r.setLawId(normalizeLawId(text(node, "법령ID")));
        r.setCurrentHistoryCode(text(node, "현행연혁코드"));
        r.setLawNameKr(text(node, "법령명한글"));
        r.setLawNameShort(text(node, "법령약칭명"));
        r.setLawTypeName(text(node, "법령구분명"));
        r.setDeptName(text(node, "소관부처명"));
        r.setDeptCode(text(node, "소관부처코드"));
        r.setPromulgateDate(text(node, "공포일자"));
        r.setEnforceDate(text(node, "시행일자"));
        r.setPromulgateNo(text(node, "공포번호"));
        r.setAmendType(text(node, "제개정구분명"));
        r.setDetailLink(text(node, "법령상세링크"));
        r.setSelfOtherLaw(text(node, "자법타법여부"));
        r.setJointDeptInfo(text(node, "공동부령정보"));
        // 공동부령 공포번호: 응답 키가 가변일 수 있어 후보 탐색
        String joint = text(node, "공동부령공포번호");
        if (joint == null) joint = text(node, "공동부령번호");
        r.setJointPromulgateNo(joint);
        return r;
    }

    private static String text(JsonNode node, String key) {
        if (node == null || !node.has(key)) return null;
        JsonNode v = node.get(key);
        if (v == null || v.isNull()) return null;
        String s = v.asText();
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static Integer parseInteger(String v) {
        if (v == null) return null;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return null; }
    }

    /** lawId zero-padding 정책 — 정수형 응답이 들어와도 6자리 보존. */
    private static String normalizeLawId(String v) {
        if (v == null) return null;
        String t = v.trim();
        if (t.isEmpty()) return null;
        if (t.matches("\\d{1,5}")) return String.format("%06d", Integer.parseInt(t));
        return t;
    }

    // ─────────────────────── 호환성 (참고: 단건 upsert 헬퍼) ───────────────────────

    /** 직접 LawList 인스턴스로 upsert (외부 코드 호환용). */
    Optional<LawList> findById(Integer lawMst) {
        return lawListRepository.findById(lawMst);
    }
}
