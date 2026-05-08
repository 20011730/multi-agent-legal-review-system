package com.legalreview.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ollama HTTP API 클라이언트.
 * /api/chat 엔드포인트를 호출하여 LLM 응답을 받는다.
 *
 * 환경변수로 설정 가능:
 * - OLLAMA_BASE_URL (기본: http://localhost:11434)
 * - OLLAMA_MODEL (기본: glm-4.7-flash:q4_K_M)
 * - OLLAMA_TIMEOUT (기본: 120초)
 *
 * RunPod 등 원격 서버로 전환 시 OLLAMA_BASE_URL만 변경하면 된다.
 */
@Slf4j
@Component
public class OllamaClient {

    private final RestTemplate restTemplate;

    @Value("${app.ai.ollama.base-url:http://localhost:11434}")
    private String baseUrl;

    @Value("${app.ai.ollama.model:glm-4.7-flash:q4_K_M}")
    private String model;

    // <think>...</think> 태그 제거용 패턴 (줄바꿈 포함)
    private static final Pattern THINKING_CLOSED_PATTERN =
            Pattern.compile("<think>.*?</think>", Pattern.DOTALL);

    // 닫히지 않는 <think> 태그 — 끝까지 모두 제거
    private static final Pattern THINKING_UNCLOSED_PATTERN =
            Pattern.compile("<think>.*", Pattern.DOTALL);

    public OllamaClient(
            @Value("${app.ai.ollama.timeout-seconds:300}") int timeoutSeconds
    ) {
        this.restTemplate = new RestTemplateBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .readTimeout(Duration.ofSeconds(timeoutSeconds))
                .build();
    }

    /**
     * Ollama /api/chat 호출.
     *
     * @param systemPrompt 시스템 프롬프트
     * @param userPrompt   사용자 프롬프트
     * @return thinking 태그가 제거된 최종 응답 텍스트
     */
    @SuppressWarnings("unchecked")
    public String chat(String systemPrompt, String userPrompt) {
        String url = baseUrl + "/api/chat";

        Map<String, Object> body = Map.of(
                "model", model,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                ),
                "stream", false
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        log.debug("Ollama 호출: model={}, url={}", model, url);

        Map<String, Object> response = restTemplate.postForObject(url, entity, Map.class);
        if (response == null) {
            throw new RuntimeException("Ollama 응답이 null입니다.");
        }

        // 응답 구조: { "message": { "content": "..." }, ... }
        Map<String, Object> message = (Map<String, Object>) response.get("message");
        if (message == null) {
            throw new RuntimeException("Ollama 응답에 message 필드가 없습니다: " + response);
        }

        String rawContent = (String) message.get("content");
        return stripThinking(rawContent);
    }

    /**
     * <think>...</think> 태그와 그 안의 내용을 제거한다.
     * 일부 모델(DeepSeek, GLM 등)이 reasoning을 think 태그로 감싸서 출력하므로,
     * 최종 사용자에게 보여줄 텍스트에서는 제거한다.
     */
    String stripThinking(String text) {
        if (text == null) return "";

        // 1) 닫힌 <think>...</think> 제거
        String result = THINKING_CLOSED_PATTERN.matcher(text).replaceAll("");

        // 2) 닫히지 않은 <think>... (끝까지) 제거
        result = THINKING_UNCLOSED_PATTERN.matcher(result).replaceAll("");

        result = result.strip();

        // 3) 빈 결과 방지 — thinking만 있고 본문이 없는 경우
        if (result.isEmpty()) {
            log.warn("stripThinking 후 빈 텍스트 — 원본 길이: {}", text.length());
            return "(응답 생성 중 오류가 발생했습니다. 다시 시도해주세요.)";
        }

        return result;
    }

    /**
     * Ollama 서버 연결 확인 (헬스체크).
     * GET /api/tags 호출 — 성공하면 true.
     */
    public boolean isAvailable() {
        try {
            restTemplate.getForObject(baseUrl + "/api/tags", Map.class);
            return true;
        } catch (Exception e) {
            log.warn("Ollama 서버 연결 불가: {}", e.getMessage());
            return false;
        }
    }
}
