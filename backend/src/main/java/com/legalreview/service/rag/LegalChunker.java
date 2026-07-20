package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.domain.CaseDocument;
import com.legalreview.domain.LawDocument;
import com.legalreview.domain.LawList;
import com.legalreview.repository.LawListRepository;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 법령/판례 chunking 유틸 — 의미 기반 + 길이 overlap 하이브리드.
 *
 * 발표 자료 기준 청킹 정책:
 *   1) [의미 기반] 법령은 "제N조(제목)" 단위로 1차 분할 — 법적 의미 단위 보존
 *   2) [길이 보호] 단일 조문이 {@code MAX_CHUNK_CHARS}를 초과하면 길이 단위로 sub-split
 *   3) [overlap]  sub-split 시 앞뒤 {@code OVERLAP_CHARS}만큼 문맥 보존을 위해 겹침
 *   4) chunkId는 sub-part까지 식별 가능: "law:{ref}:art:{N}:part:{idx}"
 *   5) metadata에 lawNameKr / referenceId / articleNo / articleTitle / chunkIndex /
 *      chunkingStrategy / embeddingProvider / sourceType 모두 기록 → retrieval 결과 풍부화
 *
 * 판례:
 *   - 판시사항 / 판결요지 / 판단이유 3 섹션 단위로 1차 분할 (의미 기반)
 *   - 섹션이 길면 동일하게 sub-split + overlap 적용
 *   - chunkId: "case:{ref}:{section}:part:{idx}"
 *
 * Bean으로 주입받는 의존성:
 *   - {@link RagProperties}    : embedding.provider 값을 metadata에 기록
 *   - {@link LawListRepository}: lawId / lawTypeName 등 메타데이터 보강
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LegalChunker {

    /** "제 N조" 또는 "제N조(제목)" 패턴 매칭 (전후 공백/줄바꿈 허용). */
    private static final Pattern ARTICLE_PATTERN = Pattern.compile(
            "(?m)^\\s*제\\s*(\\d+)\\s*조(?:\\s*\\(([^)]*)\\))?\\s*"
    );

    /** chunk 1개의 최소 길이 — 너무 짧은 fragment는 부모 조문에 합침. */
    private static final int MIN_CHUNK_CHARS = 30;
    /** chunk 1개의 최대 길이 — 임베딩 모델 컨텍스트 한계 + 검색 정확도 균형. */
    private static final int MAX_CHUNK_CHARS = 1500;
    /** sub-split 시 겹침(문맥 보존). 임베딩 모델 토큰 한계 대비 안전. */
    private static final int OVERLAP_CHARS = 150;

    /** 적용된 청킹 전략 식별자 (metadata 기록용). */
    public static final String CHUNKING_STRATEGY_LAW = "hybrid-article-overlap-v1";
    public static final String CHUNKING_STRATEGY_CASE = "hybrid-section-overlap-v1";

    private final RagProperties ragProperties;
    private final LawListRepository lawListRepository;

    // ─────────────────────── 법령 ───────────────────────

    /**
     * 법령 본문을 의미 단위(조문) → 길이 보호(max+overlap)로 chunk 생성.
     */
    public List<Chunk> chunkLaw(LawDocument doc) {
        String content = doc.getRawContent();
        List<Chunk> result = new ArrayList<>();
        if (content == null || content.isBlank()) return result;

        // law_list 메타 보강 (lawId, lawTypeName 등)
        LawList listMeta = null;
        try {
            String ref = doc.getReferenceId();
            if (ref != null) {
                Integer mst = parseIntSafe(ref);
                if (mst != null) listMeta = lawListRepository.findById(mst).orElse(null);
            }
        } catch (Exception ignored) {
            // 보강 실패는 무시 — title 등은 LawDocument에서 충당
        }

        Matcher matcher = ARTICLE_PATTERN.matcher(content);
        List<int[]> ranges = new ArrayList<>();
        List<String> articleNos = new ArrayList<>();
        List<String> articleTitles = new ArrayList<>();
        while (matcher.find()) {
            ranges.add(new int[]{ matcher.start(), matcher.end() });
            articleNos.add(matcher.group(1));
            articleTitles.add(matcher.group(2) == null ? "" : matcher.group(2).trim());
        }

        // 매칭 결과가 없으면 전체를 길이 단위로 sub-split (fallback)
        if (ranges.isEmpty()) {
            String trimmed = content.trim();
            if (trimmed.length() < MIN_CHUNK_CHARS) return result;
            for (String part : sliceWithOverlap(trimmed, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
                result.add(buildLawChunk(doc, listMeta, "0", "", part, result.size()));
            }
            return result;
        }

        // 조문 단위 의미 분할 → 길이 초과 시 sub-split + overlap
        for (int i = 0; i < ranges.size(); i++) {
            int start = ranges.get(i)[0];
            int end = (i + 1 < ranges.size()) ? ranges.get(i + 1)[0] : content.length();
            String body = content.substring(start, end).trim();
            if (body.length() < MIN_CHUNK_CHARS) continue;

            List<String> parts = sliceWithOverlap(body, MAX_CHUNK_CHARS, OVERLAP_CHARS);
            for (String part : parts) {
                result.add(buildLawChunk(
                        doc, listMeta,
                        articleNos.get(i),
                        articleTitles.get(i),
                        part,
                        result.size()
                ));
            }
        }
        return result;
    }

    // ─────────────────────── 판례 ───────────────────────

    /**
     * 판례 본문을 섹션 단위(판시사항/판결요지/판단이유) → 길이 보호로 chunk 생성.
     */
    public List<Chunk> chunkCase(CaseDocument doc) {
        List<Chunk> result = new ArrayList<>();
        addCaseSection(result, doc, "issues", doc.getIssues());
        addCaseSection(result, doc, "summary", doc.getSummary());
        addCaseSection(result, doc, "reasoning", doc.getReasoning());
        return result;
    }

    private void addCaseSection(List<Chunk> out, CaseDocument doc, String section, String text) {
        if (text == null || text.isBlank()) return;
        String trimmed = text.trim();
        if (trimmed.length() < MIN_CHUNK_CHARS) return;

        List<String> parts = sliceWithOverlap(trimmed, MAX_CHUNK_CHARS, OVERLAP_CHARS);
        for (int i = 0; i < parts.size(); i++) {
            String chunkId = "case:" + safe(doc.getReferenceId(), String.valueOf(doc.getId()))
                    + ":" + section + ":part:" + i;
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("rowId", doc.getId());
            meta.put("sourceType", "CASE");
            meta.put("title", safe(doc.getTitle(), ""));
            meta.put("caseNumber", safe(doc.getCaseNumber(), ""));
            meta.put("court", safe(doc.getCourt(), ""));
            meta.put("judgmentDate", safe(doc.getJudgmentDate(), ""));
            meta.put("caseType", safe(doc.getCaseType(), ""));
            meta.put("url", safe(doc.getUrl(), ""));
            meta.put("section", section);
            meta.put("chunkIndex", i);
            meta.put("chunkingStrategy", CHUNKING_STRATEGY_CASE);
            meta.put("embeddingProvider", ragProperties.getEmbedding().getProvider());
            meta.put("embeddingModel", ragProperties.getEmbedding().getModel());
            meta.put("referenceId", safe(doc.getReferenceId(), ""));
            out.add(new Chunk(chunkId, "CASE", parts.get(i), meta));
        }
    }

    // ─────────────────────── 법령 chunk 빌더 (metadata 정교화) ───────────────────────

    private Chunk buildLawChunk(LawDocument doc, LawList listMeta,
                                String articleNo, String articleTitle,
                                String body, int chunkIndex) {
        String ref = safe(doc.getReferenceId(), String.valueOf(doc.getId()));
        // chunkId: 의미 단위 + sub-part index
        String chunkId = "law:" + ref + ":art:" + articleNo + ":part:" + chunkIndex;

        Map<String, Object> meta = new LinkedHashMap<>();
        // 핵심 식별
        meta.put("rowId", doc.getId());
        meta.put("sourceType", "LAW");
        meta.put("referenceId", ref);                       // = lawMst 문자열
        meta.put("lawMst", ref);                            // 명시적 별칭
        meta.put("title", safe(doc.getTitle(), ""));
        meta.put("lawNameKr", safe(doc.getTitle(), ""));    // 명시적 (발표 자료 metadata 키와 일치)

        // law_list 메타 보강
        if (listMeta != null) {
            meta.put("lawId", safe(listMeta.getLawId(), ""));
            meta.put("lawTypeName", safe(listMeta.getLawTypeName(), ""));
            meta.put("deptName", safe(listMeta.getDeptName(), ""));
            meta.put("deptCode", safe(listMeta.getDeptCode(), ""));
            meta.put("enforceDate", safe(listMeta.getEnforceDate(), ""));
            meta.put("promulgateDate", safe(listMeta.getPromulgateDate(), ""));
            // doc.url 우선, 없으면 listMeta.detailLink
            String url = pickFirstNonBlank(doc.getUrl(), listMeta.getDetailLink());
            meta.put("url", url == null ? "" : url);
        } else {
            meta.put("lawId", "");
            meta.put("lawTypeName", "");
            meta.put("deptName", safe(doc.getDepartment(), ""));
            meta.put("enforceDate", safe(doc.getEnforceDate(), ""));
            meta.put("url", safe(doc.getUrl(), ""));
        }

        meta.put("shortName", safe(doc.getShortName(), ""));
        meta.put("revisionType", safe(doc.getRevisionType(), ""));

        // 조문 단위
        meta.put("articleNo", articleNo);
        meta.put("articleTitle", articleTitle);

        // 청킹 전략 / 임베딩 메타 (재적재 트리거 식별용)
        meta.put("chunkIndex", chunkIndex);
        meta.put("chunkingStrategy", CHUNKING_STRATEGY_LAW);
        meta.put("embeddingProvider", ragProperties.getEmbedding().getProvider());
        meta.put("embeddingModel", ragProperties.getEmbedding().getModel());

        return new Chunk(chunkId, "LAW", body, meta);
    }

    // ─────────────────────── 길이 sub-split + overlap ───────────────────────

    /**
     * 텍스트를 max 단위로 자르되 overlap 만큼 앞 글자를 다음 chunk 앞에 겹쳐 보존.
     *  - text.length() <= max → 1개 그대로 반환
     *  - 그 외 sliding window (step = max - overlap)
     */
    static List<String> sliceWithOverlap(String text, int max, int overlap) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        String t = text.trim();
        int n = t.length();
        if (n == 0) return out;
        if (n <= max) {
            out.add(t);
            return out;
        }
        int step = Math.max(1, max - overlap);
        for (int start = 0; start < n; start += step) {
            int end = Math.min(n, start + max);
            out.add(t.substring(start, end));
            if (end >= n) break;
        }
        return out;
    }

    // ─────────────────────── 헬퍼 ───────────────────────

    private static Integer parseIntSafe(String v) {
        if (v == null) return null;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return null; }
    }

    private static String safe(String v, String fallback) {
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    private static String pickFirstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v.trim();
        return null;
    }

    @Getter
    @AllArgsConstructor
    public static class Chunk {
        private final String chunkId;
        private final String sourceType; // "LAW" | "CASE"
        private final String text;
        private final Map<String, Object> metadata;
    }
}
