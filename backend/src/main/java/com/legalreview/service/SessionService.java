package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import com.legalreview.service.AiAnalysisClient.AiAnalysisResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class SessionService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final UserRepository userRepository;
    private final AiAnalysisClient aiAnalysisClient;

    /**
     * 세션 생성 → Python AI 서버 호출 → 결과 DB 저장
     */
    @Transactional
    public SessionCreateResponse createSession(SessionCreateRequest request, Long userId) {
        // 1. 세션 저장
        ReviewSession session = new ReviewSession();

        // 사용자 연결 (userId가 있으면)
        if (userId != null) {
            userRepository.findById(userId).ifPresent(session::setUser);
        }

        session.setCompanyName(request.getCompanyName());
        session.setIndustry(request.getIndustry());
        session.setReviewType(request.getReviewType());
        session.setSituation(request.getSituation());
        session.setContent(request.getContent());
        session.setParticipationMode(request.getParticipationMode());
        session.setStatus("ANALYZING");
        sessionRepository.save(session);

        try {
            // 2. Python AI 서버 호출
            AiAnalysisResponse aiResponse = aiAnalysisClient.analyze(session.getId(), request);

            // 3. 토론 메시지 저장
            saveDebateMessages(session, aiResponse.messages());

            // 4. 최종 판정 저장
            saveFinalDecision(session, aiResponse.finalDecision());

            session.setStatus("COMPLETED");
        } catch (Exception e) {
            log.error("AI 서버 호출 실패 (sessionId={}): {}", session.getId(), e.getMessage());
            log.info("더미 데이터로 대체합니다.");

            // AI 서버 장애 시 더미 데이터로 폴백
            createFallbackDebateMessages(session);
            createFallbackFinalDecision(session);
            session.setStatus("COMPLETED");
        }

        sessionRepository.save(session);
        return new SessionCreateResponse(session.getId(), session.getStatus());
    }

    /**
     * 토론 결과 조회: DB에서 조회 후 DTO로 변환
     */
    @Transactional(readOnly = true)
    public DebateResultResponse getLatestDebateResult(Long sessionId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

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

    // ========== AI 응답 → DB 저장 ==========

    @SuppressWarnings("unchecked")
    private void saveDebateMessages(ReviewSession session, List<Map<String, Object>> messages) {
        for (Map<String, Object> m : messages) {
            DebateMessage msg = new DebateMessage();
            msg.setSession(session);
            msg.setAgentId((String) m.get("agentId"));
            msg.setAgentName((String) m.get("agentName"));
            msg.setContent((String) m.get("content"));
            msg.setType((String) m.get("type"));
            msg.setRound(((Number) m.get("round")).intValue());
            msg.setStance((String) m.get("stance"));
            msg.setEvidenceSummary((String) m.get("evidenceSummary"));
            messageRepository.save(msg);
        }
    }

    @SuppressWarnings("unchecked")
    private void saveFinalDecision(ReviewSession session, Map<String, Object> fdMap) {
        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        fd.setVerdict((String) fdMap.get("verdict"));
        fd.setRiskLevel((String) fdMap.get("riskLevel"));
        fd.setSummary((String) fdMap.get("summary"));
        fd.setRecommendation((String) fdMap.get("recommendation"));
        fd.setRevisedContent((String) fdMap.get("revisedContent"));
        finalDecisionRepository.save(fd);

        List<Map<String, Object>> risks = (List<Map<String, Object>>) fdMap.get("risks");
        if (risks != null) {
            for (Map<String, Object> r : risks) {
                Risk risk = new Risk();
                risk.setFinalDecision(fd);
                risk.setCategory((String) r.get("category"));
                risk.setLevel((String) r.get("level"));
                risk.setDescription((String) r.get("description"));
                fd.getRisks().add(risk);
            }
            finalDecisionRepository.save(fd);
        }
    }

    // ========== 폴백 더미 데이터 (AI 서버 장애 시) ==========

    private void createFallbackDebateMessages(ReviewSession session) {
        String[][] agents = {
                {"legal", "법률 전문가"}, {"risk", "리스크 관리자"}, {"ethics", "윤리 검토자"}
        };
        String[] types = {"analysis", "concern", "recommendation"};

        for (int round = 1; round <= 3; round++) {
            for (int i = 0; i < agents.length; i++) {
                DebateMessage msg = new DebateMessage();
                msg.setSession(session);
                msg.setAgentId(agents[i][0]);
                msg.setAgentName(agents[i][1]);
                msg.setContent(agents[i][1] + "의 " + round + "라운드 검토 의견입니다. (AI 서버 연결 대기 중)");
                msg.setType(types[round - 1]);
                msg.setRound(round);
                msg.setStance("NEUTRAL");
                msg.setEvidenceSummary("AI 서버 연결 대기 중 - 폴백 데이터");
                messageRepository.save(msg);
            }
        }
    }

    private void createFallbackFinalDecision(ReviewSession session) {
        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        fd.setVerdict("conditional");
        fd.setRiskLevel("MEDIUM");
        fd.setSummary("AI 분석 서버에 연결할 수 없어 임시 판정을 제공합니다. 재검토를 권장합니다.");
        fd.setRecommendation("AI 서버 연결 후 재분석을 진행하세요.");
        fd.setRevisedContent("(AI 서버 연결 후 수정 문구가 제공됩니다)");
        finalDecisionRepository.save(fd);

        Risk risk = new Risk();
        risk.setFinalDecision(fd);
        risk.setCategory("시스템");
        risk.setLevel("medium");
        risk.setDescription("AI 분석 서버 미연결 - 임시 결과");
        fd.getRisks().add(risk);
        finalDecisionRepository.save(fd);
    }
}
