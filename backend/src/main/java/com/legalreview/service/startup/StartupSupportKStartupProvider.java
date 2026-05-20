package com.legalreview.service.startup;

import com.legalreview.dto.startup.KStartupApiItem;
import com.legalreview.dto.startup.KStartupApiResponse;
import com.legalreview.dto.startup.StartupSupportItem;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

/**
 * K-Startup OpenAPI 기반 {@link StartupSupportProvider} (Phase 8 실제 HTTP 호출 구조).
 *
 * <p><b>활성화</b>: {@code startup-support.provider=k-startup}.
 * 미설정(default) 또는 {@code mock} 시 본 Bean 은 등록되지 않고 {@link StartupSupportMockProvider} 만 동작.
 *
 * <p><b>HTTP 호출 정책</b>:
 * <ul>
 *   <li>{@code api-key} 가 비어 있으면 외부 호출 skip — fallback 로 결과 제공</li>
 *   <li>{@link RestTemplate} 로 GET, 5~10초 SimpleClientHttpRequestFactory timeout 사용 (기존 Bean 재사용)</li>
 *   <li>예외 발생 시 빈 list 또는 mock fallback (옵션) 반환</li>
 *   <li>{@code sourceName()} 가 호출 결과에 따라 "k-startup" / "mock(fallback)" / "k-startup-skeleton" 로 동적 변경</li>
 * </ul>
 *
 * <p><b>실제 API schema 확정 전 한계</b>:
 *  현재 {@link KStartupApiResponse} / {@link KStartupApiItem} 는 placeholder schema 다.
 *  실제 K-Startup OpenAPI 응답 필드명을 확인한 뒤 {@code @JsonAlias} 매핑 또는 record 필드명 보정 필요.
 *  {@link #toSupportItem(KStartupApiItem)} 의 매핑 로직도 함께 갱신.
 *
 * <p><b>Bean 순환 의존성 회피</b>:
 *  {@link StartupSupportMockProvider} 는 클래스 타입으로 직접 주입.
 *  Service 는 인터페이스로 주입받고 본 Bean 은 {@code @Primary} 라 Mock 과 동시 활성 시에도 충돌 없음.
 */
@Component
@ConditionalOnProperty(name = "startup-support.provider", havingValue = "k-startup")
@Primary   // mock provider 와 동시 등록될 때 service 가 본 Bean 을 우선 선택
@Slf4j
@RequiredArgsConstructor
public class StartupSupportKStartupProvider implements StartupSupportProvider {

    private final RestTemplate restTemplate;

    @Value("${startup-support.k-startup.api-key:}")
    private String apiKey;

    @Value("${startup-support.k-startup.base-url:https://www.k-startup.go.kr/openapi}")
    private String baseUrl;

    @Value("${startup-support.k-startup.enable-mock-fallback:false}")
    private boolean enableMockFallback;

    /**
     * Mock fallback 의존성. 본 Bean 활성 시 mock 도 함께 @Component 로 등록되어 있어 안전 주입.
     * 명시적 {@link Qualifier} 로 mock provider 클래스 타입 매칭 (인터페이스 ambiguity 회피).
     */
    @Autowired(required = false)
    @Qualifier("startupSupportMockProvider")
    private StartupSupportMockProvider mockFallback;

    /** sourceName 캐싱 — 직전 호출 결과에 따라 응답 envelope source 값이 정확히 표시되도록. */
    private final AtomicReference<String> lastSource = new AtomicReference<>("k-startup-skeleton");

    @Override
    public List<StartupSupportItem> findAll() {
        // 1) api-key 미설정 → 외부 호출 skip
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("[startup-support] KStartup api-key 미설정. fallback 처리.");
            return safeFallback();
        }
        // 2) 실제 HTTP 호출
        try {
            URI uri = UriComponentsBuilder.fromHttpUrl(baseUrl)
                    .queryParam("apiKey", apiKey)
                    // TODO: K-Startup OpenAPI 가 페이지네이션이면 numOfRows/pageNo 추가
                    .build()
                    .toUri();
            KStartupApiResponse resp = restTemplate.getForObject(uri, KStartupApiResponse.class);
            if (resp == null || resp.items() == null || resp.items().isEmpty()) {
                log.warn("[startup-support] KStartup OpenAPI 응답 empty/null. fallback 처리.");
                return safeFallback();
            }
            List<StartupSupportItem> mapped = new ArrayList<>(resp.items().size());
            for (KStartupApiItem raw : resp.items()) {
                if (raw == null) continue;
                StartupSupportItem item = toSupportItem(raw);
                if (item != null) mapped.add(item);
            }
            lastSource.set("k-startup");
            log.info("[startup-support] KStartup 매핑 완료 — {}건", mapped.size());
            return mapped;
        } catch (RestClientException ex) {
            log.warn("[startup-support] KStartup OpenAPI HTTP 실패: {}. fallback 처리.", ex.getMessage());
            return safeFallback();
        } catch (Exception ex) {
            log.error("[startup-support] KStartup 예상치 못한 예외", ex);
            return safeFallback();
        }
    }

    @Override
    public Optional<StartupSupportItem> findById(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        // mock fallback 활성 + api-key 없으면 mock 단건 위임
        if (enableMockFallback && mockFallback != null && (apiKey == null || apiKey.isBlank())) {
            return mockFallback.findById(id);
        }
        // 실제 API 가 단건 endpoint 가 있다면 별도 호출 — 현재 schema 미확정이라 list 안에서 검색
        return findAll().stream().filter(i -> id.equals(i.id())).findFirst();
    }

    @Override
    public String sourceName() {
        return lastSource.get();
    }

    /**
     * 외부 호출 실패/skip 시 안전 반환.
     * {@code enable-mock-fallback=true} + mockFallback Bean 존재 시 mock 데이터 위임,
     * 그렇지 않으면 빈 list. 어느 쪽이든 {@code lastSource} 가 명확히 표시됨.
     */
    private List<StartupSupportItem> safeFallback() {
        if (enableMockFallback && mockFallback != null) {
            lastSource.set("mock(fallback)");
            return mockFallback.findAll();
        }
        lastSource.set("k-startup-skeleton");
        return Collections.emptyList();
    }

    /**
     * 외부 API 응답 → 우리 {@link StartupSupportItem} 매핑 (placeholder).
     * TODO 실제 schema 확정 후:
     *   - id null/blank 인 경우 외부 시퀀스/pbanc_sn 으로 보정
     *   - status 정규화 (영문 "active" → "모집중", 만료 일자 비교 → "마감임박" 등)
     *   - region 정규화 ("전국"/"서울특별시" → "서울" 등)
     *   - category 정규화 (사업화/R&D/멘토링 매핑 표 사용)
     *   - applyUrl 절대경로 보장
     */
    private StartupSupportItem toSupportItem(KStartupApiItem raw) {
        if (raw == null) return null;
        return new StartupSupportItem(
                Objects.requireNonNullElse(raw.id(), ""),
                Objects.requireNonNullElse(raw.title(), ""),
                Objects.requireNonNullElse(raw.organization(), ""),
                Objects.requireNonNullElse(raw.category(), "사업화"),    // TODO: 분류 매핑 표
                Objects.requireNonNullElse(raw.region(), "전국"),
                Objects.requireNonNullElse(raw.target(), ""),
                Objects.requireNonNullElse(raw.summary(), ""),
                Objects.requireNonNullElse(raw.amount(), ""),
                Objects.requireNonNullElse(raw.status(), "모집중"),     // TODO: 마감일 비교 후 마감임박/마감 보정
                Objects.requireNonNullElse(raw.deadline(), ""),
                Objects.requireNonNullElse(raw.applyUrl(), ""),
                "K-Startup OpenAPI 큐레이션 결과입니다."
        );
    }
}
