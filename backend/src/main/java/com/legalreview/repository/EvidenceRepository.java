package com.legalreview.repository;

import com.legalreview.domain.Evidence;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EvidenceRepository extends JpaRepository<Evidence, Long> {

    List<Evidence> findBySessionIdOrderByIdAsc(Long sessionId);
}
