package com.legalreview.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 지원사업 큐레이션에서 진입한 진단 요청의 컨텍스트 (Phase 10.4).
 *
 * <p>모든 필드 nullable. validation 없음 — 일반 진단(컨텍스트 없음)에 대한 회귀 위험 0.
 * <p>{@link com.legalreview.dto.request.SessionCreateRequest#getStartupContext()} 내부에서 사용.
 */
@Getter
@Setter
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class StartupContextDto {
    private String id;
    private String title;
    private String organization;
    private String category;
    private String target;
    private String fieldSummary;
    private String deadline;
    private String applyUrl;
    /** "k-startup-service" / "k-startup-news" / "k-startup-mixed" / "mock" */
    private String source;
    private String aiInsightHint;
    private String legalReviewHint;
}
