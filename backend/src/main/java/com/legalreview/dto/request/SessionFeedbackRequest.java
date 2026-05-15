package com.legalreview.dto.request;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class SessionFeedbackRequest {

    private String content;

    @NotNull
    private Boolean isPass;
}
