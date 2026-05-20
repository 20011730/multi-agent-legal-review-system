package com.legalreview.service.startup;

import com.legalreview.dto.startup.StartupSupportItem;

import java.util.List;
import java.util.Optional;

/**
 * 스타트업 지원사업 데이터 공급자 인터페이스 (Phase 3 추상화).
 *
 * 현재 구현: {@link StartupSupportMockProvider} (정적 mock 15건)
 *
 * 향후 추가 가능 구현 (예시):
 *   - KStartupApiProvider — K-Startup OpenAPI fetch + 캐싱
 *   - DataGoKrProvider   — 공공데이터포털 OpenAPI
 *   - DbStartupSupportProvider — 자체 DB 저장본
 *   - HybridProvider     — 우선 API, 실패 시 DB fallback
 *
 * 정책:
 *   - Bean 중복 회피를 위해 동시에 하나의 구현만 활성화한다 (현재 MockProvider 만 `@Service`).
 *   - 향후 외부 provider 추가 시 `@Primary` / `@ConditionalOnProperty` 등으로 절체 가능.
 *   - 추상화는 method 시그니처만 강제 — 구현체 내부 캐싱·재시도 등은 자유.
 */
public interface StartupSupportProvider {

    /** 전체 지원사업 목록. 빈 list 가능, null 금지. */
    List<StartupSupportItem> findAll();

    /** id 로 단건 조회. 없으면 {@link Optional#empty()}. id null/blank 도 동일. */
    Optional<StartupSupportItem> findById(String id);

    /**
     * 데이터 소스 식별자 (로깅 / 디버그 / 미래 API 응답 메타용).
     * 예: "mock", "k-startup", "data-go-kr", "db"
     */
    default String sourceName() {
        return "unknown";
    }

    /**
     * upstream(공공데이터/API 원본) 총 건수. 알 수 없으면 0.
     * KStartup provider 는 news API 의 totalCount 를 반환.
     */
    default int originTotal() {
        return 0;
    }
}
