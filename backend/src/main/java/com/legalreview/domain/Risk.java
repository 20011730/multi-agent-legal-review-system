package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "risks")
@Getter
@Setter
@NoArgsConstructor
public class Risk {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "final_decision_id", nullable = false)
    private FinalDecision finalDecision;

    @Column(nullable = false)
    private String category;

    @Column(nullable = false)
    private String level;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String description;
}
