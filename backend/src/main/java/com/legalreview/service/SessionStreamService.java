package com.legalreview.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Phase 10.23 — 세션 진행 이벤트 SSE 브로드캐스터.
 *
 * <p>역할:
 * <ul>
 *   <li>{@link #subscribe(Long)} — sessionId 별 {@link SseEmitter} 발급</li>
 *   <li>{@link #publish(Long, String, Object)} — 이벤트 발행 (event name 지정)</li>
 *   <li>{@link #publishSnapshot/Status/Message/Progress/Completed/Error} — 의미별 헬퍼</li>
 *   <li>heartbeat — 매 15초마다 모든 emitter 에 keepalive 전송</li>
 * </ul>
 *
 * <p>주의:
 * <ul>
 *   <li>secret(API key, serviceKey, OLLAMA URL 원문, bearer token) 은 절대 payload 에 포함하지 않음.
 *       호출 측 책임이지만 본 클래스도 로그에 payload 전체를 dump 하지 않음.</li>
 *   <li>각 emitter 는 최대 30분 후 자동 종료(timeout) → 프론트는 자동 재연결 권장.</li>
 *   <li>같은 sessionId 에 여러 emitter(여러 탭) 허용 — {@link CopyOnWriteArrayList} 로 동시성 안전.</li>
 * </ul>
 */
@Slf4j
@Service
public class SessionStreamService {

    private static final long EMITTER_TIMEOUT_MS = Duration.ofMinutes(30).toMillis();
    private static final long HEARTBEAT_INTERVAL_SEC = 15;

    private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "session-stream-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public SessionStreamService() {
        heartbeatExecutor.scheduleAtFixedRate(this::sendHeartbeatToAll,
                HEARTBEAT_INTERVAL_SEC, HEARTBEAT_INTERVAL_SEC, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        heartbeatExecutor.shutdownNow();
        emitters.values().forEach(list -> list.forEach(SseEmitter::complete));
        emitters.clear();
    }

    /** sessionId 에 새 emitter 를 등록하고 반환. 호출자는 즉시 snapshot 을 publish 해야 함. */
    public SseEmitter subscribe(Long sessionId) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> list = emitters.computeIfAbsent(sessionId, k -> new CopyOnWriteArrayList<>());
        list.add(emitter);

        emitter.onCompletion(() -> remove(sessionId, emitter));
        emitter.onTimeout(() -> {
            remove(sessionId, emitter);
            emitter.complete();
        });
        emitter.onError(t -> remove(sessionId, emitter));

        // 연결 직후 1회 hello — 클라이언트가 onopen 시 즉시 응답 확인 가능
        try {
            emitter.send(SseEmitter.event()
                    .name("heartbeat")
                    .data(Map.of("sessionId", sessionId, "phase", "connected")));
        } catch (IOException e) {
            remove(sessionId, emitter);
        }

        log.info("[SSE] subscribe — sessionId={}, total emitters={}", sessionId, list.size());
        return emitter;
    }

    private void remove(Long sessionId, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> list = emitters.get(sessionId);
        if (list != null) {
            list.remove(emitter);
            if (list.isEmpty()) emitters.remove(sessionId);
        }
    }

    /** 임의 이벤트 발행. 실패한 emitter 는 자동 제거. */
    public void publish(Long sessionId, String eventName, Object payload) {
        CopyOnWriteArrayList<SseEmitter> list = emitters.get(sessionId);
        if (list == null || list.isEmpty()) return;
        for (SseEmitter emitter : list) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(payload));
            } catch (Exception e) {
                // payload 자체는 로그에 dump 하지 않음 (민감정보 포함 가능성).
                log.debug("[SSE] send 실패 — sessionId={}, event={}, err={}",
                        sessionId, eventName, e.getMessage());
                remove(sessionId, emitter);
                try { emitter.complete(); } catch (Exception ignored) { /* */ }
            }
        }
    }

    /* ──────────────── 의미별 헬퍼 ──────────────── */

    public void publishSnapshot(Long sessionId, Object snapshotPayload) {
        publish(sessionId, "snapshot", snapshotPayload);
    }

    public void publishStatus(Long sessionId, String status, Integer progress, String label) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "status");
        payload.put("sessionId", sessionId);
        payload.put("status", status);
        if (progress != null) payload.put("progress", progress);
        if (label != null) payload.put("label", label);
        publish(sessionId, "status", payload);
    }

    public void publishProgress(Long sessionId, int progress, String label) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "progress");
        payload.put("sessionId", sessionId);
        payload.put("progress", progress);
        if (label != null) payload.put("label", label);
        publish(sessionId, "progress", payload);
    }

    public void publishMessage(Long sessionId, Map<String, Object> messagePayload) {
        Map<String, Object> wrapped = new LinkedHashMap<>();
        wrapped.put("type", "message");
        wrapped.put("sessionId", sessionId);
        wrapped.put("message", messagePayload);
        publish(sessionId, "message", wrapped);
    }

    public void publishCompleted(Long sessionId, int messageCount) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "completed");
        payload.put("sessionId", sessionId);
        payload.put("status", "COMPLETED");
        payload.put("progress", 100);
        payload.put("messageCount", messageCount);
        publish(sessionId, "completed", payload);
    }

    public void publishError(Long sessionId, String message) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "error");
        payload.put("sessionId", sessionId);
        // 메시지 자체는 호출자가 마스킹해 전달해야 함.
        payload.put("message", message == null ? "분석 중 오류가 발생했습니다." : message);
        publish(sessionId, "error", payload);
    }

    private void sendHeartbeatToAll() {
        if (emitters.isEmpty()) return;
        long now = System.currentTimeMillis();
        for (Map.Entry<Long, CopyOnWriteArrayList<SseEmitter>> entry : emitters.entrySet()) {
            Long sessionId = entry.getKey();
            for (SseEmitter emitter : entry.getValue()) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("heartbeat")
                            .data(Map.of("type", "heartbeat", "sessionId", sessionId, "at", now)));
                } catch (Exception e) {
                    remove(sessionId, emitter);
                    try { emitter.complete(); } catch (Exception ignored) { /* */ }
                }
            }
        }
    }
}
