package com.legalreview.service;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 국가법령정보센터 OPEN API 클라이언트.
 * 법령(law) 및 판례(prec) 검색을 수행한다.
 * Python AI 서버와 동일하게 XML 응답을 사용한다.
 */
@Slf4j
@Component
public class LawApiClient {

    private final RestTemplate restTemplate;
    private final String baseUrl;
    private final String oc;

    public LawApiClient(
            RestTemplate restTemplate,
            @Value("${app.law-api.base-url}") String baseUrl,
            @Value("${app.law-api.oc:}") String oc) {
        this.restTemplate = restTemplate;
        this.baseUrl = baseUrl;
        this.oc = oc;
    }

    @PostConstruct
    void logConfiguration() {
        if (isConfigured()) {
            log.info("법제처 API 설정 확인: LAW_API_OC={} (활성)", oc.substring(0, Math.min(3, oc.length())) + "***");
        } else {
            log.warn("법제처 API 미설정: LAW_API_OC 환경변수가 비어있습니다. 법령/판례 검색이 비활성화됩니다.");
            log.warn("  → 터미널 실행 시: LAW_API_OC=키값 AI_ENGINE=ollama ./gradlew bootRun");
            log.warn("  → IntelliJ 실행 시: Run Configuration → Environment variables에 LAW_API_OC=키값 추가");
        }
    }

    public boolean isConfigured() {
        return oc != null && !oc.isBlank();
    }

    /**
     * 법령 검색 (target=law) - XML 응답 반환
     */
    public String searchLaws(String query, int display) {
        return callApi(query, "law", display);
    }

    /**
     * 판례 검색 (target=prec) - XML 응답 반환
     */
    public String searchCases(String query, int display) {
        return callApi(query, "prec", display);
    }

    private String callApi(String query, String target, int display) {
        String url = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .queryParam("OC", oc)
                .queryParam("target", target)
                .queryParam("type", "XML")
                .queryParam("query", query)
                .queryParam("display", display)
                .build()
                .toUriString();

        log.info("[LAW-DEBUG] 법제처 API 호출: target={}, query='{}', display={}", target, query, display);
        log.info("[LAW-DEBUG] 호출 URL: {}", url.replaceAll("OC=[^&]*", "OC=***"));

        String response = restTemplate.getForObject(url, String.class);

        if (response == null || response.isBlank()) {
            log.warn("[LAW-DEBUG] 법제처 API 응답이 비어있습니다. target={}, query={}", target, query);
            return "";
        }

        log.info("[LAW-DEBUG] 법제처 API 응답 수신: target={}, query='{}', 응답길이={}자",
                target, query, response.length());
        log.info("[LAW-DEBUG] 응답 앞 300자: {}",
                response.length() > 300 ? response.substring(0, 300) : response);

        return response;
    }
}
