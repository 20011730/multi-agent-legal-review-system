package com.legalreview.dto.startup;

/**
 * envelope 응답에서 한 건을 표현하는 view DTO (Phase 9.6).
 *
 * <p>{@link StartupSupportItem} 12개 필드를 그대로 직렬화하면서, 다음 두 가지 메타를 추가한다:
 * <ul>
 *   <li>{@code rawCategory} — provider 가 매핑한 원문 카테고리 (예: news API → "창업소식")</li>
 *   <li>{@code aiInsightHint} — backend 가 가볍게 계산한 insight 카테고리 힌트 (예: "투자", "R&D").
 *       프론트의 실제 AI 요약/추천은 별도 util(`startupSupportInsight.ts`) 에서 deterministic 계산.</li>
 * </ul>
 *
 * <p>이 record 를 추가함으로써 기존 {@link StartupSupportItem} 시그니처를 깨지 않고 mock provider 의
 * 15개 생성 호출을 그대로 유지할 수 있다.
 */
public record StartupSupportItemView(
        String id,
        String title,
        String organization,
        String category,        // ← inferred(추론) 카테고리 (필터 기준)
        String region,
        String target,
        String fieldSummary,
        String maxAmount,
        String status,          // ← deadline 기반 자동 재계산된 값
        String deadline,
        String applyUrl,
        String recommendReason,
        String rawCategory,     // ← provider 원본 (없으면 null)
        String aiInsightHint,   // ← 백엔드 힌트 (없으면 null)
        String itemSource       // ← 항목별 출처 ("k-startup-news" / "k-startup-service" / "mock" 등)
) {
    public static StartupSupportItemView of(
            StartupSupportItem base,
            String inferredCategory,
            String autoStatus,
            String rawCategory,
            String aiInsightHint,
            String itemSource
    ) {
        return new StartupSupportItemView(
                base.id(),
                base.title(),
                base.organization(),
                inferredCategory != null ? inferredCategory : base.category(),
                base.region(),
                base.target(),
                base.fieldSummary(),
                base.maxAmount(),
                autoStatus != null ? autoStatus : base.status(),
                base.deadline(),
                base.applyUrl(),
                base.recommendReason(),
                rawCategory,
                aiInsightHint,
                itemSource
        );
    }
}
