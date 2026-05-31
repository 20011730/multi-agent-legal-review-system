package com.legalreview.repository;

import com.legalreview.domain.AssistantMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AssistantMessageRepository extends JpaRepository<AssistantMessage, Long> {

    List<AssistantMessage> findBySessionIdOrderByMessageOrderAscIdAsc(Long sessionId);

    long countBySessionId(Long sessionId);

    Optional<AssistantMessage> findFirstBySessionIdAndRoleAndClientRequestIdOrderByIdAsc(
            Long sessionId,
            String role,
            String clientRequestId
    );
}
