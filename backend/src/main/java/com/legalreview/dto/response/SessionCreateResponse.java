package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SessionCreateResponse {

    private Long sessionId;
    private String status;
}
