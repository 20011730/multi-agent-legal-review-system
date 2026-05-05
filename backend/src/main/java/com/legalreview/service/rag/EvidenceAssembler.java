package com.legalreview.service.rag;

import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.response.EvidenceDto;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * RAG retrieval 결과(RetrievedChunk)를 기존 EvidenceDto로 변환한다.
 * → 결과 페이지(/verdict), 히스토리 상세(/reviews/:id), PDF가 동일한 EvidenceDto 흐름을 그대로 재사용.
 *
 * 매핑 규칙:
 *  - sourceType: 그대로 ("LAW" | "CASE")
 *  - title:
 *      - LAW: 법령명 + 조문 제목 (있으면 " 제N조(제목)" 부착)
 *      - CASE: 사건명 + 섹션 (issues|summary|reasoning)
 *  - referenceId: metadata의 lawId/caseNumber/articleNo (식별 가능 값)
 *  - articleOrCourt: 소관부처 또는 법원명
 *  - summary: chunk 본문 텍스트 (검색 매칭의 핵심 — 기존 법제처 search snippet과 같은 위치)
 *  - url: 법제처 원문 링크
 *  - relevanceReason: distance 기반 유사도 점수 (사람이 읽기 쉽게 변환)
 *  - quotedText: chunk 본문 그대로 (UI에서 인용문 박스로 보여줌)
 */
@Component
public class EvidenceAssembler {

    /** chunk 본문 길이 — UI에 너무 길게 노출되지 않게 잘라 표시할 때 사용. */
    private static final int SUMMARY_MAX_CHARS = 400;

    public List<EvidenceDto> toEvidenceDtos(List<RetrievedChunk> chunks) {
        List<EvidenceDto> result = new ArrayList<>(chunks.size());
        for (RetrievedChunk c : chunks) {
            result.add(toEvidenceDto(c));
        }
        return result;
    }

    public EvidenceDto toEvidenceDto(RetrievedChunk c) {
        boolean isLaw = "LAW".equalsIgnoreCase(c.getSourceType());

        String title;
        String referenceId;
        String articleOrCourt;

        if (isLaw) {
            String lawTitle = c.metaString("title");
            String articleNo = c.metaString("articleNo");
            String articleTitle = c.metaString("articleTitle");
            title = lawTitle
                    + (articleNo != null && !articleNo.isEmpty() ? " 제" + articleNo + "조" : "")
                    + (articleTitle != null && !articleTitle.isEmpty() ? "(" + articleTitle + ")" : "");
            referenceId = articleNo == null || articleNo.isEmpty()
                    ? c.metaString("lawId")
                    : ("제" + articleNo + "조");
            articleOrCourt = c.metaString("department");
        } else {
            String caseTitle = c.metaString("title");
            String section = c.metaString("section");
            String sectionLabel = sectionLabel(section);
            title = caseTitle + (sectionLabel.isEmpty() ? "" : " · " + sectionLabel);
            referenceId = c.metaString("caseNumber");
            articleOrCourt = c.metaString("court");
        }

        String chunkText = c.getChunkText() == null ? "" : c.getChunkText();
        String summary = chunkText.length() > SUMMARY_MAX_CHARS
                ? chunkText.substring(0, SUMMARY_MAX_CHARS) + "..."
                : chunkText;

        String url = c.metaString("url");
        String relevanceReason = formatRelevance(c.getDistance());

        return new EvidenceDto(
                isLaw ? "LAW" : "CASE",
                title,
                referenceId,
                articleOrCourt,
                summary,
                url,
                relevanceReason,
                chunkText // quotedText: 인용문 박스로 그대로 노출
        );
    }

    private static String sectionLabel(String section) {
        if (section == null) return "";
        return switch (section) {
            case "issues" -> "판시사항";
            case "summary" -> "판결요지";
            case "reasoning" -> "판단이유";
            default -> "";
        };
    }

    /**
     * Chroma distance(낮을수록 유사)를 사람이 읽기 좋은 표현으로 변환.
     * 코사인 거리 가정: 0~2 범위, 0이 동일.
     */
    private static String formatRelevance(Double distance) {
        if (distance == null) return "";
        double sim = Math.max(0.0, Math.min(1.0, 1.0 - distance / 2.0));
        return String.format("벡터 유사도 %.2f", sim);
    }
}
