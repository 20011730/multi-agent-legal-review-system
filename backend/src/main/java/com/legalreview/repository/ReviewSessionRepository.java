package com.legalreview.repository;

import com.legalreview.domain.ReviewSession;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewSessionRepository extends JpaRepository<ReviewSession, Long> {
}
