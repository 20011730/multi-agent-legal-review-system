package com.legalreview.controller;

import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.DebateResultResponse;
import com.legalreview.dto.response.SessionCreateResponse;
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
     */
    @PostMapping
    public ResponseEntity<SessionCreateResponse> createSession(
            @Valid @RequestBody SessionCreateRequest request) {
        SessionCreateResponse response = sessionService.createSession(request);
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
