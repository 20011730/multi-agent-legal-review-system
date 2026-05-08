package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.Map;

/**
 * 실험 태그(또는 그룹) 단위 집계 메트릭.
 * 평균/분포 — 두 실험 태그를 비교할 때 사용.
 */
@Getter
@Builder
@AllArgsConstructor
public class ExperimentSummaryDto {
    private String experimentTag;
    private long sampleCount;

    // 평균(완료된 세션만)
    private double avgDurationMs;
    private double avgEvidenceCount;
    private double avgLawEvidenceCount;
    private double avgCaseEvidenceCount;
    private double avgLegalMsgChars;
    private double avgBizMsgChars;
    private double avgJudgeMsgChars;
    private double avgMessageCount;

    // 분포
    /** verdict 별 건수 — e.g. {"approved":3, "conditional":5, "rejected":1} */
    private Map<String, Long> verdictDistribution;
    /** riskLevel 별 건수 — e.g. {"HIGH":2, "MEDIUM":4, "LOW":1} */
    private Map<String, Long> riskLevelDistribution;
}
