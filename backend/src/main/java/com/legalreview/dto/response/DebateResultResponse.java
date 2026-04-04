package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

@Getter
@AllArgsConstructor
public class DebateResultResponse {

    private Long sessionId;
    private Long roundId;
    private String status;
    private List<AgentMessageDto> messages;
    private FinalDecisionDto finalDecision;
    private List<EvidenceDto> evidences;
}
