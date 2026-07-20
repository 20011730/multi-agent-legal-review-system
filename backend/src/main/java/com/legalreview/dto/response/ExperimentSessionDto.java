package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

/**
 * 실험 추적용 세션 단위 메트릭 DTO.
 *
 * 비교 가능한 숫자만 포함 — 향후 CSV export / 프론트 표 노출에 그대로 사용 가능.
 */
@Getter
@Builder
@AllArgsConstructor
public class ExperimentSessionDto {
    private Long sessionId;
    private String createdAt;
    private String status;

    // 실험 메타 (분석 시점 스냅샷)
    private String experimentTag;
    private Boolean ragEnabled;
    private Integer ragTopkLaw;
    private Integer ragTopkCase;

    // 타이밍
    private Long analysisDurationMs;

    // 토론 메트릭
    private long messageCount;
    private long legalMsgTotalChars;
    private long bizMsgTotalChars;
    private long judgeMsgTotalChars;

    // evidence 메트릭
    private long totalEvidenceCount;
    private long lawEvidenceCount;
    private long caseEvidenceCount;

    // 최종 판정
    private String verdict;
    private String riskLevel;
    private long riskCount;

    // 입력 메타 (필터/그룹용)
    private String reviewType;
    private String industry;
}
