package com.legalreview.dto.response;

import com.legalreview.domain.Evidence;
import com.legalreview.domain.ReviewSession;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class EvidenceDto {

    private String sourceType;
    private String title;
    private String referenceId;
    private String articleOrCourt;
    private String summary;
    private String url;
    private String relevanceReason;
    private String quotedText;

    /**
     * Evidence 엔티티로 변환 (DB 저장용).
     * 세션에 법제처 검색 결과를 저장할 때 사용.
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
        return ev;
    }
}
