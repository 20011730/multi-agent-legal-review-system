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
                // === 라운드 1: 초기 분석 ===
                new AgentMessageDto(
                        "legal", "법률 전문가",
                        "표시·광고의 공정화에 관한 법률 제3조 및 제4조를 기준으로 분석하겠습니다. '업계 1위 제품보다 2배 빠른 성능'이라는 표현에 대한 객관적 근거 자료 확인이 필요합니다.",
                        "analysis", 1, "CON",
                        "표시광고법 제3조(거짓·과장 광고 금지) 위반 가능성"
                ),
                new AgentMessageDto(
                        "risk", "리스크 관리자",
                        "비교 광고 측면에서 리스크를 검토하겠습니다. 특정 경쟁사를 직접 지칭하지는 않았으나, '업계 1위'라는 표현이 특정 업체를 암시할 수 있습니다. 경쟁사의 대응 가능성을 고려해야 합니다.",
                        "analysis", 1, "CON",
                        "경쟁사 암시 표현, 대응 리스크 존재"
                ),
                new AgentMessageDto(
                        "ethics", "윤리 검토자",
                        "'타사 제품은 구시대 유물'이라는 표현에서 과도한 비하 표현이 감지됩니다. 경쟁사에 대한 존중 부족은 기업 이미지에 부정적 영향을 줄 수 있습니다.",
                        "concern", 1, "CON",
                        "경쟁사 비하 표현, 기업 이미지 리스크"
                ),

                // === 라운드 2: 심화 검토 ===
                new AgentMessageDto(
                        "legal", "법률 전문가",
                        "표시광고법 제3조 제1항 제1호 '거짓·과장 광고'에 해당할 가능성이 있습니다. '2배 빠른 성능'에 대한 시험·조사 기관의 객관적 검증 자료가 없다면 법적 분쟁 소지가 있습니다. 공정거래위원회 제재 사례 검토 필요.",
                        "concern", 2, "CON",
                        "거짓·과장 광고 해당 가능성, 공정위 제재 리스크"
                ),
                new AgentMessageDto(
                        "risk", "리스크 관리자",
                        "'한정 수량', '지금 구매', '놓치면 후회' 등 긴박감 조성 표현이 과도합니다. 실제 재고 상황과 무관한 허위 희소성 강조는 소비자 기만으로 간주될 수 있으며, 소비자 불만 및 환불 요구 증가 가능성이 있습니다.",
                        "concern", 2, "CON",
                        "허위 희소성 조성, 소비자 기만 리스크"
                ),
                new AgentMessageDto(
                        "ethics", "윤리 검토자",
                        "소비자 자율성 존중 관점에서 검토합니다. '서둘러 주문', '후회합니다' 등의 압박적 표현은 소비자의 합리적 판단을 방해할 수 있습니다. ESG 경영 측면에서 소비자 중심적 커뮤니케이션이 필요합니다.",
                        "analysis", 2, "CON",
                        "소비자 자율성 침해, ESG 부합 필요"
                ),

                // === 라운드 3: 최종 권고 ===
                new AgentMessageDto(
                        "legal", "법률 전문가",
                        "법적 안전성 확보를 위해 다음을 권고합니다: 1) 성능 비교 데이터의 출처 명시 2) '당사 기준' 또는 '특정 조건 하' 등 한정 표현 추가 3) 비교 대상 제품의 구체적 명시 또는 일반화된 표현으로 수정",
                        "recommendation", 3, "CON",
                        "출처 명시, 한정 표현 추가, 비교 대상 일반화 권고"
                ),
                new AgentMessageDto(
                        "risk", "리스크 관리자",
                        "리스크 완화 방안: 1) 경쟁사 비하 표현 전면 삭제 2) 할인율 및 사은품 관련 상세 조건 명시 3) 한정 수량의 실제 물량 및 기간 구체화 4) 사후 소비자 불만 대응 프로세스 사전 준비",
                        "recommendation", 3, "CON",
                        "비하 삭제, 조건 명시, 대응 프로세스 필요"
                ),
                new AgentMessageDto(
                        "ethics", "윤리 검토자",
                        "윤리적 개선 방안: 1) 자사 제품의 강점을 긍정적으로 표현 (비교 대신 절대적 가치 강조) 2) 소비자 선택권 존중하는 톤앤매너 적용 3) 압박적 표현 대신 혜택 중심 정보 제공 4) 공정하고 투명한 커뮤니케이션 원칙 준수",
                        "recommendation", 3, "CON",
                        "긍정 표현 전환, 소비자 존중, 투명성 확보"
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
