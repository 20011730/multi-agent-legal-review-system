package com.legalreview.dto.response;

import com.legalreview.domain.enums.AnalysisPhase;
import com.legalreview.domain.enums.SessionStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SessionFeedbackResponse {

    private Long sessionId;
    private SessionStatus status;
    private AnalysisPhase analysisPhase;
    private String message;
}
