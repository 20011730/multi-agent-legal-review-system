package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

@Getter
@AllArgsConstructor
public class FinalDecisionDto {

    private String verdict;
    private String riskLevel;
    private List<RiskItemDto> risks;
    private String summary;
    private String recommendation;
    private String revisedContent;
}
