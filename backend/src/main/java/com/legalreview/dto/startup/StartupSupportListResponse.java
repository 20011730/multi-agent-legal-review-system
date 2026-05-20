package com.legalreview.dto.startup;

import java.time.Instant;
import java.util.List;

/**
 * 스타트업 지원사업 목록 응답 envelope (Phase 5).
 *
 * 기존 단순 배열 응답 → 메타 포함 구조로 확장.
 * 이미 적용된 filters 를 응답에 echo 함으로써, 프론트가 어느 조건으로 매칭됐는지 확인 가능.
 *
 * 필드:
 *   - items:       지원사업 record 배열 (필수, 빈 배열 가능)
 *   - source:      데이터 출처 식별자 ("mock" / "k-startup" / "db" 등) — 향후 provider 교체 시 자동 갱신
 *   - count:       items.size() (편의 메타)
 *   - lastUpdated: 응답 생성 시각 (Instant ISO-8601) — Phase 5 단계는 매 호출마다 now()
 *                  추후 캐시/외부 fetch 도입 시 실제 데이터 갱신 시각으로 대체
 *   - filters:     이번 호출에 적용된 필터 (null 가능 필드 — 미지정은 null)
 */
public record StartupSupportListResponse(
        List<StartupSupportItem> items,
        String source,
        int count,
        Instant lastUpdated,
        AppliedFilters filters
) {
    /**
     * 적용된 필터 값 echo.
     * 입력하지 않은 필드는 null 그대로 직렬화 — 프론트가 어느 조건이 적용됐는지 명확히 확인 가능.
     */
    public record AppliedFilters(
            String category,
            String status,
            String region,
            String keyword
    ) {
        public static AppliedFilters of(String category, String status, String region, String keyword) {
            return new AppliedFilters(
                    blankToNull(category),
                    blankToNull(status),
                    blankToNull(region),
                    blankToNull(keyword)
            );
        }

        private static String blankToNull(String v) {
            return (v == null || v.isBlank()) ? null : v.trim();
        }
    }
}
