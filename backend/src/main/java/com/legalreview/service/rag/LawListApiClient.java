package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.config.LawApiProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;

/**
 * 국가법령정보센터 OPEN API REST 클라이언트 (RAG 수집 전용).
 *
 * 기존 {@link com.legalreview.service.LawApiClient}는 XML 검색 응답을 처리하는 검색 전용 클라이언트.
 * 본 클래스는 책임과 클래스명 모두 분리되어 두 Bean이 공존:
 *  - {@code com.legalreview.service.LawApiClient}      → 기존 법령 검색 API 클라이언트 (XML)
 *  - {@code com.legalreview.service.rag.LawListApiClient} → law_list 목록 수집용 JSON API 클라이언트 (이 클래스)
 *
 * Bean 이름 충돌 회피:
 *  - 클래스 단순명을 {@code LawListApiClient}로 변경하여 Spring component scan 시 default bean name도 분리됨
 *    (이전: 두 클래스 모두 단순명 'LawApiClient' → bean name 'lawApiClient' 충돌)
 *
 * 보안:
 *  - OC 값은 로그에 출력하지 않음 (URL의 OC=*** 마스킹)
 *  - 환경변수 LAW_API_OC를 통해서만 주입
 */
@Slf4j
@Component("lawListApiClient")
@RequiredArgsConstructor
public class LawListApiClient {

    private final RestTemplate restTemplate;
    private final LawApiProperties props;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ─────────────────── 법령 목록 ───────────────────

    /**
     * 법령 목록 1페이지를 가져옴.
     * @param page 1-based
     * @param display 1~100
     * @return JsonNode 응답 (실패 시 null)
     */
    public JsonNode fetchLawListPage(int page, int display) {
        if (!props.isConfigured()) {
            log.warn("[LAW-API] LAW_API_OC 미설정 — 법령 목록 호출 스킵");
            return null;
        }
        URI uri = UriComponentsBuilder.fromHttpUrl(props.getSearchUrl())
                .queryParam("OC", props.getOc())
                .queryParam("target", "law")
                .queryParam("type", "JSON")
                .queryParam("display", clampDisplay(display))
                .queryParam("page", Math.max(1, page))
                .build(true).toUri();
        return getJson(uri, "lawList page=" + page);
    }

    // ─────────────────── 법령 본문 ───────────────────

    /**
     * MST(법령일련번호)로 법령 본문 조회.
     */
    public JsonNode fetchLawDetailByMst(Integer lawMst) {
        if (lawMst == null) return null;
        if (!props.isConfigured()) {
            log.warn("[LAW-API] LAW_API_OC 미설정 — 법령 본문 호출 스킵");
            return null;
        }
        URI uri = UriComponentsBuilder.fromHttpUrl(props.getServiceUrl())
                .queryParam("OC", props.getOc())
                .queryParam("target", "law")
                .queryParam("type", "JSON")
                .queryParam("MST", lawMst)
                .build(true).toUri();
        return getJson(uri, "lawDetail MST=" + lawMst);
    }

    /**
     * lawId로 법령 본문 조회.
     */
    public JsonNode fetchLawDetailById(String lawId) {
        if (lawId == null || lawId.isBlank()) return null;
        if (!props.isConfigured()) {
            log.warn("[LAW-API] LAW_API_OC 미설정 — 법령 본문 호출 스킵");
            return null;
        }
        URI uri = UriComponentsBuilder.fromHttpUrl(props.getServiceUrl())
                .queryParam("OC", props.getOc())
                .queryParam("target", "law")
                .queryParam("type", "JSON")
                .queryParam("ID", lawId)
                .build(true).toUri();
        return getJson(uri, "lawDetail ID=" + lawId);
    }

    // ─────────────────── 헬퍼 ───────────────────

    private JsonNode getJson(URI uri, String desc) {
        try {
            String body = restTemplate.getForObject(uri, String.class);
            if (body == null || body.isBlank()) {
                log.warn("[LAW-API] 빈 응답: {} — uri-pathQuery={}", desc, redactQuery(uri));
                return null;
            }
            return objectMapper.readTree(body);
        } catch (Exception e) {
            log.warn("[LAW-API] 호출 실패: {} — uri-pathQuery={}, err={}",
                    desc, redactQuery(uri), e.getMessage());
            return null;
        }
    }

    /** OC 값을 로그에서 마스킹하기 위해 query를 가공. */
    private static String redactQuery(URI uri) {
        if (uri == null) return "";
        String full = uri.toString();
        // OC=값 패턴 마스킹 (값이 영숫자/언더바일 것으로 가정)
        return full.replaceAll("(?i)(OC=)[^&]*", "$1***");
    }

    private static int clampDisplay(int display) {
        if (display < 1) return 1;
        if (display > 100) return 100;
        return display;
    }
}
