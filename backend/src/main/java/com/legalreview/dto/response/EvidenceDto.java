package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class EvidenceDto {

    private String sourceType;
    private String title;
    private String referenceId;
    private String articleOrCourt;
    private String summary;
    private String url;
    private String relevanceReason;
    private String quotedText;
}
