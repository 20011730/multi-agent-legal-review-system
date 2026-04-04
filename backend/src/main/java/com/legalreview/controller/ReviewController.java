package com.legalreview.controller;

import com.legalreview.dto.response.ReviewDetailResponse;
import com.legalreview.dto.response.ReviewSummaryDto;
import com.legalreview.service.ReviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reviews")
@RequiredArgsConstructor
public class ReviewController {

    private final ReviewService reviewService;

    /**
     * 검토 기록 목록 조회
     * GET /api/reviews?userId={userId}
     */
    @GetMapping
    public ResponseEntity<?> getReviewList(
            @RequestHeader(value = "X-User-Id", required = false) Long userId) {
        if (userId == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "사용자 정보가 필요합니다"));
        }

        List<ReviewSummaryDto> reviews = reviewService.getReviewList(userId);
        return ResponseEntity.ok(reviews);
    }

    /**
     * 검토 세션 상세 조회 (재열람)
     * GET /api/reviews/{sessionId}
     */
    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getReviewDetail(@PathVariable Long sessionId) {
        try {
            ReviewDetailResponse response = reviewService.getReviewDetail(sessionId);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
