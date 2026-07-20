package com.legalreview.dto.startup;

/**
 * 스타트업 지원사업 1건 DTO (Phase 2 mock API).
 *
 * Phase 1 의 프론트 mock (mockStartupSupport.ts) 스키마와 동일 필드.
 * 추후 K-Startup / 공공데이터 API / DB 연동 시에도 본 DTO 를 그대로 사용.
 */
public record StartupSupportItem(
        String id,
        String title,
        String organization,
        String category,
        String region,
        String target,
        String fieldSummary,
        String maxAmount,
        String status,
        String deadline,
        String applyUrl,
        String recommendReason
) {
}
