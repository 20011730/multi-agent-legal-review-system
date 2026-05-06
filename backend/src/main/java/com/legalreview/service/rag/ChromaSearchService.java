package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.rag.RetrievedChunk;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Chroma DB REST API 클라이언트.
 *
 * Chroma 0.5.x 호환:
 *   - {@code POST /api/v1/collections}                       — 생성/조회 (name 기반, get_or_create=true)
 *   - {@code GET  /api/v1/collections}                       — 목록 (name → UUID 매핑용)
 *   - {@code POST /api/v1/collections/{UUID}/upsert}         — ★ NAME이 아니라 UUID 필요
 *   - {@code POST /api/v1/collections/{UUID}/query}          — ★ 동일
 *   - {@code GET  /api/v1/collections/{UUID}/count}          — ★ 동일
 *
 * Chroma 0.4 이전과 달리 0.4.16+에서 컬렉션 단위 endpoint의 path parameter가 collection NAME에서
 * UUID로 변경되었다. NAME을 그대로 path에 박으면 400 InvalidUUID 에러.
 *
 * → 본 클래스는 ensureCollection 응답 또는 list 호출로 NAME → UUID 매핑을 유지한다.
 *
 * RAG가 비활성이거나 Chroma가 다운된 경우 빈 결과/false를 반환하여 호출 측이 안전하게 fallback할 수 있게 한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChromaSearchService {

    private final RagProperties ragProperties;
    private final RestTemplate restTemplate;

    /** name → collection UUID 캐시. ensureCollection / list 응답에서 채워짐. */
    private final Map<String, String> collectionIdByName = new ConcurrentHashMap<>();

    @PostConstruct
    void warmupCacheLazily() {
        // 기동 시 한 번만 시도 — Chroma 다운이어도 무시 (실제 사용 시점에 다시 시도).
        if (!ragProperties.isEnabled()) return;
        try {
            refreshCollectionListCache();
        } catch (Exception ignored) {
            // ignore
        }
    }

    /** 법령 컬렉션에서 query 텍스트 기반 top-k 검색. */
    public List<RetrievedChunk> queryLaws(String queryText, int topK) {
        if (!ragProperties.isEnabled()) return List.of();
        return query(ragProperties.getChroma().getLawsCollection(), "LAW", queryText, topK);
    }

    /** 판례 컬렉션에서 query 텍스트 기반 top-k 검색. */
    public List<RetrievedChunk> queryCases(String queryText, int topK) {
        if (!ragProperties.isEnabled()) return List.of();
        return query(ragProperties.getChroma().getCasesCollection(), "CASE", queryText, topK);
    }

    // ─────────────────────── Ingestion-side ───────────────────────

    /**
     * 컬렉션 존재를 보장. 없으면 생성한다.
     * 응답에서 UUID를 추출하여 {@link #collectionIdByName} 캐시에 저장.
     *
     * @return true if 컬렉션 사용 가능 + UUID 캐시 완료, false if 실패
     */
    @SuppressWarnings("unchecked")
    public boolean ensureCollection(String collection) {
        if (!ragProperties.isEnabled()) return false;
        String url = ragProperties.getChroma().getBaseUrl() + "/api/v1/collections";
        Map<String, Object> body = Map.of(
                "name", collection,
                "get_or_create", true
        );
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            ResponseEntity<Map> resp = restTemplate.postForEntity(url, new HttpEntity<>(body, headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                log.warn("[RAG] ensureCollection 응답 비정상: status={}, collection={}",
                        resp.getStatusCode(), collection);
                return false;
            }
            String id = stringOrNull(resp.getBody().get("id"));
            if (id != null) {
                collectionIdByName.put(collection, id);
                log.info("[RAG] 컬렉션 보장 OK: name='{}' uuid={}", collection, id);
                return true;
            }
            log.warn("[RAG] ensureCollection 응답에 id 없음 (body={})", resp.getBody());
            return false;
        } catch (Exception e) {
            log.warn("[RAG] ensureCollection 실패 (collection={}): {}", collection, e.getMessage());
            return false;
        }
    }

    /**
     * chunks를 Chroma 컬렉션에 upsert.
     * @return upsert 성공한 chunk 수 (실패 시 0)
     */
    public int upsertChunks(String collection, List<LegalChunker.Chunk> chunks) {
        if (!ragProperties.isEnabled()) return 0;
        if (chunks == null || chunks.isEmpty()) return 0;

        String collectionId = resolveCollectionId(collection);
        if (collectionId == null) {
            log.warn("[RAG] upsert 중단 — collection UUID 미해석: name={}", collection);
            return 0;
        }

        String url = ragProperties.getChroma().getBaseUrl()
                + "/api/v1/collections/" + collectionId + "/upsert";

        List<String> ids = new ArrayList<>(chunks.size());
        List<String> documents = new ArrayList<>(chunks.size());
        List<Map<String, Object>> metadatas = new ArrayList<>(chunks.size());
        for (LegalChunker.Chunk c : chunks) {
            ids.add(c.getChunkId());
            documents.add(c.getText());
            metadatas.add(c.getMetadata() == null ? Map.of() : c.getMetadata());
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ids", ids);
        body.put("documents", documents);
        body.put("metadatas", metadatas);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            ResponseEntity<String> resp = restTemplate.postForEntity(url, new HttpEntity<>(body, headers), String.class);
            if (resp.getStatusCode().is2xxSuccessful()) {
                log.info("[RAG] upsert 성공: collection='{}' uuid={} count={}",
                        collection, collectionId, chunks.size());
                return chunks.size();
            }
            log.warn("[RAG] upsert HTTP {} body={}: collection={}",
                    resp.getStatusCode(), resp.getBody(), collection);
            return 0;
        } catch (org.springframework.web.client.HttpStatusCodeException httpEx) {
            log.warn("[RAG] upsert HTTP {} body={}: collection={}",
                    httpEx.getStatusCode(), httpEx.getResponseBodyAsString(), collection);
            return 0;
        } catch (Exception e) {
            log.warn("[RAG] upsert 예외 (collection={}): {}", collection, e.getMessage(), e);
            return 0;
        }
    }

    /**
     * 컬렉션 내 문서 개수 조회 (헬스체크/검증용).
     * @return 개수 (실패 시 -1)
     */
    public int countCollection(String collection) {
        if (!ragProperties.isEnabled()) return -1;
        String collectionId = resolveCollectionId(collection);
        if (collectionId == null) {
            log.debug("[RAG] countCollection — collection 미해석 (Chroma 다운 또는 미생성): {}", collection);
            return -1;
        }
        String url = ragProperties.getChroma().getBaseUrl()
                + "/api/v1/collections/" + collectionId + "/count";
        try {
            ResponseEntity<Integer> resp = restTemplate.getForEntity(url, Integer.class);
            return resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null ? resp.getBody() : -1;
        } catch (Exception e) {
            log.warn("[RAG] countCollection 실패 (collection={}): {}", collection, e.getMessage());
            return -1;
        }
    }

    @SuppressWarnings("unchecked")
    private List<RetrievedChunk> query(String collection, String sourceType, String queryText, int topK) {
        if (queryText == null || queryText.isBlank() || topK <= 0) return List.of();

        String collectionId = resolveCollectionId(collection);
        if (collectionId == null) {
            log.debug("[RAG] query 중단 — collection 미해석: {}", collection);
            return List.of();
        }

        String url = ragProperties.getChroma().getBaseUrl()
                + "/api/v1/collections/" + collectionId + "/query";

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query_texts", List.of(queryText));
        body.put("n_results", topK);
        body.put("include", List.of("documents", "metadatas", "distances"));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> req = new HttpEntity<>(body, headers);

        try {
            ResponseEntity<Map> resp = restTemplate.postForEntity(url, req, Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                log.warn("[RAG] Chroma query 응답 오류: status={}, collection={}",
                        resp.getStatusCode(), collection);
                return List.of();
            }
            return parseQueryResponse(resp.getBody(), sourceType);
        } catch (Exception e) {
            log.warn("[RAG] Chroma query 실패 (collection={}): {}", collection, e.getMessage());
            return List.of();
        }
    }

    // ─────────────────────── 헬퍼: name → UUID 해석 ───────────────────────

    /**
     * 캐시 hit 시 즉시 반환, 미스 시 GET /api/v1/collections로 보강.
     * 그래도 못 찾으면 ensureCollection 호출 (자동 생성 + 캐시).
     */
    private String resolveCollectionId(String collection) {
        String cached = collectionIdByName.get(collection);
        if (cached != null) return cached;
        refreshCollectionListCache();
        cached = collectionIdByName.get(collection);
        if (cached != null) return cached;
        // 마지막 fallback: 자동 생성
        if (ensureCollection(collection)) {
            return collectionIdByName.get(collection);
        }
        return null;
    }

    /**
     * GET /api/v1/collections 응답으로 캐시 갱신.
     * Chroma 다운 등 실패는 silent.
     */
    @SuppressWarnings("unchecked")
    private void refreshCollectionListCache() {
        String url = ragProperties.getChroma().getBaseUrl() + "/api/v1/collections";
        try {
            ResponseEntity<List> resp = restTemplate.getForEntity(url, List.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return;
            for (Object item : resp.getBody()) {
                if (item instanceof Map<?, ?> m) {
                    String name = stringOrNull(m.get("name"));
                    String id = stringOrNull(m.get("id"));
                    if (name != null && id != null) {
                        collectionIdByName.put(name, id);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("[RAG] collection list refresh 실패: {}", e.getMessage());
        }
    }

    private static String stringOrNull(Object o) {
        if (o == null) return null;
        String s = o.toString();
        return s.isBlank() ? null : s;
    }

    // ─────────────────────── 응답 파서 ───────────────────────

    @SuppressWarnings("unchecked")
    private List<RetrievedChunk> parseQueryResponse(Map<String, Object> body, String sourceType) {
        List<List<String>> ids = (List<List<String>>) body.getOrDefault("ids", List.of());
        List<List<String>> docs = (List<List<String>>) body.getOrDefault("documents", List.of());
        List<List<Map<String, Object>>> metas = (List<List<Map<String, Object>>>) body.getOrDefault("metadatas", List.of());
        List<List<Number>> dists = (List<List<Number>>) body.getOrDefault("distances", List.of());

        if (ids.isEmpty() || ids.get(0) == null) return List.of();

        List<String> idRow = ids.get(0);
        List<String> docRow = docs.isEmpty() ? List.of() : nullToEmpty(docs.get(0));
        List<Map<String, Object>> metaRow = metas.isEmpty() ? List.of() : nullToEmpty(metas.get(0));
        List<Number> distRow = dists.isEmpty() ? List.of() : nullToEmpty(dists.get(0));

        List<RetrievedChunk> result = new ArrayList<>(idRow.size());
        for (int i = 0; i < idRow.size(); i++) {
            String id = idRow.get(i);
            if (id == null) continue;
            Map<String, Object> meta = i < metaRow.size() ? metaRow.get(i) : Map.of();
            String text = i < docRow.size() ? docRow.get(i) : "";
            Double distance = i < distRow.size() && distRow.get(i) != null ? distRow.get(i).doubleValue() : null;

            Long rowId = null;
            if (meta != null && meta.get("rowId") instanceof Number n) rowId = n.longValue();

            result.add(RetrievedChunk.builder()
                    .chunkId(id)
                    .sourceType(sourceType)
                    .chunkText(text == null ? "" : text)
                    .metadata(meta == null ? Map.of() : meta)
                    .distance(distance)
                    .sourceRowId(rowId)
                    .build());
        }
        return result;
    }

    private static <T> List<T> nullToEmpty(List<T> v) {
        return v == null ? List.of() : v;
    }
}
