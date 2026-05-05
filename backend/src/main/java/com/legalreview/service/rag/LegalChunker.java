package com.legalreview.service.rag;

import com.legalreview.domain.CaseDocument;
import com.legalreview.domain.LawDocument;
import lombok.AllArgsConstructor;
import lombok.Getter;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 법령/판례 chunking 유틸.
 *
 * - 법령: 본문을 "제N조(제목)" 단위로 분리. 조문 1개 = chunk 1개 기본 정책.
 * - 판례: 판시사항 / 판결요지(summary) / 판단이유(reasoning) 3 섹션 단위로 chunk.
 *
 * Chroma 적재 시 이 결과의 chunkId를 그대로 문서 ID로 사용한다.
 * id 규칙:
 *   - 법령: "law:{referenceId}:art:{articleNo}"
 *   - 판례: "case:{referenceId}:{section}"   (section = issues | summary | reasoning)
 */
@Component
public class LegalChunker {

    /** "제 N조" 또는 "제N조(제목)" 패턴 매칭 (전후 공백/줄바꿈 허용). */
    private static final Pattern ARTICLE_PATTERN = Pattern.compile(
            "(?m)^\\s*제\\s*(\\d+)\\s*조(?:\\s*\\(([^)]*)\\))?\\s*"
    );

    /** chunk 1개의 최소 길이 — 너무 짧은 fragment는 부모 조문에 합침. */
    private static final int MIN_CHUNK_CHARS = 30;
    /** chunk 1개의 최대 길이 — 너무 길면 임베딩 모델 컨텍스트 초과 방지. */
    private static final int MAX_CHUNK_CHARS = 2000;

    /**
     * 법령 본문을 조문 단위 chunk로 분할.
     */
    public List<Chunk> chunkLaw(LawDocument doc) {
        String content = doc.getRawContent();
        List<Chunk> result = new ArrayList<>();
        if (content == null || content.isBlank()) return result;

        Matcher matcher = ARTICLE_PATTERN.matcher(content);
        List<int[]> ranges = new ArrayList<>();
        List<String> articleNos = new ArrayList<>();
        List<String> articleTitles = new ArrayList<>();

        while (matcher.find()) {
            ranges.add(new int[]{ matcher.start(), matcher.end() });
            articleNos.add(matcher.group(1));
            articleTitles.add(matcher.group(2) == null ? "" : matcher.group(2).trim());
        }

        // 매칭 결과가 없으면 전체를 하나의 chunk로 (fallback)
        if (ranges.isEmpty()) {
            String trimmed = content.trim();
            if (trimmed.length() >= MIN_CHUNK_CHARS) {
                result.add(buildLawChunk(doc, "0", "", truncate(trimmed)));
            }
            return result;
        }

        for (int i = 0; i < ranges.size(); i++) {
            int start = ranges.get(i)[0];
            int end = (i + 1 < ranges.size()) ? ranges.get(i + 1)[0] : content.length();
            String body = content.substring(start, end).trim();
            if (body.length() < MIN_CHUNK_CHARS) continue;
            result.add(buildLawChunk(doc, articleNos.get(i), articleTitles.get(i), truncate(body)));
        }
        return result;
    }

    /**
     * 판례 본문을 섹션 단위 chunk로 분할.
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

        String chunkId = "case:" + safe(doc.getReferenceId(), String.valueOf(doc.getId())) + ":" + section;
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
        out.add(new Chunk(chunkId, "CASE", truncate(trimmed), meta));
    }

    private Chunk buildLawChunk(LawDocument doc, String articleNo, String articleTitle, String body) {
        String chunkId = "law:" + safe(doc.getReferenceId(), String.valueOf(doc.getId())) + ":art:" + articleNo;
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("rowId", doc.getId());
        meta.put("sourceType", "LAW");
        meta.put("title", safe(doc.getTitle(), ""));
        meta.put("shortName", safe(doc.getShortName(), ""));
        meta.put("articleNo", articleNo);
        meta.put("articleTitle", articleTitle);
        meta.put("department", safe(doc.getDepartment(), ""));
        meta.put("enforceDate", safe(doc.getEnforceDate(), ""));
        meta.put("revisionType", safe(doc.getRevisionType(), ""));
        meta.put("url", safe(doc.getUrl(), ""));
        return new Chunk(chunkId, "LAW", body, meta);
    }

    private static String truncate(String s) {
        return s.length() <= MAX_CHUNK_CHARS ? s : s.substring(0, MAX_CHUNK_CHARS);
    }

    private static String safe(String v, String fallback) {
        return (v == null || v.isEmpty()) ? fallback : v;
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
