package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class AgentMessageDto {

    private String agentId;
    private String agentName;
    private String content;
    private String type;
    private int round;
    private String stance;
    private String evidenceSummary;
}
