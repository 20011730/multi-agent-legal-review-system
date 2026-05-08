package com.legalreview.service.rag;

import java.util.List;

/**
 * 텍스트 → 고정 차원 float 벡터 임베딩.
 *
 * 현재 구현: {@link SimpleHashEmbeddingService} (deterministic char-ngram hashing — 의존성 0).
 * 향후 교체 후보:
 *   - PythonEmbeddingClient (sentence-transformers/bge-m3 HTTP 호출) — 한국어 의미 매칭 품질
 *   - OpenAiEmbeddingClient (text-embedding-3-small) 등 외부 API
 *
 * 호출 측은 Spring Bean을 인터페이스로 주입받아 구현체 교체 가능.
 */
public interface EmbeddingService {
    int dimension();
    float[] embed(String text);
    List<float[]> embedAll(List<String> texts);
}
