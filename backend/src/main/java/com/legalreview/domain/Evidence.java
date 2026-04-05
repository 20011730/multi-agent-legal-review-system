package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 법령/판례 근거 엔티티.
 * 세션별로 검색된 법적 근거 자료를 저장한다.
 */
@Entity
@Table(name = "evidences")
@Getter
@Setter
@NoArgsConstructor
public class Evidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private ReviewSession session;

    /** 근거 유형: LAW(법령) 또는 CASE(판례) */
    @Column(nullable = false, length = 10)
    private String sourceType;

    /** 법령명 또는 사건명 */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String title;

    /** 법령일련번호 또는 사건번호 */
    @Column(length = 100)
    private String referenceId;

    /** 소관부처 또는 법원명 */
    @Column(length = 200)
    private String articleOrCourt;

    /** 요약 설명 */
    @Column(columnDefinition = "TEXT")
    private String summary;

    /** 원문 링크 URL */
    @Column(columnDefinition = "TEXT")
    private String url;

    /** 이 근거가 선택된 이유 */
    @Column(columnDefinition = "TEXT")
    private String relevanceReason;

    /** 인용 텍스트 (해당되는 경우) */
    @Column(columnDefinition = "TEXT")
    private String quotedText;

    /** 관련 라운드 번호 (null이면 전체 세션 관련) */
    @Column
    private Integer roundNumber;

    /** 관련 에이전트 이름 (null이면 전체 세션 관련) */
    @Column(length = 50)
    private String agentName;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
