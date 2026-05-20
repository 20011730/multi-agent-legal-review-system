package com.legalreview.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 스타트업 지원사업 (K-Startup OpenAPI) 관련 설정.
 *
 * <p>공공데이터포털에서 승인받은 API 2개를 분리하여 보관:
 * <ul>
 *   <li><b>service</b> — 창업진흥원_K-Startup (사업소개/사업공고/콘텐츠 등) 조회서비스</li>
 *   <li><b>news</b>    — 중소벤처기업부_K STARTUP 창업소식</li>
 * </ul>
 *
 * <p>application.yml 예시:
 * <pre>
 * startup-support:
 *   provider: mock                 # mock | k-startup
 *   enable-mock-fallback: true
 *   k-startup:
 *     service:
 *       api-key: ${KSTARTUP_SERVICE_API_KEY:${STARTUP_API_KEY:}}
 *       base-url: ${KSTARTUP_SERVICE_BASE_URL:${STARTUP_BASE_URL:https://apis.data.go.kr/B552735/kisedKstartupService}}
 *     news:
 *       api-key: ${KSTARTUP_NEWS_API_KEY:}
 *       base-url: ${KSTARTUP_NEWS_BASE_URL:https://apis.data.go.kr/1421000/kStartupNews}
 * </pre>
 *
 * <p>환경변수 우선순위:
 *  새 변수 ({@code KSTARTUP_SERVICE_API_KEY} 등) → 구 변수 ({@code STARTUP_API_KEY}) → 빈 문자열.
 *  운영자는 두 키를 모두 설정하거나, 일단 service 키만 설정한 뒤 점진적으로 news 키 추가 가능.
 */
@Getter
@Setter
@Configuration
@ConfigurationProperties(prefix = "startup-support")
public class StartupSupportProperties {

    /** "mock" (default) 또는 "k-startup". KStartupProvider 활성화 조건. */
    private String provider = "mock";

    /** 외부 API 실패 / api-key 미설정 시 mock 데이터로 graceful fallback. */
    private boolean enableMockFallback = false;

    /** K-Startup 관련 endpoint 묶음. */
    private KStartup kStartup = new KStartup();

    @Getter
    @Setter
    public static class KStartup {
        /** 창업진흥원 K-Startup 조회서비스 (사업소개/사업공고/콘텐츠). */
        private ApiEndpoint service = new ApiEndpoint();

        /** 중소벤처기업부 K-Startup 창업소식. */
        private ApiEndpoint news = new ApiEndpoint();
    }

    @Getter
    @Setter
    public static class ApiEndpoint {
        private String apiKey = "";
        private String baseUrl = "";
        /**
         * baseUrl 뒤에 붙는 operation 경로 (예: {@code /getAnnouncementInformation01}).
         * 공공데이터 API 는 baseUrl 만으로 호출 시 보통 500/404 가 떨어지므로,
         * 실제 OpenAPI 문서의 operation 경로를 분리하여 명시한다.
         * 빈 문자열이면 baseUrl 만 호출 (실패 시 fallback 으로 안전 처리).
         */
        private String operationPath = "";

        /** api-key 가 비어있지 않으면 사용 가능. */
        public boolean isUsable() {
            return apiKey != null && !apiKey.isBlank();
        }

        /** baseUrl + operationPath 합성 (중복 슬래시 정리). */
        public String fullUrl() {
            String b = baseUrl == null ? "" : baseUrl.trim();
            String p = operationPath == null ? "" : operationPath.trim();
            if (p.isEmpty()) return b;
            if (b.endsWith("/") && p.startsWith("/")) return b + p.substring(1);
            if (!b.endsWith("/") && !p.startsWith("/")) return b + "/" + p;
            return b + p;
        }
    }
}
