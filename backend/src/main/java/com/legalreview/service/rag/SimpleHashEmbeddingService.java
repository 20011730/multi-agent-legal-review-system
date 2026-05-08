package com.legalreview.service.rag;

import java.util.ArrayList;
import java.util.List;

/**
 * Deterministic 해시 기반 임베딩 — 외부 의존성 0. (검증용/Fallback)
 *
 * 발표 자료 RAG 방향과의 관계:
 *   - 본 구현은 "검색 동작 검증"을 위한 임시 fallback. 한국어 char-ngram 단위 매칭만 수행.
 *   - 발표 자료의 목표는 E5 계열 임베딩 모델 (또는 fine-tuned 변형) 기반 의미 매칭.
 *   - {@link EmbeddingService} 인터페이스를 통해 향후 E5/외부 서비스로 1줄 수정으로 교체 가능.
 *
 * Bean 등록은 {@link EmbeddingConfig}에서 {@code app.rag.embedding.provider=simple}일 때 선택.
 */
public class SimpleHashEmbeddingService implements EmbeddingService {

    public static final int DIM = 384;
    private static final int CHAR_NGRAM_MIN = 2;
    private static final int CHAR_NGRAM_MAX = 3;

    @Override
    public int dimension() { return DIM; }

    @Override
    public float[] embed(String text) {
        float[] v = new float[DIM];
        if (text == null || text.isEmpty()) return v;

        String norm = text.toLowerCase().replaceAll("\\s+", " ").trim();
        if (norm.isEmpty()) return v;

        // char n-gram
        for (int n = CHAR_NGRAM_MIN; n <= CHAR_NGRAM_MAX; n++) {
            int len = norm.length();
            for (int i = 0; i + n <= len; i++) {
                String gram = norm.substring(i, i + n);
                int idx = Math.floorMod(stableHash(gram), DIM);
                v[idx] += 1.0f;
            }
        }
        // 공백 토큰 (어휘 가중치)
        for (String w : norm.split(" ")) {
            if (w.isEmpty()) continue;
            int idx = Math.floorMod(stableHash(w), DIM);
            v[idx] += 2.0f;
        }

        // L2 normalize → cosine ≈ dot product
        double n2 = 0.0;
        for (float x : v) n2 += x * x;
        if (n2 > 0.0) {
            float inv = (float) (1.0 / Math.sqrt(n2));
            for (int i = 0; i < v.length; i++) v[i] *= inv;
        }
        return v;
    }

    @Override
    public List<float[]> embedAll(List<String> texts) {
        if (texts == null || texts.isEmpty()) return List.of();
        List<float[]> out = new ArrayList<>(texts.size());
        for (String t : texts) out.add(embed(t));
        return out;
    }

    /**
     * String.hashCode()는 JVM 간 안정적이지만 분포가 균일하지 않으므로
     * FNV-1a 32bit hash로 분포 개선.
     */
    private static int stableHash(String s) {
        int h = 0x811c9dc5;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i) & 0xffff;
            h *= 0x01000193;
        }
        return h;
    }
}
