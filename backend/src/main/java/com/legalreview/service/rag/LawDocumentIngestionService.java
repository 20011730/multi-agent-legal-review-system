package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.config.LawApiProperties;
import com.legalreview.domain.LawDocument;
import com.legalreview.domain.LawList;
import com.legalreview.dto.rag.LawDocumentBatchIngestionResult;
import com.legalreview.dto.rag.LawDocumentIngestionResult;
import com.legalreview.repository.LawDocumentRepository;
import com.legalreview.repository.LawListRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 법령 본문 적재 서비스.
 *
 * 흐름:
 *   1) law_list에서 대상 법령 메타 조회 (lawMst / lawId / keyword / recommended)
 *   2) {@link LawListApiClient}로 본문 API 호출 (JSON)
 *   3) 응답에서 법령명/조문 본문 추출 → 사람이 읽을 수 있는 rawContent 구성
 *   4) {@link LawDocument} 엔티티에 referenceId(=lawMst 문자열) 기준 upsert
 *
 * 안전장치:
 *   - keyword limit 기본 5, 최대 30
 *   - recommended 최대 20개
 *   - 한 건 실패해도 batch 전체는 계속 진행
 *   - 페이지/항목 사이 requestDelayMs sleep
 *
 * Chroma 적재는 본 서비스의 책임이 아님 (다음 단계: LegalChunker → ChromaSearchService).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LawDocumentIngestionService {

    private final LawListRepository lawListRepository;
    private final LawDocumentRepository lawDocumentRepository;
    private final LawListApiClient lawListApiClient;
    private final LawApiProperties lawApiProperties;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public static final int KEYWORD_LIMIT_DEFAULT = 5;
    public static final int KEYWORD_LIMIT_MAX = 30;
    public static final int RECOMMENDED_MAX = 20;

    /** recommended endpoint에서 사용할 추천 법령 키워드 목록 (정확명칭 우선, 부분일치 fallback). */
    private static final List<String> RECOMMENDED_LAW_NAMES = List.of(
            "표시ㆍ광고의 공정화에 관한 법률",
            "표시ㆍ광고의 공정화에 관한 법률 시행령",
            "전자상거래 등에서의 소비자보호에 관한 법률",
            "전자상거래 등에서의 소비자보호에 관한 법률 시행령",
            "개인정보 보호법",
            "개인정보 보호법 시행령",
            "약관의 규제에 관한 법률",
            "약관의 규제에 관한 법률 시행령",
            "소비자기본법",
            "소비자기본법 시행령",
            "식품 등의 표시ㆍ광고에 관한 법률",
            "식품 등의 표시ㆍ광고에 관한 법률 시행령",
            "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
            "저작권법",
            "부정경쟁방지 및 영업비밀보호에 관한 법률"
    );

    // ─────────────────────── 단건 ───────────────────────

    /**
     * lawMst 기준 단건 본문 수집.
     */
    @Transactional
    public LawDocumentIngestionResult ingestByLawMst(Integer lawMst) {
        if (lawMst == null) {
            return failResult(null, null, null, "lawMst is null");
        }
        LawList meta = lawListRepository.findById(lawMst).orElse(null);
        return ingestOne(lawMst, meta == null ? null : meta.getLawId(), meta);
    }

    /**
     * lawId 기준 단건 본문 수집.
     */
    @Transactional
    public LawDocumentIngestionResult ingestByLawId(String lawId) {
        if (lawId == null || lawId.isBlank()) {
            return failResult(null, lawId, null, "lawId is blank");
        }
        // 같은 lawId가 여러 row일 수 있으므로 가장 최근(가장 큰 lawMst) 1건만 가져옴.
        LawList meta = lawListRepository.findFirstByLawIdOrderByLawMstDesc(lawId.trim()).orElse(null);
        Integer lawMst = meta == null ? null : meta.getLawMst();
        if (lawMst == null) {
            return failResult(null, lawId, null, "law_list에 해당 lawId가 없음 (먼저 law_list 적재 필요)");
        }
        return ingestOne(lawMst, lawId, meta);
    }

    // ─────────────────────── 다건 ───────────────────────

    /**
     * keyword 부분일치 → law_list에서 후보 추출 → limit 만큼 본문 수집.
     */
    @Transactional
    public LawDocumentBatchIngestionResult ingestByKeyword(String keyword, int limit) {
        int effectiveLimit = clampLimit(limit, KEYWORD_LIMIT_DEFAULT, KEYWORD_LIMIT_MAX);

        if (keyword == null || keyword.isBlank()) {
            return emptyBatch(keyword == null ? "" : keyword, effectiveLimit);
        }

        List<LawList> candidates = lawListRepository.findByLawNameKrContaining(keyword.trim());
        log.info("[LAW-DOC-INGEST] keyword='{}', candidates={}", keyword, candidates.size());
        return runBatch(keyword, effectiveLimit, candidates);
    }

    /**
     * 추천 주요 법령 본문 수집 (정확명칭 + 부분일치 fallback, 최대 RECOMMENDED_MAX 건).
     */
    @Transactional
    public LawDocumentBatchIngestionResult ingestRecommendedLaws() {
        // 정확명칭 매칭 후 부족하면 contains로 보강 — lawMst 단위로 dedup
        Set<Integer> seenMst = new LinkedHashSet<>();
        List<LawList> picked = new ArrayList<>();

        for (String name : RECOMMENDED_LAW_NAMES) {
            // 1차: 정확 일치
            List<LawList> exact = lawListRepository.findByLawNameKrContaining(name).stream()
                    .filter(l -> name.equals(l.getLawNameKr()))
                    .toList();
            for (LawList l : exact) {
                if (seenMst.add(l.getLawMst())) picked.add(l);
            }
            // 2차 fallback: contains (정확명 매칭 0이면 시도)
            if (exact.isEmpty()) {
                List<LawList> contains = lawListRepository.findByLawNameKrContaining(name);
                for (LawList l : contains) {
                    if (seenMst.add(l.getLawMst())) picked.add(l);
                    if (picked.size() >= RECOMMENDED_MAX) break;
                }
            }
            if (picked.size() >= RECOMMENDED_MAX) break;
        }

        log.info("[LAW-DOC-INGEST] recommended candidates={} (cap={})", picked.size(), RECOMMENDED_MAX);
        return runBatch("recommended", RECOMMENDED_MAX, picked);
    }

    // ─────────────────────── 내부: batch 실행 ───────────────────────

    private LawDocumentBatchIngestionResult runBatch(String keyword, int limit, List<LawList> candidates) {
        int processed = 0;
        int saved = 0;
        int failed = 0;
        List<Integer> failedMst = new ArrayList<>();
        List<LawDocumentIngestionResult> details = new ArrayList<>();

        int delayMs = Math.max(0, lawApiProperties.getRequestDelayMs());
        int actualLimit = Math.min(limit, candidates.size());

        for (int i = 0; i < actualLimit; i++) {
            LawList meta = candidates.get(i);
            LawDocumentIngestionResult one = ingestOne(meta.getLawMst(), meta.getLawId(), meta);
            details.add(one);
            processed++;
            if (one.isSuccess()) saved++;
            else {
                failed++;
                failedMst.add(meta.getLawMst());
            }

            if (i < actualLimit - 1) sleepQuiet(delayMs);
        }

        log.info("[LAW-DOC-INGEST] batch '{}' — processed={}, saved={}, failed={}",
                keyword, processed, saved, failed);

        return LawDocumentBatchIngestionResult.builder()
                .keyword(keyword)
                .requestedLimit(limit)
                .processedCount(processed)
                .savedCount(saved)
                .failedCount(failed)
                .failedLawMstList(failedMst)
                .results(details)
                .build();
    }

    // ─────────────────────── 내부: 단건 ingest ───────────────────────

    /**
     * lawMst로 본문 API 호출 → law_documents upsert.
     * @param meta 미리 조회된 LawList (없으면 null — title이 응답에서 추출됨)
     */
    private LawDocumentIngestionResult ingestOne(Integer lawMst, String lawId, LawList meta) {
        if (lawMst == null) return failResult(null, lawId, null, "lawMst is null");

        JsonNode body = lawListApiClient.fetchLawDetailByMst(lawMst);
        if (body == null) {
            return failResult(lawMst, lawId, meta == null ? null : meta.getLawNameKr(),
                    "API 응답이 비어있거나 호출 실패");
        }

        // 응답에서 핵심 정보 추출.
        // ★ 우선순위 정책: law_list 메타(이미 정확한 법령명 보유)를 1순위 — API 응답 본문 안에는
        //    다른 법령 인용이 다수 포함될 수 있어 DFS로 첫 매칭이 엉뚱한 법령을 잡을 위험이 있음.
        //    응답에서 추출한 값은 메타가 비어있을 때만 fallback으로 사용.
        String title = pickFirstNonBlank(
                meta == null ? null : meta.getLawNameKr(),
                findFirstByKey(body, "법령명_한글"),
                findFirstByKey(body, "법령명한글")
        );
        if (title == null || title.isBlank()) {
            // 최후의 보루로 lawMst를 title로
            title = "법령(MST=" + lawMst + ")";
        }

        String shortName = pickFirstNonBlank(
                meta == null ? null : meta.getLawNameShort(),
                findFirstByKey(body, "법령약칭명")
        );
        String department = pickFirstNonBlank(
                meta == null ? null : meta.getDeptName(),
                findFirstByKey(body, "소관부처명")
        );
        String enforceDate = pickFirstNonBlank(
                meta == null ? null : meta.getEnforceDate(),
                findFirstByKey(body, "시행일자")
        );
        String revisionType = pickFirstNonBlank(
                meta == null ? null : meta.getAmendType(),
                findFirstByKey(body, "제개정구분명")
        );
        String url = pickFirstNonBlank(
                meta == null ? null : meta.getDetailLink(),
                findFirstByKey(body, "법령상세링크")
        );

        // 본문 조립
        String rawContent = buildRawContent(body, title, lawMst, lawId, meta);

        // referenceId = lawMst 문자열로 통일
        String referenceId = String.valueOf(lawMst);
        Optional<LawDocument> existing = lawDocumentRepository.findByReferenceId(referenceId);
        LawDocument doc = existing.orElseGet(LawDocument::new);

        doc.setReferenceId(referenceId);
        doc.setTitle(title);
        doc.setShortName(shortName);
        doc.setDepartment(department);
        doc.setEnforceDate(enforceDate);
        doc.setRevisionType(revisionType);
        doc.setUrl(url);
        doc.setRawContent(rawContent);
        doc.setUpdatedAt(LocalDateTime.now());
        // chunked 플래그는 Chroma 적재 단계에서만 true로 변경 — 여기선 건드리지 않음

        try {
            LawDocument saved = lawDocumentRepository.save(doc);
            return LawDocumentIngestionResult.builder()
                    .success(true)
                    .lawMst(lawMst)
                    .lawId(lawId)
                    .title(title)
                    .documentId(saved.getId())
                    .contentLength(rawContent == null ? 0 : rawContent.length())
                    .message(existing.isPresent() ? "updated" : "created")
                    .build();
        } catch (Exception e) {
            log.error("[LAW-DOC-INGEST] save 실패 (lawMst={}): {}", lawMst, e.getMessage());
            return failResult(lawMst, lawId, title, "save failed: " + e.getMessage());
        }
    }

    // ─────────────────────── 본문 조립 ───────────────────────

    /**
     * API 응답에서 조문 단위 본문을 사람이 읽을 수 있는 형태로 합친다.
     * 조문 구조 추출에 실패하면 응답 JSON 전체를 pretty-print fallback.
     */
    private String buildRawContent(JsonNode body, String title, Integer lawMst, String lawId, LawList meta) {
        StringBuilder sb = new StringBuilder();
        sb.append("[법령] ").append(title);
        if (lawMst != null) sb.append("  (MST=").append(lawMst).append(")");
        if (lawId != null && !lawId.isBlank()) sb.append("  (ID=").append(lawId).append(")");
        sb.append("\n");
        if (meta != null) {
            if (meta.getDeptName() != null) sb.append("소관부처: ").append(meta.getDeptName()).append("\n");
            if (meta.getEnforceDate() != null) sb.append("시행일: ").append(meta.getEnforceDate()).append("\n");
        }
        sb.append("\n");

        // 조문 노드 후보 탐색 — 응답 구조가 가변적이므로 여러 키 시도
        JsonNode articles = findFirstArrayByKeys(body,
                "조문단위", "조문", "Articles", "ArticleList", "조항");

        boolean parsed = false;
        if (articles != null) {
            for (JsonNode a : articles) {
                String num = textOrEmpty(a, "조문번호");
                String articleTitle = textOrEmpty(a, "조문제목");
                String content = pickFirstNonBlank(
                        textOrEmpty(a, "조문내용"),
                        textOrEmpty(a, "조문본문"),
                        textOrEmpty(a, "조문")
                );
                if ((num.isEmpty() && articleTitle.isEmpty() && (content == null || content.isBlank()))) continue;

                if (!num.isEmpty()) sb.append("제").append(num).append("조");
                if (!articleTitle.isEmpty()) sb.append("(").append(articleTitle).append(")");
                if (!num.isEmpty() || !articleTitle.isEmpty()) sb.append(" ");
                if (content != null) sb.append(content.trim());
                sb.append("\n\n");
                parsed = true;
            }
        }

        if (!parsed) {
            // fallback: 응답 JSON 전체를 pretty string으로 저장 (Chroma 적재 시 LegalChunker가 정규식으로 조문 추출)
            try {
                sb.append("--- API 응답 원문(parse fallback) ---\n");
                sb.append(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(body));
            } catch (Exception ignore) {
                sb.append(body.toString());
            }
        }

        return sb.toString();
    }

    // ─────────────────────── 헬퍼 ───────────────────────

    private static int clampLimit(int requested, int dflt, int max) {
        if (requested <= 0) return dflt;
        return Math.min(requested, max);
    }

    private LawDocumentBatchIngestionResult emptyBatch(String keyword, int limit) {
        return LawDocumentBatchIngestionResult.builder()
                .keyword(keyword).requestedLimit(limit)
                .processedCount(0).savedCount(0).failedCount(0)
                .failedLawMstList(List.of()).results(List.of())
                .build();
    }

    private LawDocumentIngestionResult failResult(Integer lawMst, String lawId, String title, String msg) {
        return LawDocumentIngestionResult.builder()
                .success(false).lawMst(lawMst).lawId(lawId).title(title)
                .documentId(null).contentLength(0).message(msg)
                .build();
    }

    private static void sleepQuiet(int ms) {
        if (ms <= 0) return;
        try { Thread.sleep(ms); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
    }

    private static String pickFirstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v.trim();
        return null;
    }

    private static String textOrEmpty(JsonNode node, String key) {
        if (node == null || !node.has(key)) return "";
        JsonNode v = node.get(key);
        return (v == null || v.isNull()) ? "" : v.asText();
    }

    /** 트리에서 처음 만나는 key의 텍스트 반환 (DFS). 텍스트가 아니면 asText(). */
    private static String findFirstByKey(JsonNode root, String key) {
        JsonNode hit = findFirstByKeyNode(root, key);
        return hit == null ? null : hit.asText();
    }

    private static JsonNode findFirstByKeyNode(JsonNode root, String key) {
        if (root == null) return null;
        if (root.isObject()) {
            JsonNode hit = root.get(key);
            if (hit != null) return hit;
            Iterator<String> it = root.fieldNames();
            while (it.hasNext()) {
                JsonNode child = findFirstByKeyNode(root.get(it.next()), key);
                if (child != null) return child;
            }
        } else if (root.isArray()) {
            for (JsonNode it : root) {
                JsonNode child = findFirstByKeyNode(it, key);
                if (child != null) return child;
            }
        }
        return null;
    }

    /** 트리에서 처음 만나는 key 후보들 중 배열을 반환. */
    private static JsonNode findFirstArrayByKeys(JsonNode root, String... keys) {
        for (String k : keys) {
            JsonNode hit = findFirstByKeyNode(root, k);
            if (hit != null && hit.isArray()) return hit;
        }
        return null;
    }
}
