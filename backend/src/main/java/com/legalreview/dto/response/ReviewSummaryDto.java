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
    private String riskSummary;
    private long messageCount;
    private long evidenceCount;
    private long followUpQuestionCount;
    private long reanalysisQuestionCount;
    private long assistantMessageCount;

    public static ReviewSummaryDto from(ReviewSession session) {
        return from(session, 0, 0, 0, 0, 0);
    }

    public static ReviewSummaryDto from(
            ReviewSession session,
            long messageCount,
            long evidenceCount,
            long followUpQuestionCount,
            long reanalysisQuestionCount,
            long assistantMessageCount
    ) {
        return from(session, session.getFinalDecision(), messageCount, evidenceCount,
                followUpQuestionCount, reanalysisQuestionCount, assistantMessageCount);
    }

    public static ReviewSummaryDto from(
            ReviewSession session,
            com.legalreview.domain.FinalDecision finalDecision,
            long messageCount,
            long evidenceCount,
            long followUpQuestionCount,
            long reanalysisQuestionCount,
            long assistantMessageCount
    ) {
        String verdict = null;
        String riskLevel = null;
        String riskSummary = null;

        if (finalDecision != null) {
            verdict = finalDecision.getVerdict();
            riskLevel = finalDecision.getRiskLevel();
            if (finalDecision.getRisks() != null && !finalDecision.getRisks().isEmpty()) {
                riskSummary = finalDecision.getRisks().get(0).getDescription();
                if (riskSummary != null && riskSummary.length() > 90) {
                    riskSummary = riskSummary.substring(0, 90) + "...";
                }
            }
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
                riskLevel,
                riskSummary,
                messageCount,
                evidenceCount,
                followUpQuestionCount,
                reanalysisQuestionCount,
                assistantMessageCount
        );
    }
}
