package com.legalreview.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * RestTemplate Bean 정의.
 *
 * 두 종류의 Bean을 분리:
 *  1) {@link #restTemplate()}                 — 기본 (Chroma / 법제처 / 외부 임베딩 등 짧은 호출용)
 *  2) {@link #aiAnalysisRestTemplate(int, int)} — Python AI Server(/analyze) 전용 (긴 timeout)
 *
 * Python AI Server는 LangGraph 멀티에이전트 토론 + RunPod/Ollama LLM 호출까지 처리하므로
 * 모델 크기/라운드 수에 따라 단일 호출이 수 분 ~ 10여 분 소요될 수 있다. 따라서 AI 전용 Bean에는
 * 큰 read-timeout을 적용한다.
 *
 * 환경변수 / application.yml 키:
 *  - {@code app.ai.connect-timeout-seconds}  (default 30)
 *  - {@code app.ai.read-timeout-seconds}     (default 900 = 15분)
 *
 * 비고:
 *  - 프론트엔드는 {@code AnalysisAsyncRunner}가 @Async로 background 실행하므로 본 timeout 값은
 *    사용자 응답 대기 시간이 아니라 backend↔Python 단일 HTTP 호출의 최대 허용시간이다.
 *  - 프론트의 polling(/api/sessions/{id}/status)은 매우 짧은 호출이라 timeout과 무관하게 안전.
 */
@Configuration
public class RestTemplateConfig {

    /**
     * 기본 RestTemplate — 짧은 외부 호출용 (Chroma / 법제처 / 외부 임베딩 등).
     * 기존 동작 호환을 위해 기존 timeout(180초) 유지.
     */
    @Bean
    @Primary
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);   // 10s
        factory.setReadTimeout(180_000);     // 180s (Chroma upsert 등까지 커버)
        return new RestTemplate(factory);
    }

    /**
     * Python AI Server(/analyze) 전용 RestTemplate (긴 timeout 적용).
     * Bean 이름 = "aiAnalysisRestTemplate" — {@code AiAnalysisClient}가 {@code @Qualifier}로 주입.
     */
    @Bean(name = "aiAnalysisRestTemplate")
    public RestTemplate aiAnalysisRestTemplate(
            @Value("${app.ai.connect-timeout-seconds:30}") int connectTimeoutSeconds,
            @Value("${app.ai.read-timeout-seconds:900}") int readTimeoutSeconds
    ) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(connectTimeoutSeconds).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(readTimeoutSeconds).toMillis());
        return new RestTemplate(factory);
    }
}
