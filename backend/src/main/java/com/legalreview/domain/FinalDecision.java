package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "final_decisions")
@Getter
@Setter
@NoArgsConstructor
public class FinalDecision {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false, unique = true)
    private ReviewSession session;

    @Column(nullable = false)
    private String verdict;

    @Column(nullable = false)
    private String riskLevel;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String summary;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String recommendation;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String revisedContent;

    @OneToMany(mappedBy = "finalDecision", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Risk> risks = new ArrayList<>();
}
