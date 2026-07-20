package com.legalreview.repository;

import com.legalreview.domain.FeedbackEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FeedbackEntryRepository extends JpaRepository<FeedbackEntry, Long> {
    List<FeedbackEntry> findBySessionIdOrderByIdAsc(Long sessionId);
    long countBySessionId(Long sessionId);
}
