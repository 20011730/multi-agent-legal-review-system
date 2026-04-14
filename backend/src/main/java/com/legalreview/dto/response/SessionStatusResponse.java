package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 세션 상태 조회 응답 DTO
 * 프론트엔드 폴링에 사용
 */
@Getter
@AllArgsConstructor
public class SessionStatusResponse {

    private Long sessionId;
    private String status;          // ANALYZING | COMPLETED | FAILED
    private long messageCount;      // 현재까지 저장된 토론 메시지 수
    private boolean hasFinalDecision; // 최종 판정 존재 여부
}
