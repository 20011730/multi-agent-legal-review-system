package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.client.RestTemplate;

/**
 * EmbeddingService Bean 라우팅.
 *
 * application.yml#app.rag.embedding.provider 값에 따라:
 *   - "simple"   (default) → {@link SimpleHashEmbeddingService}
 *   - "external"           → {@link ExternalEmbeddingService} (HTTP 마이크로서비스, 실패 시 simple로 fallback)
 *   - "e5"                 → 현재는 simple로 위임 (TODO: ONNX/HTTP E5 어댑터 추가)
 *
 * 향후 발표 자료 기준 E5/fine-tuned 모델 도입 시:
 *   1) E5EmbeddingService 신설 (ONNX runtime 또는 별도 Python 서비스 호출)
 *   2) 본 Configuration에 case "e5" → new E5EmbeddingService(...)
 *   3) APP_RAG_EMBEDDING_PROVIDER=e5 환경변수 + chunked=false reset 후 재적재
 *
 * 동일한 chunk 차원 호환성을 위해 모든 구현체는 {@link RagProperties.Embedding#getDimension()}을 따른다.
 */
@Slf4j
@Configuration
public class EmbeddingConfig {

    @Bean
    @Primary
    public EmbeddingService embeddingService(RagProperties props, RestTemplate restTemplate) {
        String provider = props.getEmbedding().getProvider();
        if (provider == null || provider.isBlank()) provider = "simple";
        provider = provider.toLowerCase();

        log.info("[RAG] EmbeddingService provider={}, model={}, dim={}",
                provider, props.getEmbedding().getModel(), props.getEmbedding().getDimension());

        // simple은 항상 기본 fallback으로 인스턴스화
        SimpleHashEmbeddingService simple = new SimpleHashEmbeddingService();

        return switch (provider) {
            case "external" -> {
                log.info("[RAG] external embedding URL={}{}",
                        props.getEmbedding().getExternal().getBaseUrl(),
                        props.getEmbedding().getExternal().getEmbedPath());
                yield new ExternalEmbeddingService(props, restTemplate, simple);
            }
            case "e5" -> {
                log.warn("[RAG] e5 provider는 아직 구현 stub — simple로 fallback");
                yield simple;
            }
            default -> simple;
        };
    }
}
