package com.legalreview.dto.startup;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * K-Startup OpenAPI 응답 DTO (Phase 8 placeholder).
 *
 * 실제 K-Startup OpenAPI 응답 스키마가 확정되지 않은 시점이라, 본 record 는
 * <strong>가설 schema</strong> 다. 구현 시 다음 단계로 보강 필요:
 *
 * <ol>
 *   <li>공공데이터포털 / K-Startup OpenAPI 신청 후 샘플 응답 확보</li>
 *   <li>응답 root 가 페이지네이션이라면 {@code totalCount/page/numOfRows} 필드 추가</li>
 *   <li>{@code items} 키 이름이 다르면 {@code @JsonAlias} 로 매핑</li>
 *   <li>응답이 XML 이면 별도 {@code MappingJackson2XmlHttpMessageConverter} 등록 필요</li>
 * </ol>
 *
 * 현재 본 DTO 는 컴파일 가능한 안전 구조만 제공. 실제 매핑은 KStartupProvider 의
 * {@code toSupportItem(...)} 에서 placeholder 로직 실행.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KStartupApiResponse(
        Integer totalCount,
        List<KStartupApiItem> items
) {
}
