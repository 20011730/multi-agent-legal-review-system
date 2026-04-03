package com.legalreview.repository;

import com.legalreview.domain.DebateMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DebateMessageRepository extends JpaRepository<DebateMessage, Long> {

    List<DebateMessage> findBySessionIdOrderByRoundAscIdAsc(Long sessionId);
}
