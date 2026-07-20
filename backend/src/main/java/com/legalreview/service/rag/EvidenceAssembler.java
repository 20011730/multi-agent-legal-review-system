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
        boolean isTaxTribunal = "TAX_TRIBUNAL".equalsIgnoreCase(c.getSourceType());

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
        } else if (isTaxTribunal) {
            String docNumber = c.metaFirstOf("doc_number");
            String section = c.metaFirstOf("section_type", "subsection_label");
            String taxType = c.metaFirstOf("tax_type");
            String decisionType = c.metaFirstOf("decision_type");
            title = docNumber.isBlank() ? "조세 심판례" : docNumber;
            if (!section.isBlank()) {
                title += " · " + taxSectionLabel(section);
            }
            referenceId = docNumber;
            articleOrCourt = String.join(" | ",
                    nonBlankParts("국세법령정보시스템 조세 심판례", taxType, decisionType));
        } else {
            // ── CASE 매핑 (snake_case 우선 / camelCase fallback — 어댑터 호환) ──
            //   Python 적재(`ai/generate_rag/5-2.insert_cases_e5.py`) 는 snake_case 키를 쓴다:
            //     case_name / case_number / court / decision_date / source_url / referenced_laws / text_type
            //   향후 backend 측 ingestion이 camelCase로 적재할 경우도 함께 지원.
            String caseTitle = c.metaFirstOf("case_name", "caseName", "title");
            String section   = c.metaFirstOf("text_type", "section", "section_type", "subsection_label");
            String sectionLabel = sectionLabel(section);

            // 1) title fallback chain: caseName → caseName+sectionLabel → caseNumber → "판례 근거"
            if (caseTitle == null || caseTitle.isBlank()) {
                String caseNumber = c.metaFirstOf("case_number", "caseNumber");
                String court = c.metaFirstOf("court");
                String date = c.metaFirstOf("decision_date", "judgmentDate");
                if (!caseNumber.isBlank()) {
                    caseTitle = court.isBlank() ? caseNumber : (court + " " + caseNumber);
                } else if (!court.isBlank() || !date.isBlank()) {
                    caseTitle = (court + " " + date).trim();
                } else {
                    caseTitle = "판례 근거";
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
        if (!isLaw && summary.isBlank()) {
            summary = "원문 추가 확인이 필요한 참고용 근거입니다.";
        }

        // url fallback: camelCase 'url' → snake_case 'source_url'
        // source_url 에 외부 API의 OC 값이 들어 있을 가능성을 차단하기 위해 마스킹.
        String url = maskOcInUrl(c.metaFirstOf("url", "source_url"));
        String relevanceReason = formatRelevance(c.getDistance());

        EvidenceDto dto = new EvidenceDto(
                isLaw ? "LAW" : (isTaxTribunal ? "TAX_TRIBUNAL" : "CASE"),
                title,
                referenceId,
                articleOrCourt,
                summary,
                url,
                relevanceReason,
                chunkText // quotedText: 인용문 박스로 그대로 노출
        );

        // Phase 10.70 — RAG 출처 collection 을 dataSource 로 태그.
        //   LegalRetrievalService 가 확장 collection 결과에 "extended_case..." 로 overwrite 하므로
        //   여기서는 default 로 운영 collection 명을 세팅 (이후 overwrite 안전).
        if (isLaw) {
            dto.setDataSource("law");
        } else if (isTaxTribunal) {
            dto.setDataSource("tax_tribunal");
        } else {
            dto.setDataSource("case");
        }

        // ── RAG 내부 score + 공개 metadata ──
        // score는 내부 정렬/진단용으로 DTO에 보관하되 @JsonIgnore로 사용자용 JSON에는 직렬화하지 않는다.
        Double dist = c.getDistance();
        if (dist != null) {
            double sim = Math.max(0.0, Math.min(1.0, 1.0 - dist / 2.0));
            dto.setScore(sim);
        }
        dto.setMetadata(buildExposedMetadata(c));
        return dto;
    }

    /** 화면/프롬프트에서 활용할 공개 metadata만 추려 노출한다. */
    private static Map<String, Object> buildExposedMetadata(RetrievedChunk c) {
        Map<String, Object> src = c.getMetadata();
        Map<String, Object> out = new LinkedHashMap<>();
        if (src != null) {
            // 우선순위 공개 키만 정렬해서 응답에 일관된 순서로 노출.
            // 제외 예: chunkIndex/chunk_id, embedding*, raw score/distance, collection, detail_root 등 내부 진단 값.
            String[] orderedKeys = {
                    // 공용
                    "sourceType", "source_type",
                    // LAW (camelCase 위주)
                    "lawMst", "lawId", "lawNameKr", "lawTypeName",
                    "deptName", "enforceDate", "promulgateDate",
                    "articleNo", "articleTitle",
                    // CASE (camelCase + snake_case 둘 다 노출 — adapter 차이 대응)
                    "section", "text_type", "section_type", "subsection_label",
                    "caseNumber", "case_number",
                    "caseName", "case_name",
                    "court",
                    "judgmentDate", "decision_date",
                    "caseType",
                    "referenced_laws", "ref_statutes", "ref_cases", "summary",
                    // TAX_TRIBUNAL
                    "doc_number", "tax_type", "decision_type", "attr_year",
                    // 공통 공개 표시용
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
        return out;
    }

    private static List<String> nonBlankParts(String... values) {
        List<String> parts = new ArrayList<>();
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                parts.add(value);
            }
        }
        return parts;
    }

    private static String sectionLabel(String section) {
        if (section == null) return "";
        return switch (section) {
            // backend (camelCase) 및 ai/generate_rag (snake_case) 양쪽 키 지원
            case "issues", "issue" -> "판시사항";
            case "summary", "holding" -> "판결요지";
            case "reasoning" -> "판단이유";
            case "referenced_laws" -> "참조조문";
            case "referenced_cases" -> "참조판례";
            case "body", "main", "본문" -> "판례본문";
            case "이유" -> "판단이유";
            case "주문" -> "주문";
            case "결론" -> "결론";
            case "인정근거" -> "인정근거";
            case "meta" -> "메타정보";
            default -> "";
        };
    }

    private static String taxSectionLabel(String section) {
        if (section == null || section.isBlank()) return "";
        String compact = section.replaceAll("\\s+", "");
        if (compact.equals("요지")) return "요지";
        if (compact.equals("상세내용")) return "상세내용";
        if (compact.equals("주문")) return "주문";
        if (compact.equals("이유")) return "이유";
        if (section.length() > 40) return section.substring(0, 40) + "…";
        return section;
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
     * Phase 10.85 — Chroma distance 를 사용자 친화 라벨로 변환.
     * 내부 수치(벡터 유사도 0.NN) 노출 금지. 3 단계 등급으로만 표시.
     *   sim ≥ 0.75 → "관련도 높음"
     *   sim ≥ 0.55 → "관련도 보통"
     *   그 외       → "관련도 참고"
     */
    private static String formatRelevance(Double distance) {
        if (distance == null) return "";
        double sim = Math.max(0.0, Math.min(1.0, 1.0 - distance / 2.0));
        if (sim >= 0.75) return "관련도 높음";
        if (sim >= 0.55) return "관련도 보통";
        return "관련도 참고";
    }
}
