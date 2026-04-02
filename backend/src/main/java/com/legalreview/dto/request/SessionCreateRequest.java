package com.legalreview.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class SessionCreateRequest {

    @NotBlank
    private String companyName;

    @NotBlank
    private String industry;

    @NotBlank
    private String reviewType;

    @NotBlank
    private String situation;

    @NotBlank
    private String content;

    @NotBlank
    private String participationMode;
}
