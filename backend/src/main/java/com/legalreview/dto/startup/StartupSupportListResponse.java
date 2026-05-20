package com.legalreview.dto.startup;

import java.time.Instant;
import java.util.List;

/**
 * 스타트업 지원사업 목록 응답 envelope (Phase 9.6 — page/size/sort/totalCount 확장).
 *
 * <p>기존(Phase 5) 의 {@code items/source/count/lastUpdated/filters} 필드는 그대로 유지하여
 * 기존 프론트가 깨지지 않도록 backward compat. 신규 필드는 모두 새로 추가:
 * <ul>
 *   <li>{@code totalCount} — 필터 적용 후 전체 건수 (페이지네이션 전)</li>
 *   <li>{@code page} — 현재 페이지 (1-base)</li>
 *   <li>{@code size} — 페이지당 건수</li>
 *   <li>{@code totalPages} — ceil(totalCount / size)</li>
 *   <li>{@code sort} — 적용된 정렬 옵션 (latest / deadline / recommend / title)</li>
 * </ul>
 *
 * <p>{@code items} 는 {@link StartupSupportItemView} 로 교체되어 {@code rawCategory},
 * {@code aiInsightHint} 메타 포함.
 */
public record StartupSupportListResponse(
        List<StartupSupportItemView> items,
        String source,
        int count,
        Instant lastUpdated,
        AppliedFilters filters,
        int totalCount,
        int page,
        int size,
        int totalPages,
        String sort,
        /** upstream(공공데이터) 원본 총 건수 — 알 수 없으면 0. (Phase 9.7) */
        int originTotal,
        /** backend 가 메모리에 로드한 건수 (필터 전, originTotal 의 일부). (Phase 9.7) */
        int loadedCount
) {
    /**
     * 적용된 필터 값 echo.
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
