package com.legalreview.service;

import com.legalreview.domain.CompanyProfile;
import com.legalreview.domain.User;
import com.legalreview.dto.request.ProfileUpdateRequest;
import com.legalreview.dto.response.ProfileResponse;
import com.legalreview.repository.CompanyProfileRepository;
import com.legalreview.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class ProfileService {

    private final UserRepository userRepository;
    private final CompanyProfileRepository profileRepository;

    /**
     * 사용자 프로필 조회.
     * 프로필이 아직 없으면 사용자 기본 정보만 포함한 빈 프로필을 반환한다.
     */
    @Transactional(readOnly = true)
    public ProfileResponse getProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다: " + userId));

        CompanyProfile profile = profileRepository.findByUserId(userId).orElse(null);

        return ProfileResponse.from(user, profile);
    }

    /**
     * 사용자 프로필 저장/수정.
     * 기존 프로필이 있으면 업데이트, 없으면 새로 생성한다.
     */
    @Transactional
    public ProfileResponse updateProfile(Long userId, ProfileUpdateRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다: " + userId));

        CompanyProfile profile = profileRepository.findByUserId(userId)
                .orElseGet(() -> {
                    CompanyProfile newProfile = new CompanyProfile();
                    newProfile.setUser(user);
                    return newProfile;
                });

        // 기본 정보
        profile.setCompanyName(request.getCompanyName());
        profile.setIndustry(request.getIndustry());
        profile.setCompanySize(request.getCompanySize());
        profile.setWebsite(request.getWebsite());
        profile.setDescription(request.getDescription());

        // 검토 유형 (리스트 → 콤마 구분 문자열)
        if (request.getReviewTypes() != null && !request.getReviewTypes().isEmpty()) {
            profile.setReviewTypes(String.join(",", request.getReviewTypes()));
        } else {
            profile.setReviewTypes("");
        }

        // 마케팅
        profile.setMainProducts(request.getMainProducts());
        profile.setTargetMarket(request.getTargetMarket());
        profile.setCompetitorInfo(request.getCompetitorInfo());

        // 계약
        profile.setStandardContracts(request.getStandardContracts());
        profile.setKeyPartners(request.getKeyPartners());
        profile.setRegulatoryRequirements(request.getRegulatoryRequirements());

        // 보도자료
        profile.setIrContact(request.getIrContact());
        profile.setPrHistory(request.getPrHistory());
        profile.setStakeholders(request.getStakeholders());

        profile.setUpdatedAt(LocalDateTime.now());
        profileRepository.save(profile);

        // User의 companyName도 동기화
        user.setCompanyName(request.getCompanyName());
        userRepository.save(user);

        return ProfileResponse.from(user, profile);
    }
}
