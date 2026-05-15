package com.legalreview.dto.response;

import com.legalreview.domain.enums.AnalysisPhase;
import com.legalreview.domain.enums.SessionStatus;
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
    private SessionStatus status;
    private long messageCount;        // 현재까지 저장된 토론 메시지 수
    private boolean hasFinalDecision; // 최종 판정 존재 여부
    private AnalysisPhase analysisPhase; // 사용자 개입 단계 포함: WAITING_FOR_USER_R1, WAITING_FOR_USER_R2
}
