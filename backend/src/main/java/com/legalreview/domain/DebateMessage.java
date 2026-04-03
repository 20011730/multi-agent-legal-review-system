package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "debate_messages")
@Getter
@Setter
@NoArgsConstructor
public class DebateMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private ReviewSession session;

    @Column(nullable = false)
    private String agentId;

    @Column(nullable = false)
    private String agentName;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false)
    private String type;

    @Column(nullable = false)
    private int round;

    @Column(nullable = false)
    private String stance;

    @Column(columnDefinition = "TEXT")
    private String evidenceSummary;
}
