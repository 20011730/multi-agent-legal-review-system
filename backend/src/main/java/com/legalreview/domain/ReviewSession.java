package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "review_sessions")
@Getter
@Setter
@NoArgsConstructor
public class ReviewSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false)
    private String companyName;

    @Column(nullable = false)
    private String industry;

    @Column(nullable = false)
    private String reviewType;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String situation;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false)
    private String participationMode;

    @Column(nullable = false)
    private String status = "CREATED";

    /** 분석 진행 단계 (폴링 UI용):
     *  ROUND1_BIZ, ROUND1_LEGAL, ROUND2_BIZ, ROUND2_LEGAL, ROUND3_BIZ, ROUND3_LEGAL,
     *  JUDGING, COLLECTING_EVIDENCE
     *  완료 후 null로 초기화됨 */
    @Column(length = 30)
    private String analysisPhase;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("round ASC, id ASC")
    private List<DebateMessage> messages = new ArrayList<>();

    @OneToOne(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    private FinalDecision finalDecision;
}
