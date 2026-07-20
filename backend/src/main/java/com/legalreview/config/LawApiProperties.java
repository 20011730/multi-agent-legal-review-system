package com.legalreview.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 국가법령정보센터(law.go.kr) OPEN API 설정.
 *
 * application.yml 예:
 * <pre>
 * app:
 *   law-api:
 *     oc: ${LAW_API_OC:}
 *     search-url: http://www.law.go.kr/DRF/lawSearch.do
 *     service-url: http://www.law.go.kr/DRF/lawService.do
 *     default-display: 100
 *     request-delay-ms: 150
 *     max-pages: 1
 * </pre>
 *
 * 보안:
 *  - {@code oc}는 환경변수 LAW_API_OC로만 주입. 코드/문서에 하드코딩 금지.
 *  - 로그에 OC 값을 그대로 노출하지 않음 (앞 3자만 출력).
 *
 * 안전장치:
 *  - {@code maxPages}는 기본 1 — 실수로 전체 수집이 되지 않게 함.
 *  - {@code defaultDisplay}는 1~100 범위로 컨트롤러에서 clamp.
 *
 * 기존 {@code service/LawApiClient}의 {@code @Value("${app.law-api.base-url}")}와는 별개의 키 사용.
 * (base-url은 기존 검색 전용, search-url/service-url은 신규 RAG 수집용)
 */
@Configuration
@ConfigurationProperties(prefix = "app.law-api")
@Getter
@Setter
public class LawApiProperties {

    /** 법제처 발급 OC 값. 비어 있으면 API 호출 불가. */
    private String oc = "";

    /** 법령/판례 목록 검색 URL. */
    private String searchUrl = "http://www.law.go.kr/DRF/lawSearch.do";

    /** 법령/판례 본문 조회 URL. */
    private String serviceUrl = "http://www.law.go.kr/DRF/lawService.do";

    /** 기본 페이지 크기 (display). 1~100 범위. */
    private int defaultDisplay = 100;

    /** 페이지 사이 호출 간격(ms). 법제처 API 부하 방지. */
    private int requestDelayMs = 150;

    /** 한 번 호출 시 처리할 최대 페이지 수 (안전장치). 기본 1. */
    private int maxPages = 1;

    public boolean isConfigured() {
        return oc != null && !oc.isBlank();
    }
}
