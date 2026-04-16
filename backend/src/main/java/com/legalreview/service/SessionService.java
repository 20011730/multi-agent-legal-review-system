package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.ArrayList;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class SessionService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;
    private final UserRepository userRepository;
    private final AnalysisAsyncRunner analysisAsyncRunner;

    /**
     * 세션 생성 → 즉시 반환 → AI 분석은 트랜잭션 커밋 후 비동기 실행.
     *
     * 핵심: @Async 메서드는 별도 스레드에서 실행되므로,
     * 현재 트랜잭션이 COMMIT된 후에야 DB에서 세션을 찾을 수 있다.
     * → TransactionSynchronization.afterCommit()으로 실행 시점을 보장한다.
     */
    @Transactional
    public SessionCreateResponse createSession(SessionCreateRequest request, Long userId) {
        // 1. 세션 저장 (상태: ANALYZING)
        ReviewSession session = new ReviewSession();

        if (userId != null) {
            userRepository.findById(userId).ifPresent(session::setUser);
        } else {
            log.warn("세션 생성 시 userId가 없습니다. 검토 이력에 표시되지 않을 수 있습니다.");
        }

        session.setCompanyName(request.getCompanyName());
        session.setIndustry(request.getIndustry());
        session.setReviewType(request.getReviewType());
        session.setSituation(request.getSituation());
        session.setContent(request.getContent());
        session.setParticipationMode(request.getParticipationMode());
        session.setStatus("ANALYZING");
        sessionRepository.save(session);

        final Long savedSessionId = session.getId();
        log.info("세션 생성 완료 (sessionId={}), 트랜잭션 커밋 후 비동기 분석 예약", savedSessionId);

        // 2. 트랜잭션 커밋 후에 비동기 분석 시작
        //    → 이렇게 해야 async 스레드가 findById()로 세션을 찾을 수 있다
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                log.info("트랜잭션 커밋 완료 → 비동기 AI 분석 시작 (sessionId={})", savedSessionId);
                analysisAsyncRunner.runAnalysis(savedSessionId, request);
            }
        });

        // 3. 즉시 반환 (프론트엔드가 바로 결과 페이지로 이동)
        return new SessionCreateResponse(savedSessionId, session.getStatus());
    }

    /**
     * 세션 상태 조회 (폴링용)
     */
    @Transactional(readOnly = true)
    public SessionStatusResponse getSessionStatus(Long sessionId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        long messageCount = messageRepository.countBySessionId(sessionId);
        boolean hasFinalDecision = finalDecisionRepository.findBySessionId(sessionId).isPresent();

        return new SessionStatusResponse(
                sessionId,
                session.getStatus(),
                messageCount,
                hasFinalDecision
        );
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

        // 법령/판례 근거 조회
        List<EvidenceDto> evidenceDtos = loadEvidenceDtos(sessionId);
        log.info("[VERDICT-DEBUG] 최종 응답 조립: sessionId={}, messages={}건, evidences={}건",
                sessionId, messageDtos.size(), evidenceDtos.size());

        return new DebateResultResponse(sessionId, 1L, session.getStatus(), messageDtos, fdDto, evidenceDtos);
    }

    private List<EvidenceDto> loadEvidenceDtos(Long sessionId) {
        List<Evidence> evidences = evidenceRepository.findBySessionIdOrderByIdAsc(sessionId);
        if (evidences == null || evidences.isEmpty()) {
            return new ArrayList<>();
        }
        return evidences.stream()
                .map(ev -> new EvidenceDto(
                        ev.getSourceType(),
                        ev.getTitle(),
                        ev.getReferenceId(),
                        ev.getArticleOrCourt(),
                        ev.getSummary(),
                        ev.getUrl(),
                        ev.getRelevanceReason(),
                        ev.getQuotedText()
                ))
                .toList();
    }
}
