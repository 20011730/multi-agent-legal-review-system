package com.legalreview.dto.startup;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * K-Startup OpenAPI 단일 지원사업 항목 (Phase 8 placeholder).
 *
 * <p><b>주의</b>: 본 record 의 필드명은 <em>가설</em> 이다. 실제 K-Startup OpenAPI 응답
 * 의 원본 필드명 (예: {@code pbanc_sn}, {@code pbanc_titl}, {@code biz_pbanc_url}, {@code biz_prch_dprt_nm} 등) 을
 * 확정한 뒤 {@code @JsonAlias} 로 매핑하거나 record 필드명을 일치시켜야 한다.
 *
 * <p>현재 schema (placeholder):
 * <ul>
 *   <li>id          — 지원사업 고유 ID</li>
 *   <li>title       — 사업 제목</li>
 *   <li>organization— 주관기관</li>
 *   <li>category    — 사업 분류</li>
 *   <li>region      — 지역</li>
 *   <li>target      — 지원대상</li>
 *   <li>summary     — 지원분야 요약</li>
 *   <li>amount      — 지원금/한도</li>
 *   <li>status      — 모집 상태</li>
 *   <li>deadline    — 마감일 YYYY-MM-DD</li>
 *   <li>applyUrl    — 신청 페이지 URL</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KStartupApiItem(
        String id,
        String title,
        String organization,
        String category,
        String region,
        String target,
        String summary,
        String amount,
        String status,
        String deadline,
        String applyUrl
) {
}
