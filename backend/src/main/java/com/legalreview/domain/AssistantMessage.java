package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "assistant_messages",
        indexes = {
                @Index(name = "idx_assistant_messages_session_order", columnList = "session_id, message_order"),
                @Index(name = "idx_assistant_messages_session_created", columnList = "session_id, created_at")
        }
)
@Getter
@Setter
@NoArgsConstructor
public class AssistantMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private ReviewSession session;

    @Column(nullable = false, length = 20)
    private String role;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "message_order", nullable = false)
    private int messageOrder;

    @Column(nullable = false, length = 30)
    private String status = "COMPLETED";

    @Column(name = "client_request_id", length = 80)
    private String clientRequestId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
