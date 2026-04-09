package com.legalreview.service;

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

        log.info("법제처 API 호출: target={}, query={}, display={}", target, query, display);

        String response = restTemplate.getForObject(url, String.class);

        if (response == null || response.isBlank()) {
            log.warn("법제처 API 응답이 비어있습니다. target={}, query={}", target, query);
            return "";
        }

        log.debug("법제처 API raw 응답 (target={}, query={}): {}", target, query, response);

        return response;
    }
}
