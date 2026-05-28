package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Phase 10.79 — verdict 신뢰도 카드 하단의 사용자 피드백 (👍/👎 + 자유 의견).
 * 검토 결과 품질 개선용 정성 지표 수집. 사용자 식별 정보는 저장하지 않음 (세션 단위).
 * ddl-auto=update 환경에서 자동 CREATE TABLE.
 */
@Entity
@Table(name = "feedback_entries",
       indexes = {
           @Index(name = "idx_feedback_session_id", columnList = "session_id"),
           @Index(name = "idx_feedback_created_at", columnList = "createdAt")
       })
@Getter
@Setter
@NoArgsConstructor
public class FeedbackEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 검토 세션 ID. */
    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    /** "up" (도움이 되었어요) / "down" (아쉬워요). */
    @Column(nullable = false, length = 8)
    private String rating;

    /** 사용자 자유 의견 (선택). */
    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
