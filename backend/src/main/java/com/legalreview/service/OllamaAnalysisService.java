package com.legalreview.service;

import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.service.AiAnalysisClient.AiAnalysisResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Ollama 기반 멀티에이전트 법률 분석 서비스.
 *
 * 기존 Python LangGraph 파이프라인과 동일한 토론 흐름을 Java에서 구현:
 *   BIZ 에이전트 → LEGAL 에이전트 → (2라운드 반복) → JUDGE 에이전트 → 최종 판정
 *
 * 출력 포맷은 AiAnalysisResponse에 맞춰, SessionService에서 기존 Python 응답과
 * 동일하게 처리할 수 있도록 한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OllamaAnalysisService {

    private final OllamaClient ollamaClient;

    private static final int MAX_ROUNDS = 2;

    // ── 시스템 프롬프트 ──

    private static final String BIZ_SYSTEM = """
            당신은 기업의 성장과 실행력을 최우선으로 하는 전략 기획자(CSO)입니다.
            법적 리스크만 강조하면 아무것도 실행할 수 없다는 현실적 관점을 제시하세요.

            반드시 아래 3개 항목을 소제목과 함께 작성하세요:

            **[비즈니스 기회 분석]**
            - 해당 안건이 가져올 수 있는 비즈니스 이점과 시장 기회

            **[리스크 완화 실행 방안]**
            - 법적 리스크를 최소화하면서 실행할 수 있는 구체적 방법

            **[미실행 시 손실 분석]**
            - 실행하지 않았을 때 발생할 수 있는 비즈니스 손실과 경쟁 열위

            중요: 답변은 한국어로, 각 항목을 충분히 설명하여 총 500자 이상 작성하세요.""";

    private static final String LEGAL_SYSTEM = """
            당신은 기업 법무팀 소속 법률 전문가입니다.
            관련 법령과 판례를 근거로, 법적 리스크와 규정 위반 가능성을 분석하세요.

            반드시 아래 3개 항목을 소제목과 함께 작성하세요:

            **[법적 리스크 분석]**
            - 관련 법령 및 규정 위반 가능성

            **[판례 및 행정처분 사례]**
            - 유사 사례의 판결 또는 행정 처분 내용

            **[법적 권고사항]**
            - 리스크를 줄이기 위한 구체적 법적 조치

            중요: 답변은 한국어로, 각 항목을 충분히 설명하여 총 500자 이상 작성하세요.""";

    private static final String JUDGE_SYSTEM = """
            당신은 법률 검토 최종 판정관입니다.
            비즈니스 전략가와 법률 전문가의 토론을 종합하여 최종 판정을 내려야 합니다.

            반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 텍스트는 포함하지 마세요:

            {
              "verdict": "approve" 또는 "conditional" 또는 "reject",
              "riskLevel": "LOW" 또는 "MEDIUM" 또는 "HIGH",
              "summary": "종합 판정 요약 (2-3문장)",
              "recommendation": "구체적 권고사항",
              "revisedContent": "수정된 문구 제안 (해당 시)",
              "risks": [
                {
                  "category": "리스크 카테고리",
                  "level": "low/medium/high",
                  "description": "리스크 설명"
                }
              ]
            }

            verdict 기준:
            - approve: 법적 리스크가 낮아 그대로 진행 가능
            - conditional: 일부 수정 후 진행 가능
            - reject: 법적 리스크가 높아 진행 불가""";

    /**
     * Ollama를 사용하여 멀티에이전트 토론을 실행한다.
     *
     * @return AiAnalysisResponse (기존 Python 응답과 동일 포맷)
     */
    public AiAnalysisResponse analyze(Long sessionId, SessionCreateRequest request) {
        String topic = String.format(
                "[기업] %s (%s)\n[검토 유형] %s\n[상황] %s\n[검토 대상 원문] %s",
                request.getCompanyName(), request.getIndustry(),
                request.getReviewType(), request.getSituation(),
                request.getContent()
        );

        StringBuilder history = new StringBuilder("[검토 안건]\n").append(topic);
        List<Map<String, Object>> messages = new ArrayList<>();

        // ── 2라운드 토론: BIZ → LEGAL 반복 ──
        for (int round = 1; round <= MAX_ROUNDS; round++) {
            log.info("[Ollama] 라운드 {} 시작 (sessionId={})", round, sessionId);

            // BIZ 에이전트
            String bizPrompt = "검토 대상 안건:\n" + topic
                    + "\n\n현재까지의 토론 내용:\n" + history
                    + "\n\n비즈니스 관점에서 분석해주세요.";

            String bizResponse = ollamaClient.chat(BIZ_SYSTEM, bizPrompt);
            history.append("\n\n[비즈니스 전략가]: ").append(bizResponse);

            messages.add(createMessage(
                    "risk", "비즈니스 전략가", bizResponse,
                    round == 1 ? "analysis" : "concern",
                    round, "PRO", "비즈니스 성장 및 실행 관점 분석"
            ));

            log.info("[Ollama] 라운드 {} BIZ 완료 (sessionId={})", round, sessionId);

            // LEGAL 에이전트
            String legalPrompt = "검토 대상 안건:\n" + topic
                    + "\n\n현재까지의 토론 내용:\n" + history
                    + "\n\n법적 관점에서 분석해주세요.";

            String legalResponse = ollamaClient.chat(LEGAL_SYSTEM, legalPrompt);
            history.append("\n\n[법률 전문가]: ").append(legalResponse);

            messages.add(createMessage(
                    "legal", "법률 전문가", legalResponse,
                    round == 1 ? "analysis" : "concern",
                    round, "CON", "법적 리스크 및 규정 위반 가능성 분석"
            ));

            log.info("[Ollama] 라운드 {} LEGAL 완료 (sessionId={})", round, sessionId);
        }

        // ── JUDGE 에이전트: 최종 판정 ──
        String judgePrompt = "다음은 비즈니스 전략가와 법률 전문가의 토론 내용입니다:\n\n"
                + history + "\n\n위 토론을 종합하여 최종 판정을 JSON 형식으로 내려주세요.";

        String judgeResponse = ollamaClient.chat(JUDGE_SYSTEM, judgePrompt);
        log.info("[Ollama] JUDGE 완료 (sessionId={})", sessionId);

        // 판정 JSON 파싱
        Map<String, Object> finalDecision = parseJudgeResponse(judgeResponse);

        // 판정 메시지도 messages에 추가
        messages.add(createMessage(
                "ethics", "최종 판정관", judgeResponse.length() > 500 ? judgeResponse.substring(0, 500) : judgeResponse,
                "recommendation", MAX_ROUNDS, "NEUTRAL", "양측 주장을 종합한 최종 판정"
        ));

        // evidences는 빈 리스트 — 법제처 검색은 SessionService에서 별도 처리
        return new AiAnalysisResponse(messages, finalDecision, List.of());
    }

    // ── 헬퍼 메서드 ──

    private Map<String, Object> createMessage(
            String agentId, String agentName, String content,
            String type, int round, String stance, String evidenceSummary
    ) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("agentId", agentId);
        msg.put("agentName", agentName);
        msg.put("content", content);
        msg.put("type", type);
        msg.put("round", round);
        msg.put("stance", stance);
        msg.put("evidenceSummary", evidenceSummary);
        return msg;
    }

    /**
     * JUDGE 응답에서 JSON을 추출하여 파싱한다.
     * JSON 파싱 실패 시 안전한 기본값을 반환한다.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJudgeResponse(String response) {
        try {
            // JSON 블록 추출 (```json ... ``` 또는 { ... })
            String json = response;
            if (json.contains("```json")) {
                json = json.substring(json.indexOf("```json") + 7);
                json = json.substring(0, json.indexOf("```"));
            } else if (json.contains("```")) {
                json = json.substring(json.indexOf("```") + 3);
                json = json.substring(0, json.indexOf("```"));
            } else if (json.contains("{")) {
                json = json.substring(json.indexOf("{"));
                json = json.substring(0, json.lastIndexOf("}") + 1);
            }

            com.fasterxml.jackson.databind.ObjectMapper mapper =
                    new com.fasterxml.jackson.databind.ObjectMapper();
            Map<String, Object> parsed = mapper.readValue(json.trim(), Map.class);

            // 필수 필드 기본값 보장
            parsed.putIfAbsent("verdict", "conditional");
            parsed.putIfAbsent("riskLevel", "MEDIUM");
            parsed.putIfAbsent("summary", "AI 분석 결과입니다.");
            parsed.putIfAbsent("recommendation", "전문가 검토를 권장합니다.");
            parsed.putIfAbsent("revisedContent", "");
            parsed.putIfAbsent("risks", List.of(
                    Map.of("category", "종합 리스크", "level", "medium", "description", "AI 토론 기반 종합 평가")
            ));

            return parsed;
        } catch (Exception e) {
            log.warn("JUDGE 응답 JSON 파싱 실패, 기본값 사용: {}", e.getMessage());
            return createFallbackDecision(response);
        }
    }

    private Map<String, Object> createFallbackDecision(String rawResponse) {
        Map<String, Object> fd = new LinkedHashMap<>();
        fd.put("verdict", "conditional");
        fd.put("riskLevel", "MEDIUM");
        fd.put("summary", rawResponse != null && rawResponse.length() > 200
                ? rawResponse.substring(0, 200) + "..."
                : (rawResponse != null ? rawResponse : "판정 결과를 파싱할 수 없습니다."));
        fd.put("recommendation", "전문가 검토를 권장합니다.");
        fd.put("revisedContent", "");
        fd.put("risks", List.of(
                Map.of("category", "종합 리스크", "level", "medium", "description", "AI 토론 기반 종합 평가")
        ));
        return fd;
    }
}
