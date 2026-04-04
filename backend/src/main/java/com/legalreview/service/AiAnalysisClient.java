package com.legalreview.service;

import com.legalreview.dto.request.SessionCreateRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Python AI 서버(FastAPI)를 HTTP로 호출하는 클라이언트.
 * POST /analyze 엔드포인트를 호출하여 토론 메시지와 최종 판정을 받아온다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiAnalysisClient {

    private final RestTemplate restTemplate;

    @Value("${app.ai.base-url}")
    private String aiBaseUrl;

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

        log.info("AI 서버 호출: {} (sessionId={})", url, sessionId);

        Map<String, Object> response = restTemplate.postForObject(url, body, Map.class);

        if (response == null) {
            throw new RuntimeException("AI 서버 응답이 null입니다.");
        }

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
