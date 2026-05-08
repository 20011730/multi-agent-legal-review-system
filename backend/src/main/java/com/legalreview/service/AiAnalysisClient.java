package com.legalreview.service;

import com.legalreview.dto.request.SessionCreateRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Python AI 서버(FastAPI)를 HTTP로 호출하는 클라이언트.
 * POST /analyze 엔드포인트를 호출하여 토론 메시지와 최종 판정을 받아온다.
 *
 * timeout 정책:
 *   - {@code aiAnalysisRestTemplate} (별도 Bean) 사용
 *   - read-timeout 기본 900초(15분) — LangGraph + RunPod/Ollama 호출의 긴 latency 수용
 *   - {@code AI_READ_TIMEOUT_SECONDS} / {@code AI_CONNECT_TIMEOUT_SECONDS} 환경변수로 조정 가능
 *
 * 비동기 흐름:
 *   본 메서드는 {@code AnalysisAsyncRunner.runAnalysis(@Async)}에서 호출되므로 backend 응답
 *   thread를 점유하지 않는다. 즉 본 timeout은 "사용자가 기다리는 시간"이 아니라
 *   "backend↔Python AI Server 단일 HTTP 호출 허용시간"이다.
 *   프론트는 별도 polling(/api/sessions/{id}/status)으로 진행 상황을 받으므로 영향 없음.
 */
@Slf4j
@Component
public class AiAnalysisClient {

    private final RestTemplate restTemplate;

    @Value("${app.ai.base-url}")
    private String aiBaseUrl;

    @Value("${app.ai.read-timeout-seconds:900}")
    private int readTimeoutSeconds;

    public AiAnalysisClient(@Qualifier("aiAnalysisRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * Python AI 서버에 분석 요청을 보내고 응답을 반환한다.
     *
     * @param sessionId 세션 ID
     * @param request   사용자 입력 데이터
     * @return AI 서버 응답 (messages + finalDecision)
     */
    @SuppressWarnings("unchecked")
    public AiAnalysisResponse analyze(Long sessionId, SessionCreateRequest request) {
        String url = aiBaseUrl + "/analyze";

        Map<String, Object> body = Map.of(
                "sessionId", sessionId,
                "companyName", request.getCompanyName(),
                "industry", request.getIndustry(),
                "reviewType", request.getReviewType(),
                "situation", request.getSituation(),
                "content", request.getContent(),
                "participationMode", request.getParticipationMode()
        );

        long t0 = System.currentTimeMillis();
        log.info("AI 서버 호출 시작: {} (sessionId={}, readTimeout={}s)",
                url, sessionId, readTimeoutSeconds);

        Map<String, Object> response;
        try {
            response = restTemplate.postForObject(url, body, Map.class);
        } catch (ResourceAccessException e) {
            // SocketTimeoutException(Read timed out / Connect timed out) 등이 여기로 옴
            long elapsed = (System.currentTimeMillis() - t0) / 1000;
            log.error("AI 서버 호출 실패 (sessionId={}, elapsed={}s, readTimeout={}s) — {}",
                    sessionId, elapsed, readTimeoutSeconds, e.getMessage());
            throw new RuntimeException(
                    "AI 서버 호출 실패: " + e.getMessage()
                            + " (elapsed=" + elapsed + "s, readTimeout=" + readTimeoutSeconds + "s) "
                            + "— AI_READ_TIMEOUT_SECONDS 환경변수를 늘리거나 RunPod/Ollama 응답을 확인하세요",
                    e
            );
        }

        if (response == null) {
            throw new RuntimeException("AI 서버 응답이 null입니다.");
        }

        long elapsed = (System.currentTimeMillis() - t0) / 1000;
        log.info("AI 서버 응답 수신 완료 (sessionId={}, elapsed={}s)", sessionId, elapsed);

        List<Map<String, Object>> messages = (List<Map<String, Object>>) response.get("messages");
        Map<String, Object> finalDecision = (Map<String, Object>) response.get("finalDecision");
        List<Map<String, Object>> evidences = (List<Map<String, Object>>) response.get("evidences");

        return new AiAnalysisResponse(messages, finalDecision, evidences);
    }

    /**
     * AI 서버 응답 데이터를 담는 record.
     */
    public record AiAnalysisResponse(
            List<Map<String, Object>> messages,
            Map<String, Object> finalDecision,
            List<Map<String, Object>> evidences
    ) {}
}
