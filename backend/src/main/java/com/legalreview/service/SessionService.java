package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class SessionService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;

    /**
     * 세션 생성 → DB 저장 → 더미 토론 결과 생성 → DB 저장
     */
    @Transactional
    public SessionCreateResponse createSession(SessionCreateRequest request) {
        // 1. 세션 저장
        ReviewSession session = new ReviewSession();
        session.setCompanyName(request.getCompanyName());
        session.setIndustry(request.getIndustry());
        session.setReviewType(request.getReviewType());
        session.setSituation(request.getSituation());
        session.setContent(request.getContent());
        session.setParticipationMode(request.getParticipationMode());
        session.setStatus("COMPLETED");
        sessionRepository.save(session);

        // 2. 더미 토론 메시지 생성 및 저장 (추후 AI 서버 호출로 교체)
        createDummyDebateMessages(session);

        // 3. 더미 최종 판정 생성 및 저장
        createDummyFinalDecision(session);

        return new SessionCreateResponse(session.getId(), "CREATED");
    }

    /**
     * 토론 결과 조회: DB에서 조회 후 DTO로 변환
     */
    @Transactional(readOnly = true)
    public DebateResultResponse getLatestDebateResult(Long sessionId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        // 메시지 조회
        List<DebateMessage> dbMessages = messageRepository.findBySessionIdOrderByRoundAscIdAsc(sessionId);
        List<AgentMessageDto> messageDtos = dbMessages.stream()
                .map(m -> new AgentMessageDto(
                        m.getAgentId(),
                        m.getAgentName(),
                        m.getContent(),
                        m.getType(),
                        m.getRound(),
                        m.getStance(),
                        m.getEvidenceSummary()
                ))
                .toList();

        // 최종 판정 조회
        FinalDecision fd = finalDecisionRepository.findBySessionId(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("FinalDecision not found for session: " + sessionId));

        List<RiskItemDto> riskDtos = fd.getRisks().stream()
                .map(r -> new RiskItemDto(r.getCategory(), r.getLevel(), r.getDescription()))
                .toList();

        FinalDecisionDto fdDto = new FinalDecisionDto(
                fd.getVerdict(),
                fd.getRiskLevel(),
                riskDtos,
                fd.getSummary(),
                fd.getRecommendation(),
                fd.getRevisedContent()
        );

        return new DebateResultResponse(sessionId, 1L, session.getStatus(), messageDtos, fdDto);
    }

    // ========== 더미 데이터 생성 (추후 AI 연동 시 이 메서드들만 교체) ==========

    private void createDummyDebateMessages(ReviewSession session) {
        String[][] round1 = {
                {"legal", "법률 전문가",
                        "표시·광고의 공정화에 관한 법률 제3조 및 제4조를 기준으로 분석하겠습니다. '업계 1위 제품보다 2배 빠른 성능'이라는 표현에 대한 객관적 근거 자료 확인이 필요합니다.",
                        "analysis", "CON", "표시광고법 제3조(거짓·과장 광고 금지) 위반 가능성"},
                {"risk", "리스크 관리자",
                        "비교 광고 측면에서 리스크를 검토하겠습니다. 특정 경쟁사를 직접 지칭하지는 않았으나, '업계 1위'라는 표현이 특정 업체를 암시할 수 있습니다. 경쟁사의 대응 가능성을 고려해야 합니다.",
                        "analysis", "CON", "경쟁사 암시 표현, 대응 리스크 존재"},
                {"ethics", "윤리 검토자",
                        "'타사 제품은 구시대 유물'이라는 표현에서 과도한 비하 표현이 감지됩니다. 경쟁사에 대한 존중 부족은 기업 이미지에 부정적 영향을 줄 수 있습니다.",
                        "concern", "CON", "경쟁사 비하 표현, 기업 이미지 리스크"},
        };

        String[][] round2 = {
                {"legal", "법률 전문가",
                        "표시광고법 제3조 제1항 제1호 '거짓·과장 광고'에 해당할 가능성이 있습니다. '2배 빠른 성능'에 대한 시험·조사 기관의 객관적 검증 자료가 없다면 법적 분쟁 소지가 있습니다. 공정거래위원회 제재 사례 검토 필요.",
                        "concern", "CON", "거짓·과장 광고 해당 가능성, 공정위 제재 리스크"},
                {"risk", "리스크 관리자",
                        "'한정 수량', '지금 구매', '놓치면 후회' 등 긴박감 조성 표현이 과도합니다. 실제 재고 상황과 무관한 허위 희소성 강조는 소비자 기만으로 간주될 수 있으며, 소비자 불만 및 환불 요구 증가 가능성이 있습니다.",
                        "concern", "CON", "허위 희소성 조성, 소비자 기만 리스크"},
                {"ethics", "윤리 검토자",
                        "소비자 자율성 존중 관점에서 검토합니다. '서둘러 주문', '후회합니다' 등의 압박적 표현은 소비자의 합리적 판단을 방해할 수 있습니다. ESG 경영 측면에서 소비자 중심적 커뮤니케이션이 필요합니다.",
                        "analysis", "CON", "소비자 자율성 침해, ESG 부합 필요"},
        };

        String[][] round3 = {
                {"legal", "법률 전문가",
                        "법적 안전성 확보를 위해 다음을 권고합니다: 1) 성능 비교 데이터의 출처 명시 2) '당사 기준' 또는 '특정 조건 하' 등 한정 표현 추가 3) 비교 대상 제품의 구체적 명시 또는 일반화된 표현으로 수정",
                        "recommendation", "CON", "출처 명시, 한정 표현 추가, 비교 대상 일반화 권고"},
                {"risk", "리스크 관리자",
                        "리스크 완화 방안: 1) 경쟁사 비하 표현 전면 삭제 2) 할인율 및 사은품 관련 상세 조건 명시 3) 한정 수량의 실제 물량 및 기간 구체화 4) 사후 소비자 불만 대응 프로세스 사전 준비",
                        "recommendation", "CON", "비하 삭제, 조건 명시, 대응 프로세스 필요"},
                {"ethics", "윤리 검토자",
                        "윤리적 개선 방안: 1) 자사 제품의 강점을 긍정적으로 표현 (비교 대신 절대적 가치 강조) 2) 소비자 선택권 존중하는 톤앤매너 적용 3) 압박적 표현 대신 혜택 중심 정보 제공 4) 공정하고 투명한 커뮤니케이션 원칙 준수",
                        "recommendation", "CON", "긍정 표현 전환, 소비자 존중, 투명성 확보"},
        };

        String[][][] allRounds = {round1, round2, round3};

        for (int roundNum = 0; roundNum < allRounds.length; roundNum++) {
            for (String[] data : allRounds[roundNum]) {
                DebateMessage msg = new DebateMessage();
                msg.setSession(session);
                msg.setAgentId(data[0]);
                msg.setAgentName(data[1]);
                msg.setContent(data[2]);
                msg.setType(data[3]);
                msg.setRound(roundNum + 1);
                msg.setStance(data[4]);
                msg.setEvidenceSummary(data[5]);
                messageRepository.save(msg);
            }
        }
    }

    private void createDummyFinalDecision(ReviewSession session) {
        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        fd.setVerdict("conditional");
        fd.setRiskLevel("HIGH");
        fd.setSummary("현재 문구는 법적 리스크가 높아 수정이 필요합니다. 3개 에이전트 중 2개가 반대 의견을 제시했습니다.");
        fd.setRecommendation("객관적 근거가 있는 표현만 남기고, 비교 대상이나 수치를 명확히 하거나 과장 표현을 제거해야 합니다.");
        fd.setRevisedContent("자체 테스트 기준 기존 제품 대비 2배 빠른 처리 성능 (2024년 내부 벤치마크 기준)");
        finalDecisionRepository.save(fd);

        String[][] riskData = {
                {"법률 리스크", "high", "표시광고법 위반 가능성 (거짓·과장 광고)"},
                {"재무 리스크", "medium", "과징금 및 시정명령 가능성"},
                {"평판 리스크", "medium", "소비자 신뢰 저하 우려"},
                {"경쟁 리스크", "low", "경쟁사 비교 광고 분쟁 가능성"},
        };

        for (String[] data : riskData) {
            Risk risk = new Risk();
            risk.setFinalDecision(fd);
            risk.setCategory(data[0]);
            risk.setLevel(data[1]);
            risk.setDescription(data[2]);
            fd.getRisks().add(risk);
        }
        finalDecisionRepository.save(fd);
    }
}
