package com.legalreview.controller;

import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.DebateResultResponse;
import com.legalreview.dto.response.SessionCreateResponse;
import com.legalreview.dto.response.SessionStatusResponse;
import com.legalreview.service.OllamaClient;
import com.legalreview.service.SessionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;
    private final OllamaClient ollamaClient;

    /**
     * 세션 생성 API
     * 프론트 /input 페이지에서 호출
     * X-User-Id 헤더로 사용자 식별 (JWT 도입 전 임시 방식)
     */
    @PostMapping
    public ResponseEntity<SessionCreateResponse> createSession(
            @Valid @RequestBody SessionCreateRequest request,
            @RequestHeader(value = "X-User-Id", required = false) Long userId) {
        SessionCreateResponse response = sessionService.createSession(request, userId);
        return ResponseEntity.ok(response);
    }

    /**
     * 세션 상태 조회 API (폴링용)
     * 프론트 /result 페이지에서 분석 진행 상태를 확인
     */
    @GetMapping("/{sessionId}/status")
    public ResponseEntity<SessionStatusResponse> getSessionStatus(
            @PathVariable Long sessionId) {
        SessionStatusResponse response = sessionService.getSessionStatus(sessionId);
        return ResponseEntity.ok(response);
    }

    /**
     * 최신 토론 결과 조회 API
     * 프론트 /result, /verdict 페이지에서 호출
     */
    @GetMapping("/{sessionId}/debates/latest")
    public ResponseEntity<DebateResultResponse> getLatestDebateResult(
            @PathVariable Long sessionId) {
        DebateResultResponse response = sessionService.getLatestDebateResult(sessionId);
        return ResponseEntity.ok(response);
    }

    /**
     * Ollama 연결 테스트 (개발용)
     * GET /api/sessions/ollama/health
     */
    @GetMapping("/ollama/health")
    public ResponseEntity<Map<String, Object>> ollamaHealth() {
        boolean available = ollamaClient.isAvailable();
        return ResponseEntity.ok(Map.of(
                "ollamaAvailable", available,
                "message", available ? "Ollama 서버 연결 성공" : "Ollama 서버 연결 실패"
        ));
    }

    /**
     * Phase 10.9 — 라운드 사이 사용자 추가 질문 저장.
     * body: { round?, targetAgent?, message }
     */
    @PostMapping("/{sessionId}/questions")
    public ResponseEntity<Map<String, Object>> addFollowUpQuestion(
            @PathVariable Long sessionId,
            @RequestBody Map<String, Object> body) {
        Object msg = body == null ? null : body.get("message");
        if (msg == null || msg.toString().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "message 필드가 필요합니다"));
        }
        int saved = sessionService.appendFollowUpQuestion(sessionId, body);
        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId,
                "savedCount", saved,
                "message", "추가 질문이 저장되었습니다. 다음 재검토/최종 결과 생성 시 참고됩니다."
        ));
    }

    /**
     * Phase 10.85 — 저장된 후속 질문 수정/삭제.
     * body: { index: number, message?: string|null }  (message 가 null 또는 누락이면 삭제)
     */
    @RequestMapping(value = "/{sessionId}/questions", method = {RequestMethod.PATCH, RequestMethod.DELETE})
    public ResponseEntity<Map<String, Object>> updateFollowUpQuestion(
            @PathVariable Long sessionId,
            @RequestBody(required = false) Map<String, Object> body) {
        if (body == null || !body.containsKey("index")) {
            return ResponseEntity.badRequest().body(Map.of("error", "index 필드가 필요합니다"));
        }
        int index;
        try {
            index = ((Number) body.get("index")).intValue();
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(Map.of("error", "index 는 정수여야 합니다"));
        }
        Object raw = body.get("message");
        String newMessage = raw == null ? null : String.valueOf(raw);
        try {
            int remaining = sessionService.updateFollowUpQuestion(sessionId, index, newMessage);
            if (remaining < 0) {
                return ResponseEntity.status(409).body(Map.of(
                        "error", "이미 반영되었거나 진행 중인 질문은 수정/삭제할 수 없습니다."));
            }
            return ResponseEntity.ok(Map.of(
                    "sessionId", sessionId,
                    "remainingCount", remaining,
                    "message", newMessage == null ? "질문이 삭제되었습니다." : "질문이 수정되었습니다."));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
        }
    }

    /**
     * Phase 10.17 — 저장된 followUpQuestions 를 기존 세션에 반영하여 재분석 트리거.
     * 기존 session 의 startupContext / startupExtras / attachments / followUpQuestions 모두 포함.
     * 비동기 분석 시작, status="REANALYZING" 으로 설정.
     */
    @PostMapping("/{sessionId}/reanalyze")
    public ResponseEntity<Map<String, Object>> reanalyzeSession(@PathVariable Long sessionId) {
        try {
            Map<String, Object> result = sessionService.reanalyze(sessionId);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
        } catch (Exception ex) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "재검토 실행에 실패했습니다.",
                    "detail", String.valueOf(ex.getMessage())));
        }
    }

    @PostMapping("/{sessionId}/assistant/messages")
    public ResponseEntity<Map<String, Object>> askAssistant(
            @PathVariable Long sessionId,
            @RequestBody(required = false) Map<String, Object> body) {
        Object raw = body == null ? null : body.get("message");
        String message = raw == null ? "" : String.valueOf(raw).trim();
        Object rawClientRequestId = body == null ? null : body.get("clientRequestId");
        String clientRequestId = rawClientRequestId == null ? "" : String.valueOf(rawClientRequestId).trim();
        if (message.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "질문을 입력해 주세요."));
        }
        if (message.length() > 1200) {
            return ResponseEntity.badRequest().body(Map.of("error", "질문은 1200자 이하로 입력해 주세요."));
        }
        try {
            return ResponseEntity.ok(sessionService.askAssistant(sessionId, message, clientRequestId));
        } catch (IllegalArgumentException ex) {
            String msg = ex.getMessage() == null ? "" : ex.getMessage();
            if (msg.startsWith("Session not found")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "세션을 찾을 수 없습니다."));
            }
            return ResponseEntity.badRequest().body(Map.of("error", msg.isBlank() ? "요청을 처리할 수 없습니다." : msg));
        } catch (Exception ex) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "비서 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."));
        }
    }

    @GetMapping("/{sessionId}/assistant/messages")
    public ResponseEntity<Map<String, Object>> getAssistantMessages(@PathVariable Long sessionId) {
        try {
            return ResponseEntity.ok(Map.of(
                    "sessionId", sessionId,
                    "messages", sessionService.getAssistantMessages(sessionId)
            ));
        } catch (IllegalArgumentException ex) {
            String msg = ex.getMessage() == null ? "" : ex.getMessage();
            if (msg.startsWith("Session not found")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "세션을 찾을 수 없습니다."));
            }
            return ResponseEntity.badRequest().body(Map.of("error", msg.isBlank() ? "요청을 처리할 수 없습니다." : msg));
        } catch (Exception ex) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "비서 상담 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
        }
    }
}
