package com.legalreview.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class ProfileUpdateRequest {

    @NotBlank(message = "기업명을 입력해주세요")
    private String companyName;

    private String industry;
    private String companySize;
    private String website;
    private String description;
    private List<String> reviewTypes;

    // 마케팅
    private String mainProducts;
    private String targetMarket;
    private String competitorInfo;

    // 계약
    private String standardContracts;
    private String keyPartners;
    private String regulatoryRequirements;

    // 보도자료
    private String irContact;
    private String prHistory;
    private String stakeholders;
}
