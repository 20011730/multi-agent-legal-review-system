package com.legalreview.dto.response;

import com.legalreview.domain.ReviewSession;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class ReviewSummaryDto {

    private Long sessionId;
    private String companyName;
    private String reviewType;
    private String situation;
    private String status;
    private String createdAt;
    private String verdict;
    private String riskLevel;

    public static ReviewSummaryDto from(ReviewSession session) {
        String verdict = null;
        String riskLevel = null;

        if (session.getFinalDecision() != null) {
            verdict = session.getFinalDecision().getVerdict();
            riskLevel = session.getFinalDecision().getRiskLevel();
        }

        // situation 요약: 최대 80자
        String situationSummary = session.getSituation();
        if (situationSummary != null && situationSummary.length() > 80) {
            situationSummary = situationSummary.substring(0, 80) + "...";
        }

        return new ReviewSummaryDto(
                session.getId(),
                session.getCompanyName(),
                session.getReviewType(),
                situationSummary,
                session.getStatus(),
                session.getCreatedAt().toString(),
                verdict,
                riskLevel
        );
    }
}
