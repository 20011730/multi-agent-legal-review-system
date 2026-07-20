package com.legalreview.repository;

import com.legalreview.domain.Evidence;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EvidenceRepository extends JpaRepository<Evidence, Long> {

    List<Evidence> findBySessionIdOrderByIdAsc(Long sessionId);

    // Phase 10.18 — 재분석 시 이전 evidences 일괄 삭제
    void deleteBySessionId(Long sessionId);
}
