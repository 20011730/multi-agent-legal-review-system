package com.legalreview.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.legalreview.domain.Evidence;
import com.legalreview.domain.ReviewSession;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;

/**
 * 법령/판례 근거 DTO.
 *
 * 기존 8개 핵심 필드(sourceType ~ quotedText)는 변경 없이 유지 — Evidence 엔티티 컬럼과 1:1.
 * RAG retrieval 결과를 풍부하게 표현하기 위한 공개 metadata는 추가.
 *  - 부가 필드는 DB 저장 대상 X (Evidence 엔티티에는 컬럼 없음 — toEntity()에서 무시)
 *  - 응답 직렬화 시 null이면 자동 생략 (@JsonInclude NON_NULL)
 *  - 기존 호출자(`new EvidenceDto(8 args)`)와 100% 호환
 *  - 내부 유사도 점수(score)는 사용자용 JSON에 직렬화하지 않는다.
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class EvidenceDto {

    // ─────── 핵심 8 필드 (Evidence 엔티티 컬럼과 1:1) ───────
    private final String sourceType;
    private final String title;
    private final String referenceId;
    private final String articleOrCourt;
    private final String summary;
    private final String url;
    private final String relevanceReason;
    private final String quotedText;

    // ─────── RAG 부가 필드 (응답에만 노출, DB 저장 X) ───────
    /** RAG cosine similarity (1 - distance/2). null이면 RAG 외 출처. */
    @JsonIgnore
    @Setter private Double score;

    /**
     * 사용자 화면 구성에 필요한 공개 metadata.
     * chunk index, embedding 정보, raw distance/score, collection 이름 등 내부 진단 값은 제외한다.
     * RAG 외 evidence는 null.
     */
    @Setter private Map<String, Object> metadata;

    /**
     * Phase 10.63 — 검색 source 태그. 값 예시:
     *   - "cases_e5" / "laws_e5" : 운영 RAG 컬렉션 (기본)
     *   - "extended_case..."    : 확장 판례 컬렉션
     *   - null                   : RAG 외 출처 (법제처 OPEN API 등)
     * EvidenceCard 의 chip 라벨링과 LEGAL prompt 블록 분리에 사용.
     */
    @Setter private String dataSource;

    /**
     * 기존 8-arg 생성자 — 모든 호출자(`SessionService`, `ReviewService`,
     * `LawSearchItemDto.toEvidenceDto`, `EvidenceAssembler`)와 호환.
     */
    public EvidenceDto(String sourceType, String title, String referenceId,
                       String articleOrCourt, String summary, String url,
                       String relevanceReason, String quotedText) {
        this.sourceType = sourceType;
        this.title = title;
        this.referenceId = referenceId;
        this.articleOrCourt = articleOrCourt;
        this.summary = summary;
        this.url = url;
        this.relevanceReason = relevanceReason;
        this.quotedText = quotedText;
    }

    /**
     * Evidence 엔티티로 변환 (DB 저장용).
     * score / metadata는 DB 컬럼이 없으므로 의도적으로 무시.
     */
    public Evidence toEntity(ReviewSession session) {
        Evidence ev = new Evidence();
        ev.setSession(session);
        ev.setSourceType(sourceType != null ? sourceType : "LAW");
        ev.setTitle(title != null ? title : "");
        ev.setReferenceId(referenceId != null ? referenceId : "");
        ev.setArticleOrCourt(articleOrCourt != null ? articleOrCourt : "");
        ev.setSummary(summary != null ? summary : "");
        ev.setUrl(url != null ? url : "");
        ev.setRelevanceReason(relevanceReason != null ? relevanceReason : "");
        ev.setQuotedText(quotedText != null ? quotedText : "");
        // Phase 10.70 — dataSource 영속화. null 허용 (기존 / RAG 외 evidence).
        ev.setDataSource(dataSource);
        return ev;
    }
}
