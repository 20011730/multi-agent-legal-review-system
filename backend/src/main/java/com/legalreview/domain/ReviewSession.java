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
     *  ROUND1_BIZ, ROUND1_LEGAL, WAITING_FOR_USER_R1,
     *  ROUND2_BIZ, ROUND2_LEGAL, WAITING_FOR_USER_R2, ROUND3_BIZ, ROUND3_LEGAL,
     *  JUDGING, COLLECTING_EVIDENCE
     *  완료 후 null로 초기화됨 */
    @Column(length = 30)
    private String analysisPhase;

    // ── 실험 추적 메타 (app.rag.experiment.enabled=true 일 때만 채워짐) ──
    /** 실험 태그 — e.g. "rag-law3-case2-v1", "baseline-openapi-v1". null이면 미참여. */
    @Column(length = 80)
    private String experimentTag;

    /** 분석 시점의 RAG 활성 여부 (스냅샷). null 가능. */
    @Column
    private Boolean ragEnabled;

    /** 분석 시점의 법령 top-k (스냅샷). null 가능. */
    @Column
    private Integer ragTopkLaw;

    /** 분석 시점의 판례 top-k (스냅샷). null 가능. */
    @Column
    private Integer ragTopkCase;

    /** 분석 시작 시각. AnalysisAsyncRunner.runAnalysis 진입 시 기록. */
    @Column
    private LocalDateTime analysisStartedAt;

    /** 분석 종료 시각. status=COMPLETED 또는 FAILED로 전환 시 기록. */
    @Column
    private LocalDateTime analysisCompletedAt;

    /** 분석 소요 시간(ms). 종료 시점에 함께 계산해 저장 — 조회 시 재계산 불필요. */
    @Column
    private Long analysisDurationMs;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("round ASC, id ASC")
    private List<DebateMessage> messages = new ArrayList<>();

    @OneToOne(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    private FinalDecision finalDecision;
}
