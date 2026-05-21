package com.legalreview.controller;

import com.legalreview.domain.DebateMessage;
import com.legalreview.domain.ReviewSession;
import com.legalreview.repository.DebateMessageRepository;
import com.legalreview.repository.ReviewSessionRepository;
import com.legalreview.service.SessionStreamService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Phase 10.23 — SSE 엔드포인트.
 *
 * <p>{@code GET /api/sessions/{sessionId}/stream} — text/event-stream 반환.
 * 연결 직후 snapshot 이벤트를 1회 발행한 뒤, 분석 진행에 따라 message/status/completed/error 이벤트가
 * {@link SessionStreamService} 를 통해 push 된다.
 *
 * <p>기존 {@code /api/sessions/{id}/status} 폴링 엔드포인트와 병행 사용 가능 — 프론트는 SSE 실패 시
 * polling 으로 fallback.
 */
@Slf4j
@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionStreamController {

    private final SessionStreamService streamService;
    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;

    @GetMapping(value = "/{sessionId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@PathVariable Long sessionId) {
        SseEmitter emitter = streamService.subscribe(sessionId);

        // 연결 직후 snapshot 비동기 발행 (subscribe 가 반환된 뒤 publish 가능).
        // 같은 스레드에서 즉시 publish 해도 동작하지만, 일부 환경에서 emitter 초기화 race 를 피하기 위해 직후 발행.
        publishInitialSnapshot(sessionId);

        // Response 헤더 추가 — proxy/Nginx 가 SSE 를 buffering 하지 않도록.
        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(emitter);
    }

    private void publishInitialSnapshot(Long sessionId) {
        try {
            ReviewSession session = sessionRepository.findById(sessionId).orElse(null);
            if (session == null) {
                streamService.publishError(sessionId, "세션을 찾을 수 없습니다.");
                return;
            }
            List<DebateMessage> messages = messageRepository.findBySessionIdOrderByRoundAscIdAsc(sessionId);

            Map<String, Object> snapshot = new LinkedHashMap<>();
            snapshot.put("type", "snapshot");
            snapshot.put("sessionId", sessionId);
            snapshot.put("status", session.getStatus());
            snapshot.put("analysisPhase", session.getAnalysisPhase());
            snapshot.put("messageCount", messages.size());
            snapshot.put("messages", messages.stream().map(SessionStreamController::toMessagePayload).toList());

            streamService.publishSnapshot(sessionId, snapshot);
        } catch (Exception e) {
            log.warn("[SSE] snapshot 발행 실패 — sessionId={}, err={}", sessionId, e.getMessage());
        }
    }

    /**
     * DebateMessage → SSE payload. secret/본문 마스킹은 호출자 책임이지만, 본 메서드는 도메인 필드만 노출함.
     */
    public static Map<String, Object> toMessagePayload(DebateMessage m) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", m.getId());
        p.put("agentId", m.getAgentId());
        p.put("agentName", m.getAgentName());
        p.put("content", m.getContent());
        p.put("type", m.getType());
        p.put("round", m.getRound());
        p.put("stance", m.getStance());
        p.put("evidenceSummary", m.getEvidenceSummary());
        return p;
    }
}
