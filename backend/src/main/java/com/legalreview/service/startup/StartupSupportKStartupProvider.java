package com.legalreview.service.startup;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.config.StartupSupportProperties;
import com.legalreview.config.StartupSupportProperties.ApiEndpoint;
import com.legalreview.dto.startup.KStartupApiItem;
import com.legalreview.dto.startup.KStartupApiResponse;
import com.legalreview.dto.startup.StartupSupportItem;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

/**
 * K-Startup OpenAPI 기반 {@link StartupSupportProvider}.
 *
 * <p>Phase 9.5 — service + news 듀얼 호출 + source 정책:
 * <ul>
 *   <li><b>service</b> (창업진흥원_K-Startup 조회서비스, data.go.kr 게이트웨이) — 사업공고 목록.</li>
 *   <li><b>news</b> (중소벤처기업부 K-Startup 창업소식, odcloud 게이트웨이) — 창업 뉴스/콘텐츠.</li>
 *   <li><b>source 결정 규칙</b>:
 *     <ul>
 *       <li>service OK + news OK → {@code k-startup-mixed}</li>
 *       <li>service OK only      → {@code k-startup}</li>
 *       <li>news OK only         → {@code k-startup-news}</li>
 *       <li>둘 다 실패           → service 에러 분류 ({@code k-startup-error-*}),
 *           {@code STARTUP_MOCK_FALLBACK=true} 시 {@code mock(fallback)}</li>
 *     </ul>
 *   </li>
 *   <li>요청 URL 의 {@code serviceKey} 값은 로그에서 항상 마스킹.</li>
 *   <li>응답은 우선 {@code String} 으로 받아 raw body 진단 (HTML/XML/JSON/plain + 공공데이터 에러 토큰).</li>
 * </ul>
 */
@Component
@ConditionalOnProperty(name = "startup-support.provider", havingValue = "k-startup")
@Primary
@Slf4j
@RequiredArgsConstructor
public class StartupSupportKStartupProvider implements StartupSupportProvider {

    private final RestTemplate restTemplate;
    private final StartupSupportProperties properties;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired(required = false)
    @Qualifier("startupSupportMockProvider")
    private StartupSupportMockProvider mockFallback;

    private final AtomicReference<String> lastSource = new AtomicReference<>("k-startup-skeleton");

    /** odcloud news 원본 총 건수 (모든 페이지 합산). 마지막 fetch 시 갱신. */
    private final java.util.concurrent.atomic.AtomicInteger newsOriginTotal = new java.util.concurrent.atomic.AtomicInteger(0);

    /** 10분 in-memory 캐시 (news 만 — service 는 현재 500 이라 캐시 의미 없음). */
    private volatile List<StartupSupportItem> newsCache = null;
    private volatile long newsCacheAt = 0L;
    private static final long NEWS_CACHE_TTL_MS = 10 * 60 * 1000L;
    private static final int NEWS_PER_PAGE = 100;
    /** 마지막에서부터 몇 페이지까지 수집할지. 5 → 최대 500건 (실측 ~469건). */
    private static final int NEWS_TAIL_PAGES = 5;

    /** odcloud news API 총 건수 — controller/service 에서 envelope 에 노출 가능. */
    public int getNewsOriginTotal() {
        return newsOriginTotal.get();
    }

    private boolean serviceEndpointReady() {
        ApiEndpoint ep = properties.getKStartup() == null ? null : properties.getKStartup().getService();
        return ep != null && ep.isUsable();
    }

    private boolean newsEndpointReady() {
        ApiEndpoint ep = properties.getKStartup() == null ? null : properties.getKStartup().getNews();
        return ep != null && ep.isUsable();
    }

    /** 외부에서 endpoint 상태 확인용. */
    public boolean fetchNewsEndpointConfigured() {
        return newsEndpointReady();
    }

    /** 단일 호출 결과 컨테이너. */
    private record FetchResult(List<StartupSupportItem> items, String errorTag) {
        boolean ok() { return errorTag == null && items != null && !items.isEmpty(); }
    }

    @Override
    public List<StartupSupportItem> findAll() {
        FetchResult svc = serviceEndpointReady()
                ? fetchService()
                : new FetchResult(List.of(), "k-startup-skeleton");
        FetchResult news = newsEndpointReady()
                ? fetchNews()
                : new FetchResult(List.of(), null); // news 키 미설정은 무해

        if (svc.ok() && news.ok()) {
            List<StartupSupportItem> combined = new ArrayList<>(svc.items().size() + news.items().size());
            combined.addAll(svc.items());
            combined.addAll(news.items());
            lastSource.set("k-startup-mixed");
            log.info("[startup-support] service={}건 + news={}건 = {}건 (source=k-startup-mixed)",
                    svc.items().size(), news.items().size(), combined.size());
            return combined;
        }
        if (svc.ok()) {
            lastSource.set("k-startup-service");
            log.info("[startup-support] service={}건 (source=k-startup-service, news=실패/미설정)", svc.items().size());
            return svc.items();
        }
        if (news.ok()) {
            lastSource.set("k-startup-news");
            log.info("[startup-support] news={}건 (source=k-startup-news, service 실패)", news.items().size());
            return news.items();
        }
        // 모두 실패 — service 에러 분류 우선
        String errorTag = svc.errorTag() != null ? svc.errorTag()
                : (news.errorTag() != null ? news.errorTag() : "k-startup-skeleton");
        return safeFallback(errorTag);
    }

    /**
     * service API 호출 (Phase 9.10 — kisedKstartupService01 게이트웨이).
     * 응답은 odcloud 스타일 envelope ({@code data:[{...30개 한영 키...}]}).
     * 파라미터: page / perPage / returnType (pageNo/numOfRows/type 아님).
     * 캐시 10분.
     */
    private volatile List<StartupSupportItem> serviceCache = null;
    private volatile long serviceCacheAt = 0L;
    private final java.util.concurrent.atomic.AtomicInteger serviceOriginTotal = new java.util.concurrent.atomic.AtomicInteger(0);

    public int getServiceOriginTotal() {
        return serviceOriginTotal.get();
    }

    private FetchResult fetchService() {
        if (serviceCache != null && (System.currentTimeMillis() - serviceCacheAt) < NEWS_CACHE_TTL_MS) {
            return new FetchResult(serviceCache, serviceCache.isEmpty() ? "k-startup-error-parse" : null);
        }
        ApiEndpoint svc = properties.getKStartup().getService();

        // 첫 페이지 (perPage=100) — service01 API 는 최신 등록순으로 응답 (pbanc_sn 내림차순 추정).
        // 추가로 page=2, page=3 까지 수집해 ~300건 큐레이션.
        final int SERVICE_PER_PAGE = 100;
        final int SERVICE_PAGES = 3;

        List<StartupSupportItem> all = new ArrayList<>(SERVICE_PER_PAGE * SERVICE_PAGES);
        String lastErrorTag = null;
        boolean anySuccess = false;

        for (int page = 1; page <= SERVICE_PAGES; page++) {
            FetchPageResult r = fetchServicePage(svc, page, SERVICE_PER_PAGE);
            if (r.items() != null && !r.items().isEmpty()) {
                all.addAll(r.items());
                anySuccess = true;
            } else if (r.errorTag() != null) {
                lastErrorTag = r.errorTag();
                if (page == 1) break; // 첫 페이지부터 실패면 더 이상 시도 안함
            }
        }
        if (!anySuccess || all.isEmpty()) {
            return new FetchResult(List.of(), lastErrorTag != null ? lastErrorTag : "k-startup-error-parse");
        }

        // dedupe by id (pbanc_sn)
        java.util.Map<String, StartupSupportItem> dedup = new java.util.LinkedHashMap<>();
        for (StartupSupportItem it : all) {
            if (it.id() != null) dedup.putIfAbsent(it.id(), it);
        }
        List<StartupSupportItem> mapped = new ArrayList<>(dedup.values());

        serviceCache = mapped;
        serviceCacheAt = System.currentTimeMillis();
        log.info("[startup-support] service 매핑 완료 — {}건 (originTotal={})",
                mapped.size(), serviceOriginTotal.get());
        return new FetchResult(mapped, null);
    }

    /** service API 단일 page 호출 (perPage 지정). */
    private FetchPageResult fetchServicePage(ApiEndpoint svc, int pageNo, int perPage) {
        URI uri;
        try {
            uri = UriComponentsBuilder.fromUriString(svc.fullUrl())
                    .queryParam("serviceKey", svc.getApiKey())
                    .queryParam("page", pageNo)
                    .queryParam("perPage", perPage)
                    .queryParam("returnType", "json")
                    .build(true)
                    .toUri();
        } catch (Exception ex) {
            return new FetchPageResult(List.of(), "k-startup-error-paramfix");
        }
        log.info("[startup-support] service page={} 호출: {}",
                pageNo, maskServiceKey(uri.toString(), svc.getApiKey()));

        String body;
        try {
            ResponseEntity<String> resp = restTemplate.getForEntity(uri, String.class);
            body = resp.getBody();
        } catch (HttpStatusCodeException ex) {
            String errBody = safeSnippet(sanitizeKey(ex.getResponseBodyAsString(), svc.getApiKey()), 200);
            String classified = classifyByBody(errBody);
            log.warn("[startup-support] service page={} HTTP {} 실패. source={}",
                    pageNo, ex.getStatusCode().value(), classified);
            return new FetchPageResult(List.of(), classified != null ? classified : "k-startup-error-http");
        } catch (RestClientException ex) {
            return new FetchPageResult(List.of(), "k-startup-error-http");
        } catch (Exception ex) {
            log.error("[startup-support] service page={} 예외", pageNo, ex);
            return new FetchPageResult(List.of(), "k-startup-error-unexpected");
        }
        if (body == null || body.isBlank()) return new FetchPageResult(List.of(), "k-startup-error-parse");
        String classified = classifyByBody(body);
        if (classified != null) return new FetchPageResult(List.of(), classified);
        if (!"json".equals(detectBodyFormat(body))) return new FetchPageResult(List.of(), "k-startup-error-parse");

        try {
            Map<String, Object> root = objectMapper.readValue(body, new TypeReference<>() {});
            Object tc = root.get("totalCount");
            if (tc instanceof Number n) serviceOriginTotal.set(n.intValue());

            Object dataObj = root.get("data");
            if (!(dataObj instanceof List<?> dataList) || dataList.isEmpty()) {
                return new FetchPageResult(List.of(), "k-startup-error-parse");
            }
            List<StartupSupportItem> mapped = new ArrayList<>(dataList.size());
            for (Object e : dataList) {
                if (!(e instanceof Map<?, ?> m)) continue;
                StartupSupportItem item = toSupportItemServiceMap(m);
                if (item != null) mapped.add(item);
            }
            return new FetchPageResult(mapped, null);
        } catch (Exception ex) {
            log.warn("[startup-support] service page={} JSON 파싱 실패: {}", pageNo, ex.getMessage());
            return new FetchPageResult(List.of(), "k-startup-error-parse");
        }
    }

    /**
     * service01 응답 1건 → {@link StartupSupportItem} 매핑.
     * 주요 필드 (확인된 30개 중):
     *   pbanc_sn / biz_pbanc_nm / pbanc_ntrp_nm / pbanc_rcpt_end_dt / rcrt_prgs_yn /
     *   supt_biz_clsfc / supt_regin / aply_trgt / pbanc_ctnt / detl_pg_url
     */
    private StartupSupportItem toSupportItemServiceMap(Map<?, ?> m) {
        String pbancSn = stringOf(m.get("pbanc_sn"));
        String title = firstNonBlank(stringOf(m.get("biz_pbanc_nm")),
                stringOf(m.get("intg_pbanc_biz_nm")));
        if (pbancSn.isBlank() && title.isBlank()) return null;

        String org = firstNonBlank(
                stringOf(m.get("pbanc_ntrp_nm")),
                stringOf(m.get("sprv_inst")),
                stringOf(m.get("biz_prch_dprt_nm")));
        String category = stringOf(m.get("supt_biz_clsfc"));
        String region = stringOf(m.get("supt_regin"));
        String target = stringOf(m.get("aply_trgt"));
        String summary = stringOf(m.get("pbanc_ctnt"));
        if (summary.length() > 200) summary = summary.substring(0, 200) + "...";

        String deadlineRaw = stringOf(m.get("pbanc_rcpt_end_dt"));
        String deadline = formatYyyymmdd(deadlineRaw);

        String rcrtY = stringOf(m.get("rcrt_prgs_yn"));
        String status = "Y".equalsIgnoreCase(rcrtY) ? "모집중" : ("N".equalsIgnoreCase(rcrtY) ? "모집마감" : "");

        String url = firstNonBlank(stringOf(m.get("detl_pg_url")), stringOf(m.get("biz_aply_url")));

        return new StartupSupportItem(
                "supt-" + (pbancSn.isBlank() ? Integer.toHexString(title.hashCode()) : pbancSn),
                title.isBlank() ? "(제목 없음)" : title,
                org.isBlank() ? "확인 필요" : org,
                category.isBlank() ? "사업화" : category,
                region.isBlank() ? "전국" : region,
                target.isBlank() ? "공고문 참고" : target,
                summary.isBlank() ? "공고문 참고" : summary,
                "공고문 참고",
                status.isBlank() ? "확인 필요" : status,
                deadline.isBlank() ? "공고문 참고" : deadline,
                url,
                "창업진흥원 K-Startup 조회서비스 공식 공고"
        );
    }

    private static String firstNonBlank(String... ss) {
        for (String s : ss) if (s != null && !s.isBlank()) return s;
        return "";
    }

    /** 20260520 → 2026-05-20. */
    private static String formatYyyymmdd(String s) {
        if (s == null) return "";
        String t = s.trim();
        if (t.length() == 8 && t.matches("\\d{8}")) {
            return t.substring(0, 4) + "-" + t.substring(4, 6) + "-" + t.substring(6, 8);
        }
        return t;
    }

    /**
     * news API (odcloud) 호출.
     * 응답 schema: {@code {currentCount, data:[{제목, 내용, 등록일자, 순번, 인터넷주소(URL)}], totalCount,...}}
     * 한글 키이므로 {@code Map<String,Object>} 로 파싱 후 매핑.
     */
    private FetchResult fetchNews() {
        // 캐시 적중 (10분 TTL) — 외부 호출 절감 + 응답 안정
        if (newsCache != null && (System.currentTimeMillis() - newsCacheAt) < NEWS_CACHE_TTL_MS) {
            log.debug("[startup-support] news 캐시 적중 — {}건", newsCache.size());
            return new FetchResult(newsCache, newsCache.isEmpty() ? "k-startup-error-parse" : null);
        }

        ApiEndpoint nws = properties.getKStartup().getNews();
        // 1) bootstrap — totalCount 만 알아내기 위해 perPage=1 호출 (응답 본문 작음)
        int totalCount = probeNewsTotalCount(nws);
        if (totalCount <= 0) totalCount = NEWS_PER_PAGE; // fallback
        newsOriginTotal.set(totalCount);

        // 2) 마지막 페이지부터 NEWS_TAIL_PAGES 만큼 역순 수집 → 최신 ~400건 확보
        int lastPage = Math.max(1, (int) Math.ceil((double) totalCount / NEWS_PER_PAGE));
        int firstPage = Math.max(1, lastPage - NEWS_TAIL_PAGES + 1);
        log.info("[startup-support] news multi-page fetch: page {}..{} (perPage={}, totalCount={})",
                firstPage, lastPage, NEWS_PER_PAGE, totalCount);

        List<StartupSupportItem> all = new ArrayList<>(NEWS_PER_PAGE * NEWS_TAIL_PAGES);
        String lastErrorTag = null;
        int successPages = 0;
        for (int p = lastPage; p >= firstPage; p--) {
            FetchPageResult r = fetchNewsPage(nws, p);
            if (r.items() != null && !r.items().isEmpty()) {
                all.addAll(r.items());
                successPages++;
            } else if (r.errorTag() != null) {
                lastErrorTag = r.errorTag();
            }
        }
        if (all.isEmpty()) {
            return new FetchResult(List.of(), lastErrorTag != null ? lastErrorTag : "k-startup-error-parse");
        }

        // dedupe by id
        java.util.Map<String, StartupSupportItem> dedup = new java.util.LinkedHashMap<>();
        for (StartupSupportItem it : all) {
            if (it.id() != null) dedup.putIfAbsent(it.id(), it);
        }
        List<StartupSupportItem> mapped = new ArrayList<>(dedup.values());
        // 등록일자 내림차순
        mapped.sort((a, b) -> {
            String da = a.deadline() == null ? "" : a.deadline();
            String db = b.deadline() == null ? "" : b.deadline();
            return db.compareTo(da);
        });
        newsCache = mapped;
        newsCacheAt = System.currentTimeMillis();
        log.info("[startup-support] news 매핑 완료 — {}건 ({}/{} 페이지 성공, originTotal={})",
                mapped.size(), successPages, (lastPage - firstPage + 1), newsOriginTotal.get());
        return new FetchResult(mapped, null);
    }

    /** 단일 page 호출 결과. */
    private record FetchPageResult(List<StartupSupportItem> items, String errorTag) {}

    /** news 단일 페이지 호출 (page=N). 실패 시 errorTag 반환. */
    private FetchPageResult fetchNewsPage(ApiEndpoint nws, int pageNo) {
        URI uri;
        try {
            uri = UriComponentsBuilder.fromUriString(nws.fullUrl())
                    .queryParam("page", pageNo)
                    .queryParam("perPage", NEWS_PER_PAGE)
                    .queryParam("serviceKey", nws.getApiKey())
                    .build(true)
                    .toUri();
        } catch (Exception ex) {
            return new FetchPageResult(List.of(), "k-startup-error-paramfix");
        }
        log.debug("[startup-support] news page={} 호출: {}",
                pageNo, maskServiceKey(uri.toString(), nws.getApiKey()));

        String body;
        try {
            ResponseEntity<String> resp = restTemplate.getForEntity(uri, String.class);
            body = resp.getBody();
        } catch (HttpStatusCodeException ex) {
            String errBody = safeSnippet(sanitizeKey(ex.getResponseBodyAsString(), nws.getApiKey()), 200);
            String classified = classifyByBody(errBody);
            log.warn("[startup-support] news page={} HTTP {} 실패. source={}",
                    pageNo, ex.getStatusCode().value(), classified);
            return new FetchPageResult(List.of(), classified != null ? classified : "k-startup-error-http");
        } catch (RestClientException ex) {
            return new FetchPageResult(List.of(), "k-startup-error-http");
        } catch (Exception ex) {
            log.error("[startup-support] news page={} 예외", pageNo, ex);
            return new FetchPageResult(List.of(), "k-startup-error-unexpected");
        }
        if (body == null || body.isBlank()) return new FetchPageResult(List.of(), "k-startup-error-parse");
        String classified = classifyByBody(body);
        if (classified != null) return new FetchPageResult(List.of(), classified);
        if (!"json".equals(detectBodyFormat(body))) return new FetchPageResult(List.of(), "k-startup-error-parse");
        try {
            Map<String, Object> root = objectMapper.readValue(body, new TypeReference<>() {});
            Object dataObj = root.get("data");
            if (!(dataObj instanceof List<?> dataList) || dataList.isEmpty()) {
                return new FetchPageResult(List.of(), "k-startup-error-parse");
            }
            List<StartupSupportItem> mapped = new ArrayList<>(dataList.size());
            for (Object e : dataList) {
                if (!(e instanceof Map<?, ?> m)) continue;
                StartupSupportItem item = toSupportItemNews(m);
                if (item != null) mapped.add(item);
            }
            return new FetchPageResult(mapped, null);
        } catch (Exception ex) {
            return new FetchPageResult(List.of(), "k-startup-error-parse");
        }
    }

    @Override
    public Optional<StartupSupportItem> findById(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        if (!serviceEndpointReady() && !newsEndpointReady()
                && properties.isEnableMockFallback() && mockFallback != null) {
            return mockFallback.findById(id);
        }
        return findAll().stream().filter(i -> id.equals(i.id())).findFirst();
    }

    @Override
    public String sourceName() {
        return lastSource.get();
    }

    @Override
    public int originTotal() {
        return Math.max(newsOriginTotal.get(), serviceOriginTotal.get());
    }

    // ───────── helpers ─────────

    /** odcloud 의 totalCount 만 알아내는 경량 호출. 실패하면 0 반환 (호출자가 fallback 처리). */
    private int probeNewsTotalCount(ApiEndpoint nws) {
        try {
            URI probeUri = UriComponentsBuilder.fromUriString(nws.fullUrl())
                    .queryParam("page", 1)
                    .queryParam("perPage", 1)
                    .queryParam("serviceKey", nws.getApiKey())
                    .build(true)
                    .toUri();
            ResponseEntity<String> r = restTemplate.getForEntity(probeUri, String.class);
            String b = r.getBody();
            if (b == null || b.isBlank()) return 0;
            Map<String, Object> root = objectMapper.readValue(b, new TypeReference<>() {});
            Object tc = root.get("totalCount");
            if (tc instanceof Number n) return n.intValue();
            if (tc != null) return Integer.parseInt(tc.toString());
            return 0;
        } catch (Exception ex) {
            log.warn("[startup-support] news totalCount probe 실패: {}", ex.getMessage());
            return 0;
        }
    }

    private String classifyByBody(String body) {
        if (body == null) return null;
        String b = body.toUpperCase();
        if (b.contains("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")
                || b.contains("SERVICEKEY_IS_NOT_REGISTERED")) {
            return "k-startup-error-keyrejected";
        }
        if (b.contains("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR")
                || b.contains("REQUEST_EXCEED")) {
            return "k-startup-error-quota";
        }
        if (b.contains("INVALID_REQUEST_PARAMETER_ERROR")
                || b.contains("NO_MANDATORY_REQUEST_PARAMETERS_ERROR")) {
            return "k-startup-error-paramfix";
        }
        if (b.contains("UNEXPECTED ERRORS") || b.contains("UNEXPECTED_ERRORS")) {
            return "k-startup-error-unexpected";
        }
        if (b.contains("NOT FOUND SERVICE")) {
            return "k-startup-error-paramfix";
        }
        return null;
    }

    private String detectBodyFormat(String body) {
        if (body == null) return "plain";
        String t = body.trim();
        if (t.isEmpty()) return "plain";
        String low = t.toLowerCase();
        if (low.startsWith("<!doctype html") || low.startsWith("<html")
                || (low.contains("<html") && low.contains("</html>"))) return "html";
        if (t.startsWith("<?xml") || (t.startsWith("<") && !low.startsWith("<html"))) return "xml";
        if (t.startsWith("{") || t.startsWith("[")) return "json";
        return "plain";
    }

    /** URL/body 의 serviceKey 원문(혹은 키 값 자체) 만 마스킹. */
    private String maskServiceKey(String url, String apiKey) {
        if (url == null) return "";
        if (apiKey == null || apiKey.isBlank()) return url;
        String tail = apiKey.length() >= 3 ? apiKey.substring(apiKey.length() - 3) : "";
        return url.replace(apiKey, "***" + tail);
    }

    /** error body 등에 키가 echo 될 가능성 대비. */
    private String sanitizeKey(String body, String apiKey) {
        return maskServiceKey(body, apiKey);
    }

    private String safeSnippet(String body, int max) {
        if (body == null) return "";
        String s = body.replaceAll("\\s+", " ").trim();
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    private List<StartupSupportItem> safeFallback(String sourceTag) {
        if (properties.isEnableMockFallback() && mockFallback != null) {
            lastSource.set("mock(fallback)");
            return mockFallback.findAll();
        }
        lastSource.set(sourceTag != null ? sourceTag : "k-startup-skeleton");
        return Collections.emptyList();
    }

    private StartupSupportItem toSupportItemService(KStartupApiItem raw) {
        if (raw == null) return null;
        return new StartupSupportItem(
                Objects.requireNonNullElse(raw.id(), ""),
                Objects.requireNonNullElse(raw.title(), ""),
                Objects.requireNonNullElse(raw.organization(), ""),
                Objects.requireNonNullElse(raw.category(), "사업화"),
                Objects.requireNonNullElse(raw.region(), "전국"),
                Objects.requireNonNullElse(raw.target(), ""),
                Objects.requireNonNullElse(raw.summary(), ""),
                Objects.requireNonNullElse(raw.amount(), ""),
                Objects.requireNonNullElse(raw.status(), "모집중"),
                Objects.requireNonNullElse(raw.deadline(), ""),
                Objects.requireNonNullElse(raw.applyUrl(), ""),
                "K-Startup OpenAPI 큐레이션 결과입니다."
        );
    }

    /**
     * news(odcloud) 응답 1건 → {@link StartupSupportItem} 매핑.
     * 한글 키: 제목 / 내용 / 등록일자 / 순번 / 인터넷주소(URL).
     */
    private StartupSupportItem toSupportItemNews(Map<?, ?> m) {
        String title = stringOf(m.get("제목"));
        String content = stringOf(m.get("내용"));
        String date = stringOf(m.get("등록일자"));
        String url = stringOf(m.get("인터넷주소(URL)"));
        if (url.isBlank()) url = stringOf(m.get("인터넷주소"));
        String seq = stringOf(m.get("순번"));
        if (title.isBlank() && content.isBlank()) return null;

        String summary = content.length() > 160 ? content.substring(0, 160) + "..." : content;
        return new StartupSupportItem(
                "news-" + (seq.isBlank() ? Integer.toHexString(title.hashCode()) : seq),
                title.isBlank() ? "(제목 없음)" : title,
                "중소벤처기업부 K-Startup",
                "창업소식",
                "전국",
                "확인 필요",
                summary.isBlank() ? "공고문 참고" : summary,
                "공고문 참고",
                "공지",
                date.isBlank() ? "공고문 참고" : date,
                url,
                "최근 창업소식 — K-Startup 공식 채널"
        );
    }

    private static String stringOf(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }
}
