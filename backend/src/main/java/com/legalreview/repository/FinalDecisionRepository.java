package com.legalreview.repository;

import com.legalreview.domain.FinalDecision;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FinalDecisionRepository extends JpaRepository<FinalDecision, Long> {

    Optional<FinalDecision> findBySessionId(Long sessionId);
}
