package com.legalreview.service.rag;

import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.response.EvidenceDto;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
            // ── CASE 매핑 (snake_case 우선 / camelCase fallback — 어댑터 호환) ──
            //   Python 적재(`ai/generate_rag/5-2.insert_cases_e5.py`) 는 snake_case 키를 쓴다:
            //     case_name / case_number / court / decision_date / source_url / referenced_laws / text_type
            //   향후 backend 측 ingestion이 camelCase로 적재할 경우도 함께 지원.
            String caseTitle = c.metaFirstOf("case_name", "caseName", "title");
            String section   = c.metaFirstOf("text_type", "section");
            String sectionLabel = sectionLabel(section);

            // 1) title fallback chain: caseName → caseName+sectionLabel → caseNumber → "(판례)"
            if (caseTitle == null || caseTitle.isBlank()) {
                String caseNumber = c.metaFirstOf("case_number", "caseNumber");
                String court = c.metaFirstOf("court");
                String date = c.metaFirstOf("decision_date", "judgmentDate");
                if (!caseNumber.isBlank()) {
                    caseTitle = court.isBlank() ? caseNumber : (court + " " + caseNumber);
                } else if (!court.isBlank() || !date.isBlank()) {
                    caseTitle = (court + " " + date).trim();
                } else {
                    caseTitle = "(판례)";
                }
            }
            title = caseTitle + (sectionLabel.isEmpty() ? "" : " · " + sectionLabel);
            referenceId = c.metaFirstOf("case_number", "caseNumber");
            articleOrCourt = c.metaFirstOf("court");
        }

        String chunkText = c.getChunkText() == null ? "" : c.getChunkText();
        String summary = chunkText.length() > SUMMARY_MAX_CHARS
                ? chunkText.substring(0, SUMMARY_MAX_CHARS) + "..."
                : chunkText;

        // url fallback: camelCase 'url' → snake_case 'source_url'
        // source_url 에 외부 API의 OC 값이 들어 있을 가능성을 차단하기 위해 마스킹.
        String url = maskOcInUrl(c.metaFirstOf("url", "source_url"));
        String relevanceReason = formatRelevance(c.getDistance());

        EvidenceDto dto = new EvidenceDto(
                isLaw ? "LAW" : "CASE",
                title,
                referenceId,
                articleOrCourt,
                summary,
                url,
                relevanceReason,
                chunkText // quotedText: 인용문 박스로 그대로 노출
        );

        // ── RAG 부가 필드: score + metadata ──
        // 응답에만 노출, DB 저장 X (Evidence 엔티티에는 컬럼 없음)
        Double dist = c.getDistance();
        if (dist != null) {
            double sim = Math.max(0.0, Math.min(1.0, 1.0 - dist / 2.0));
            dto.setScore(sim);
        }
        dto.setMetadata(buildExposedMetadata(c));
        return dto;
    }

    /**
     * 화면/프롬프트에서 활용할 metadata만 추려 노출.
     * Chroma 내부 키 일부(rowId 등)는 응답에 안 보이게 의도적으로 제외 가능 — 여기선 모두 패스스루.
     */
    private static Map<String, Object> buildExposedMetadata(RetrievedChunk c) {
        Map<String, Object> src = c.getMetadata();
        Map<String, Object> out = new LinkedHashMap<>();
        if (src != null) {
            // 우선순위 키만 정렬해서 응답에 일관된 순서로 노출
            String[] orderedKeys = {
                    // 공용
                    "sourceType", "source_type",
                    // LAW (camelCase 위주)
                    "lawMst", "lawId", "lawNameKr", "lawTypeName",
                    "deptName", "deptCode", "enforceDate", "promulgateDate",
                    "articleNo", "articleTitle",
                    // CASE (camelCase + snake_case 둘 다 노출 — adapter 차이 대응)
                    "section", "text_type",
                    "caseNumber", "case_number",
                    "caseName", "case_name",
                    "court",
                    "judgmentDate", "decision_date",
                    "caseType",
                    "referenced_laws", "summary",
                    // 본문 부재 case 진단용 (5-1/5-3/5-2 흐름이 넣어주는 메타)
                    "body_status", "detail_root", "data_source", "case_type_name",
                    // 공통
                    "chunkIndex", "chunk_index", "chunkingStrategy",
                    "embeddingProvider", "embeddingModel",
                    "url",
                    "shortName", "revisionType", "referenceId"
            };
            for (String k : orderedKeys) {
                if (src.containsKey(k) && src.get(k) != null && !src.get(k).toString().isEmpty()) {
                    // source_url 은 OC 마스킹 후 노출 (별도 처리)
                    out.put(k, src.get(k));
                }
            }
            // source_url 별도 처리 — OC 마스킹
            Object srcUrl = src.get("source_url");
            if (srcUrl != null && !srcUrl.toString().isEmpty()) {
                out.put("source_url", maskOcInUrl(srcUrl.toString()));
            }
        }
        out.put("chunkId", c.getChunkId());
        return out;
    }

    private static String sectionLabel(String section) {
        if (section == null) return "";
        return switch (section) {
            // backend (camelCase) 및 ai/generate_rag (snake_case) 양쪽 키 지원
            case "issues", "issue" -> "판시사항";
            case "summary", "holding" -> "판결요지";
            case "reasoning" -> "판단이유";
            case "referenced_laws" -> "참조조문";
            case "body" -> "판례본문";
            case "meta" -> "메타정보";
            default -> "";
        };
    }

    /**
     * URL에 ``OC=<값>`` 또는 ``oc=<값>`` 쿼리 파라미터가 포함되어 있으면 ``OC=<MASKED>`` 로 치환.
     * 외부 API key가 화면/응답에 노출되는 것을 방지.
     */
    private static String maskOcInUrl(String url) {
        if (url == null || url.isEmpty()) return url;
        return url.replaceAll("([?&][Oo][Cc])=[^&#]*", "$1=<MASKED>");
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
