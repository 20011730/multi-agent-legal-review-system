package com.legalreview.controller;

import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.DebateResultResponse;
import com.legalreview.dto.response.SessionCreateResponse;
import com.legalreview.dto.response.SessionStatusResponse;
import com.legalreview.service.SessionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;

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
}
