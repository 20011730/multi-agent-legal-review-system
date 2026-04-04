package com.legalreview.dto.response;

import com.legalreview.domain.CompanyProfile;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Getter
@AllArgsConstructor
public class ProfileResponse {

    // 사용자 기본 정보
    private Long userId;
    private String name;
    private String email;

    // 기업 프로필
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

    /**
     * CompanyProfile 엔티티에서 응답 DTO 생성.
     * 프로필이 아직 없으면 사용자 기본 정보만 포함한 빈 프로필 반환.
     */
    public static ProfileResponse from(com.legalreview.domain.User user, CompanyProfile profile) {
        if (profile == null) {
            return new ProfileResponse(
                    user.getId(), user.getName(), user.getEmail(),
                    user.getCompanyName(), "", "", "", "",
                    Collections.emptyList(),
                    "", "", "", "", "", "", "", "", ""
            );
        }

        List<String> types = (profile.getReviewTypes() != null && !profile.getReviewTypes().isEmpty())
                ? Arrays.asList(profile.getReviewTypes().split(","))
                : Collections.emptyList();

        return new ProfileResponse(
                user.getId(), user.getName(), user.getEmail(),
                profile.getCompanyName(),
                profile.getIndustry(),
                profile.getCompanySize(),
                profile.getWebsite(),
                profile.getDescription(),
                types,
                profile.getMainProducts(),
                profile.getTargetMarket(),
                profile.getCompetitorInfo(),
                profile.getStandardContracts(),
                profile.getKeyPartners(),
                profile.getRegulatoryRequirements(),
                profile.getIrContact(),
                profile.getPrHistory(),
                profile.getStakeholders()
        );
    }
}
