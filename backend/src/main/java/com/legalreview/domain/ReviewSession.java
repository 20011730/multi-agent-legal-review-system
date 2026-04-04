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

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("round ASC, id ASC")
    private List<DebateMessage> messages = new ArrayList<>();

    @OneToOne(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    private FinalDecision finalDecision;
}
