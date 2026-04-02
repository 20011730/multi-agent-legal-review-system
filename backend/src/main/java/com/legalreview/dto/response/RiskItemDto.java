package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class RiskItemDto {

    private String category;
    private String level;
    private String description;
}
