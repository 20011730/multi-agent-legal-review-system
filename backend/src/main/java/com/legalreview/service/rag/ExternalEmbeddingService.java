package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 외부 HTTP 임베딩 마이크로서비스 클라이언트.
 *
 * 가정한 외부 API 스펙 (sentence-transformers / bge-m3 호스트 기준):
 *   POST {baseUrl}{embedPath}
 *     body  : {"texts": ["...", "..."]}
 *     resp  : {"embeddings": [[0.1, ...], [0.2, ...]]}
 *
 * 외부 서비스가 다른 스펙(예: OpenAI 호환 /embeddings)이면 본 클래스 한 곳만 수정.
 *
 * 예외 시:
 *   - 네트워크/HTTP 실패 → {@link SimpleHashEmbeddingService} fallback로 빈 벡터가 아니라
 *     단순 hash 임베딩 반환하여 검색 자체는 동작하게 한다 (graceful degradation).
 *
 * Bean 등록은 {@link EmbeddingConfig}에서 {@code app.rag.embedding.provider=external}일 때 선택.
 */
@Slf4j
public class ExternalEmbeddingService implements EmbeddingService {

    private final RagProperties props;
    private final RestTemplate restTemplate;
    private final EmbeddingService fallback;

    public ExternalEmbeddingService(RagProperties props, RestTemplate restTemplate, EmbeddingService fallback) {
        this.props = props;
        this.restTemplate = restTemplate;
        this.fallback = fallback;
    }

    @Override
    public int dimension() {
        return props.getEmbedding().getDimension();
    }

    @Override
    public float[] embed(String text) {
        return embedAll(List.of(text == null ? "" : text)).get(0);
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<float[]> embedAll(List<String> texts) {
        if (texts == null || texts.isEmpty()) return List.of();
        String url = props.getEmbedding().getExternal().getBaseUrl()
                + props.getEmbedding().getExternal().getEmbedPath();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        Map<String, Object> body = Map.of("texts", texts);

        try {
            ResponseEntity<Map> resp = restTemplate.postForEntity(url, new HttpEntity<>(body, headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                log.warn("[EMBED-EXT] HTTP {} — fallback 사용", resp.getStatusCode());
                return fallback.embedAll(texts);
            }
            Object emb = resp.getBody().get("embeddings");
            if (!(emb instanceof List<?> outer) || outer.isEmpty()) {
                log.warn("[EMBED-EXT] 응답에 embeddings 없음 — fallback");
                return fallback.embedAll(texts);
            }
            List<float[]> out = new ArrayList<>(outer.size());
            for (Object row : outer) {
                if (!(row instanceof List<?> rowList)) {
                    out.add(new float[dimension()]);
                    continue;
                }
                float[] vec = new float[rowList.size()];
                for (int i = 0; i < rowList.size(); i++) {
                    Object v = rowList.get(i);
                    vec[i] = (v instanceof Number n) ? n.floatValue() : 0f;
                }
                out.add(vec);
            }
            return out;
        } catch (Exception e) {
            log.warn("[EMBED-EXT] 호출 실패 — fallback (url={}): {}", url, e.getMessage());
            return fallback.embedAll(texts);
        }
    }
}
