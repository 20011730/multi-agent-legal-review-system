package com.legalreview.service;

import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class SessionService {

    // 메모리 기반 세션 저장소 (DB 연결 전까지 사용)
    private final Map<Long, SessionCreateRequest> sessionStore = new ConcurrentHashMap<>();
    private final AtomicLong idGenerator = new AtomicLong(1);

    /**
     * 세션 생성: 프론트에서 받은 입력 데이터를 저장하고 sessionId 반환
     */
    public SessionCreateResponse createSession(SessionCreateRequest request) {
        Long sessionId = idGenerator.getAndIncrement();
        sessionStore.put(sessionId, request);
        return new SessionCreateResponse(sessionId, "CREATED");
    }

    /**
     * 토론 결과 조회: 현재는 더미 응답 반환
     * 추후 이 메서드 내부를 AI 서버 호출로 교체하면 됨
     */
    public DebateResultResponse getLatestDebateResult(Long sessionId) {
        if (!sessionStore.containsKey(sessionId)) {
            throw new IllegalArgumentException("Session not found: " + sessionId);
        }

        List<AgentMessageDto> messages = List.of(
                new AgentMessageDto(
                        "legal",
                        "법률 전문가",
                        "표시광고법 위반 가능성이 있습니다. '업계 1위보다 2배 빠른 성능'이라는 표현은 객관적 근거 없이 사용할 경우 거짓·과장 광고에 해당할 수 있습니다.",
                        "analysis",
                        1,
                        "CON",
                        "표시광고법 제3조(거짓·과장 광고 금지) 위반 가능성"
                ),
                new AgentMessageDto(
                        "risk",
                        "리스크 관리자",
                        "마케팅 효과 측면에서 강한 비교 표현은 소비자 관심을 끌 수 있습니다. 다만, 법적 리스크를 고려하면 표현 수정이 바람직합니다.",
                        "concern",
                        1,
                        "PRO",
                        "마케팅 효과 긍정적, 그러나 리스크 대비 필요"
                ),
                new AgentMessageDto(
                        "ethics",
                        "윤리 검토자",
                        "근거 없는 비교 광고는 소비자 신뢰를 저하시킬 수 있으며, 경쟁사와의 불필요한 분쟁을 유발할 수 있습니다.",
                        "recommendation",
                        1,
                        "CON",
                        "소비자 신뢰 저하 및 경쟁사 분쟁 위험"
                )
        );

        List<RiskItemDto> risks = List.of(
                new RiskItemDto("법률 리스크", "high", "표시광고법 위반 가능성 (거짓·과장 광고)"),
                new RiskItemDto("재무 리스크", "medium", "과징금 및 시정명령 가능성"),
                new RiskItemDto("평판 리스크", "medium", "소비자 신뢰 저하 우려"),
                new RiskItemDto("경쟁 리스크", "low", "경쟁사 비교 광고 분쟁 가능성")
        );

        FinalDecisionDto finalDecision = new FinalDecisionDto(
                "conditional",
                "HIGH",
                risks,
                "현재 문구는 법적 리스크가 높아 수정이 필요합니다. 3개 에이전트 중 2개가 반대 의견을 제시했습니다.",
                "객관적 근거가 있는 표현만 남기고, 비교 대상이나 수치를 명확히 하거나 과장 표현을 제거해야 합니다.",
                "자체 테스트 기준 기존 제품 대비 2배 빠른 처리 성능 (2024년 내부 벤치마크 기준)"
        );

        return new DebateResultResponse(sessionId, 1L, "COMPLETED", messages, finalDecision);
    }
}
