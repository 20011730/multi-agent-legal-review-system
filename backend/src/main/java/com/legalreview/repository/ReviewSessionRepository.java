package com.legalreview.repository;

import com.legalreview.domain.ReviewSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewSessionRepository extends JpaRepository<ReviewSession, Long> {

    List<ReviewSession> findByUserIdOrderByCreatedAtDesc(Long userId);
}
