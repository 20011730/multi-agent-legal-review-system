package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "company_profiles")
@Getter
@Setter
@NoArgsConstructor
public class CompanyProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    // 기본 정보
    private String companyName;
    private String industry;
    private String companySize;
    private String website;

    @Column(columnDefinition = "TEXT")
    private String description;

    // 검토 유형 (콤마 구분 저장: "marketing,press,contract")
    private String reviewTypes;

    // 마케팅·광고 관련
    @Column(columnDefinition = "TEXT")
    private String mainProducts;

    @Column(columnDefinition = "TEXT")
    private String targetMarket;

    @Column(columnDefinition = "TEXT")
    private String competitorInfo;

    // 계약서·약관 관련
    @Column(columnDefinition = "TEXT")
    private String standardContracts;

    @Column(columnDefinition = "TEXT")
    private String keyPartners;

    @Column(columnDefinition = "TEXT")
    private String regulatoryRequirements;

    // 보도자료·커뮤니케이션 관련
    private String irContact;

    @Column(columnDefinition = "TEXT")
    private String prHistory;

    @Column(columnDefinition = "TEXT")
    private String stakeholders;

    private LocalDateTime updatedAt = LocalDateTime.now();
}
