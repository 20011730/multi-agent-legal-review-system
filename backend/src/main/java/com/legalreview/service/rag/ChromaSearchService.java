package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.rag.RetrievedChunk;
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

/**
 * Chroma DB REST API 클라이언트.
 *
 * Chroma 기본 REST endpoint:
 *   POST {baseUrl}/api/v1/collections/{collection}/query
 *   body: { "query_texts": ["..."], "n_results": k, "include": ["documents","metadatas","distances"] }
 *
 * 컬렉션의 default_embedding_function이 설정되어 있으면 query_texts만으로 동작.
 * 없으면 query_embeddings를 직접 보내야 한다 (TODO: embedding API 연동).
 *
 * RAG가 비활성이거나 Chroma가 다운된 경우 빈 결과를 반환하여 호출 측이 안전하게 fallback할 수 있게 한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChromaSearchService {

    private final RagProperties ragProperties;
    private final RestTemplate restTemplate;

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
     * Chroma v2 호환을 위해 기본 tenant/database 사용.
     * 이미 존재하면 200 또는 409가 올 수 있으니 모두 OK로 간주.
     *
     * @return true if 컬렉션 사용 가능 (생성 또는 이미 존재), false if Chroma 다운 등 실패
     */
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
            boolean ok = resp.getStatusCode().is2xxSuccessful();
            if (ok) log.info("[RAG] 컬렉션 보장 완료: {}", collection);
            return ok;
        } catch (Exception e) {
            log.warn("[RAG] ensureCollection 실패 (collection={}): {}", collection, e.getMessage());
            return false;
        }
    }

    /**
     * chunks를 Chroma 컬렉션에 upsert.
     * Chroma 기본 동작: ids에 같은 값이 있으면 overwrite. 없으면 insert.
     *
     * embeddings를 함께 보내지 않으면 Chroma 서버의 default_embedding_function이
     * documents 텍스트로부터 자동 임베딩한다 (chromadb 기본 ONNX sentence-transformers).
     *
     * @return upsert 성공한 chunk 수 (실패 시 0)
     */
    public int upsertChunks(String collection, List<LegalChunker.Chunk> chunks) {
        if (!ragProperties.isEnabled()) return 0;
        if (chunks == null || chunks.isEmpty()) return 0;

        String url = ragProperties.getChroma().getBaseUrl() + "/api/v1/collections/" + collection + "/upsert";

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
            ResponseEntity<Map> resp = restTemplate.postForEntity(url, new HttpEntity<>(body, headers), Map.class);
            if (resp.getStatusCode().is2xxSuccessful()) {
                log.info("[RAG] upsert 성공: collection={}, count={}", collection, chunks.size());
                return chunks.size();
            }
            log.warn("[RAG] upsert 실패 status={}: collection={}", resp.getStatusCode(), collection);
            return 0;
        } catch (Exception e) {
            log.warn("[RAG] upsert 예외 (collection={}): {}", collection, e.getMessage());
            return 0;
        }
    }

    /**
     * 컬렉션 내 문서 개수 조회 (헬스체크/검증용).
     * @return 개수 (실패 시 -1)
     */
    public int countCollection(String collection) {
        if (!ragProperties.isEnabled()) return -1;
        String url = ragProperties.getChroma().getBaseUrl() + "/api/v1/collections/" + collection + "/count";
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

        String url = ragProperties.getChroma().getBaseUrl() + "/api/v1/collections/" + collection + "/query";

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
                log.warn("[RAG] Chroma 응답 오류: status={}, collection={}", resp.getStatusCode(), collection);
                return List.of();
            }
            return parseQueryResponse(resp.getBody(), sourceType);
        } catch (Exception e) {
            // Chroma 다운/연결 실패 — 호출 측에서 빈 리스트로 fallback 처리하도록 빈 결과 반환
            log.warn("[RAG] Chroma query 실패 (collection={}): {}", collection, e.getMessage());
            return List.of();
        }
    }

    /**
     * Chroma 응답 파싱.
     * 응답 구조 예시:
     * {
     *   "ids":[["law:1:art:42", ...]],
     *   "documents":[["조문 본문", ...]],
     *   "metadatas":[[{...}, ...]],
     *   "distances":[[0.12, ...]]
     * }
     * (외곽 배열은 query_texts 개수, 내부 배열은 n_results.)
     */
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
