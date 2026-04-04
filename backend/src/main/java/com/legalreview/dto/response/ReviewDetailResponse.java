package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

/**
 * 검토 세션 상세 조회 응답.
 * /result, /verdict 화면에서 재열람 시 사용.
 */
@Getter
@AllArgsConstructor
public class ReviewDetailResponse {

    // 세션 기본 정보
    private Long sessionId;
    private String companyName;
    private String industry;
    private String reviewType;
    private String situation;
    private String content;
    private String participationMode;
    private String status;
    private String createdAt;

    // 토론 메시지
    private List<AgentMessageDto> messages;

    // 최종 판정
    private FinalDecisionDto finalDecision;
}
