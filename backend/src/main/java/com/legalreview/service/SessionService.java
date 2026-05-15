package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.domain.enums.AnalysisPhase;
import com.legalreview.domain.enums.SessionStatus;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.request.SessionFeedbackRequest;
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
        session.setStatus(SessionStatus.ANALYZING.name());
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
                SessionStatus.from(session.getStatus()),
                messageCount,
                hasFinalDecision,
                AnalysisPhase.fromNullable(session.getAnalysisPhase())
        );
    }

    @Transactional
    public SessionFeedbackResponse submitFeedback(Long sessionId, SessionFeedbackRequest request) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        AnalysisPhase currentPhase = AnalysisPhase.fromNullable(session.getAnalysisPhase());
        if (currentPhase == null || !currentPhase.isWaitingForUser()) {
            throw new IllegalStateException("현재 세션은 사용자 피드백 입력 대기 상태가 아닙니다.");
        }
        if (SessionStatus.from(session.getStatus()) != SessionStatus.ANALYZING) {
            throw new IllegalStateException("분석 중인 세션에서만 피드백을 제출할 수 있습니다.");
        }

        boolean isPass = Boolean.TRUE.equals(request.getIsPass());
        String content = request.getContent() == null ? "" : request.getContent().trim();
        if (!isPass && content.isBlank()) {
            throw new IllegalArgumentException("isPass=false 인 경우 content를 입력해야 합니다.");
        }

        saveUserFeedbackMessage(session, currentPhase, content, isPass);
        AnalysisPhase nextPhase = currentPhase == AnalysisPhase.WAITING_FOR_USER_R1
                ? AnalysisPhase.ROUND2_BIZ
                : AnalysisPhase.ROUND3_BIZ;
        session.setAnalysisPhase(nextPhase.name()); // 중복 피드백 제출 방지
        sessionRepository.saveAndFlush(session);

        analysisAsyncRunner.resumeAnalysis(sessionId, content, isPass);

        return new SessionFeedbackResponse(
                sessionId,
                SessionStatus.ANALYZING,
                nextPhase,
                "피드백이 접수되어 다음 라운드 분석을 재개했습니다."
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

        // FinalDecision이 아직 없으면(분석 진행 중) null로 처리 — 부분 결과 반환
        FinalDecisionDto fdDto = finalDecisionRepository.findBySessionId(sessionId)
                .map(fd -> {
                    List<RiskItemDto> riskDtos = fd.getRisks().stream()
                            .map(r -> new RiskItemDto(r.getCategory(), r.getLevel(), r.getDescription()))
                            .toList();
                    return new FinalDecisionDto(
                            fd.getVerdict(),
                            fd.getRiskLevel(),
                            riskDtos,
                            fd.getSummary(),
                            fd.getRecommendation(),
                            fd.getRevisedContent()
                    );
                })
                .orElse(null);

        // 법령/판례 근거 조회
        List<EvidenceDto> evidenceDtos = loadEvidenceDtos(sessionId);
        log.info("[VERDICT-DEBUG] 최종 응답 조립: sessionId={}, messages={}건, evidences={}건, fdDto={}",
                sessionId, messageDtos.size(), evidenceDtos.size(), fdDto != null ? "있음" : "없음(분석중)");

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

    private void saveUserFeedbackMessage(
            ReviewSession session,
            AnalysisPhase waitingPhase,
            String content,
            boolean isPass
    ) {
        DebateMessage message = new DebateMessage();
        message.setSession(session);
        message.setAgentId("user");
        message.setAgentName("사용자 피드백");
        message.setType(isPass ? "user_pass" : "user_feedback");
        message.setRound(waitingPhase == AnalysisPhase.WAITING_FOR_USER_R1 ? 1 : 2);
        message.setStance("NEUTRAL");
        message.setEvidenceSummary(isPass ? "사용자 패스" : "사용자 보정 의견");
        message.setContent(isPass ? "(사용자 Pass)" : content);
        messageRepository.saveAndFlush(message);
    }
}
