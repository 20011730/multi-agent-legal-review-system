package com.legalreview.repository;

import com.legalreview.domain.DebateMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DebateMessageRepository extends JpaRepository<DebateMessage, Long> {

    List<DebateMessage> findBySessionIdOrderByRoundAscIdAsc(Long sessionId);

    long countBySessionId(Long sessionId);

    // Phase 10.18 — 재분석 시작 시 이전 토론 메시지 일괄 삭제용
    void deleteBySessionId(Long sessionId);
}
