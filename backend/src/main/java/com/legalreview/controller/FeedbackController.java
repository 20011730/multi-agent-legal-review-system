package com.legalreview.controller;

import com.legalreview.domain.FeedbackEntry;
import com.legalreview.repository.FeedbackEntryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Phase 10.79 — verdict 신뢰도 카드 피드백 저장 + 개발자 확인용 GET.
 * 사용자 화면에는 success/duplicate 만 반환. 본 라우트는 dev-friendly (auth 미요구).
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/sessions/{sessionId}/feedback")
public class FeedbackController {

    private final FeedbackEntryRepository feedbackRepository;

    @PostMapping
    public ResponseEntity<Map<String, Object>> submitFeedback(
            @PathVariable Long sessionId,
            @RequestBody Map<String, Object> body) {
        // 1) 중복 제출 방지 — 동일 세션에 이미 피드백이 있으면 200 + alreadySubmitted=true
        long existing = feedbackRepository.countBySessionId(sessionId);
        if (existing > 0) {
            log.info("[feedback] 중복 제출 방지 (sessionId={}, existing={})", sessionId, existing);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("sessionId", sessionId);
            resp.put("alreadySubmitted", true);
            resp.put("message", "이미 피드백을 받았습니다. 감사합니다.");
            return ResponseEntity.ok(resp);
        }

        // 2) rating 검증
        String rating = body.get("rating") == null ? "" : body.get("rating").toString().trim();
        if (!"up".equals(rating) && !"down".equals(rating)) {
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("error", "rating 은 'up' 또는 'down' 이어야 합니다.");
            return ResponseEntity.badRequest().body(resp);
        }

        // 3) note (선택) — 최대 2000자
        String note = body.get("note") == null ? null : body.get("note").toString();
        if (note != null && note.length() > 2000) note = note.substring(0, 2000);

        // 4) 저장
        FeedbackEntry entry = new FeedbackEntry();
        entry.setSessionId(sessionId);
        entry.setRating(rating);
        entry.setNote(note);
        FeedbackEntry saved = feedbackRepository.save(entry);

        log.info("[feedback] 저장 — sessionId={}, rating={}, noteLen={}",
                sessionId, rating, note == null ? 0 : note.length());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("sessionId", sessionId);
        resp.put("id", saved.getId());
        resp.put("alreadySubmitted", false);
        resp.put("message", "피드백이 저장되었습니다. 감사합니다.");
        return ResponseEntity.ok(resp);
    }

    /**
     * 개발자 확인용 — 특정 세션의 피드백 목록.
     */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> listFeedback(@PathVariable Long sessionId) {
        List<FeedbackEntry> entries = feedbackRepository.findBySessionIdOrderByIdAsc(sessionId);
        List<Map<String, Object>> out = entries.stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getId());
            m.put("sessionId", e.getSessionId());
            m.put("rating", e.getRating());
            m.put("note", e.getNote());
            m.put("createdAt", e.getCreatedAt());
            return m;
        }).toList();
        return ResponseEntity.ok(out);
    }
}
