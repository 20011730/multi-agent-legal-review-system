package com.legalreview.dto.response;

import com.legalreview.dto.request.StartupContextDto;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 진단 결과 응답.
 * Phase 10.4 — {@link #startupContext} 추가 (선택, 일반 진단은 null).
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class DebateResultResponse {

    private Long sessionId;
    private Long roundId;
    private String status;
    private List<AgentMessageDto> messages;
    private FinalDecisionDto finalDecision;
    private List<EvidenceDto> evidences;
    /** 지원사업 큐레이션에서 진입한 세션이면 그 컨텍스트. 일반 진단은 null. */
    private StartupContextDto startupContext;

    /**
     * Phase 10.12 — 사용자가 라운드 사이에 추가로 남긴 follow-up 질문 목록.
     * 각 entry: { targetAgent, message, createdAt }.
     * Verdict 페이지에서 "사용자 추가 질문 반영 항목" 섹션 표시용.
     */
    private List<Map<String, Object>> followUpQuestions;
}
