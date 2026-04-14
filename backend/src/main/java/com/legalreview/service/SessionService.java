package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import com.legalreview.service.AiAnalysisClient.AiAnalysisResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class SessionService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;
    private final UserRepository userRepository;
    private final AiAnalysisClient aiAnalysisClient;
    private final LawSearchService lawSearchService;

    /**
     * 세션 생성 → 즉시 반환 → AI 분석은 비동기 실행
     * 프론트엔드가 30~90초 기다리지 않도록 즉시 sessionId 반환
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

        // 2. AI 분석을 비동기로 시작
        runAnalysisAsync(session.getId(), request);

        // 3. 즉시 반환 (프론트엔드가 바로 결과 페이지로 이동)
        return new SessionCreateResponse(session.getId(), session.getStatus());
    }

    /**
     * 비동기 AI 분석 실행
     * @Async를 사용하여 별도 스레드에서 실행
     * 분석 완료 후 세션 상태를 COMPLETED로 변경
     */
    @Async
    @Transactional
    public void runAnalysisAsync(Long sessionId, SessionCreateRequest request) {
        try {
            log.info("비동기 AI 분석 시작 (sessionId={})", sessionId);

            ReviewSession session = sessionRepository.findById(sessionId)
                    .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

            // Python AI 서버 호출
            AiAnalysisResponse aiResponse = aiAnalysisClient.analyze(sessionId, request);

            // 토론 메시지 저장
            saveDebateMessages(session, aiResponse.messages());

            // 최종 판정 저장
            saveFinalDecision(session, aiResponse.finalDecision());

            // 법령/판례 근거 저장 (AI 서버 응답)
            if (aiResponse.evidences() != null && !aiResponse.evidences().isEmpty()) {
                saveEvidences(session, aiResponse.evidences());
                log.info("AI 분석 근거 {}건 저장 (sessionId={})", aiResponse.evidences().size(), sessionId);
            }

            // 법제처 OPEN API 검색으로 추가 근거 보강
            enrichWithLawSearch(session, request.getContent());

            session.setStatus("COMPLETED");
            sessionRepository.save(session);
            log.info("비동기 AI 분석 완료 (sessionId={})", sessionId);

        } catch (Exception e) {
            log.error("AI 분석 실패 (sessionId={}): {}", sessionId, e.getMessage());
            log.info("더미 데이터로 대체합니다.");

            try {
                ReviewSession session = sessionRepository.findById(sessionId).orElse(null);
                if (session != null) {
                    createFallbackDebateMessages(session);
                    createFallbackFinalDecision(session);
                    enrichWithLawSearch(session, request.getContent());
                    session.setStatus("COMPLETED");
                    sessionRepository.save(session);
                }
            } catch (Exception fallbackErr) {
                log.error("폴백 데이터 생성도 실패 (sessionId={}): {}", sessionId, fallbackErr.getMessage());
                // 세션 상태를 FAILED로 변경
                sessionRepository.findById(sessionId).ifPresent(s -> {
                    s.setStatus("FAILED");
                    sessionRepository.save(s);
                });
            }
        }
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

        return new DebateResultResponse(sessionId, 1L, session.getStatus(), messageDtos, fdDto, evidenceDtos);
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

    // ========== 법령/판례 근거 저장/조회 ==========

    private void saveEvidences(ReviewSession session, List<Map<String, Object>> evidences) {
        for (Map<String, Object> ev : evidences) {
            Evidence evidence = new Evidence();
            evidence.setSession(session);
            evidence.setSourceType((String) ev.getOrDefault("sourceType", "LAW"));
            evidence.setTitle((String) ev.getOrDefault("title", ""));
            evidence.setReferenceId((String) ev.getOrDefault("referenceId", ""));
            evidence.setArticleOrCourt((String) ev.getOrDefault("articleOrCourt", ""));
            evidence.setSummary((String) ev.getOrDefault("summary", ""));
            evidence.setUrl((String) ev.getOrDefault("url", ""));
            evidence.setRelevanceReason((String) ev.getOrDefault("relevanceReason", ""));
            evidence.setQuotedText((String) ev.getOrDefault("quotedText", ""));
            evidenceRepository.save(evidence);
        }
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

    // ========== 법제처 검색으로 evidence 보강 ==========

    private static final int MAX_ENRICH_PER_TYPE = 5;

    private void enrichWithLawSearch(ReviewSession session, String content) {
        try {
            List<Evidence> existing = evidenceRepository.findBySessionIdOrderByIdAsc(session.getId());
            java.util.Set<String> existingRefIds = existing.stream()
                    .map(Evidence::getReferenceId)
                    .filter(id -> id != null && !id.isEmpty())
                    .collect(java.util.stream.Collectors.toSet());

            String query = extractSearchQuery(content);
            if (query.isEmpty()) {
                return;
            }

            List<EvidenceDto> lawResults = lawSearchService.searchLawsAsEvidence(query);
            List<EvidenceDto> caseResults = lawSearchService.searchCasesAsEvidence(query);

            int saved = 0;
            for (EvidenceDto dto : lawResults) {
                if (saved >= MAX_ENRICH_PER_TYPE) break;
                if (existingRefIds.contains(dto.getReferenceId())) continue;
                evidenceRepository.save(dto.toEntity(session));
                existingRefIds.add(dto.getReferenceId());
                saved++;
            }

            int lawSaved = saved;
            saved = 0;

            for (EvidenceDto dto : caseResults) {
                if (saved >= MAX_ENRICH_PER_TYPE) break;
                if (existingRefIds.contains(dto.getReferenceId())) continue;
                evidenceRepository.save(dto.toEntity(session));
                existingRefIds.add(dto.getReferenceId());
                saved++;
            }

            int total = lawSaved + saved;
            if (total > 0) {
                log.info("법제처 검색 근거 {}건 추가 저장 (sessionId={}, 법령={}, 판례={})",
                        total, session.getId(), lawSaved, saved);
            }
        } catch (Exception e) {
            log.warn("법제처 검색 보강 실패 (sessionId={}): {}", session.getId(), e.getMessage());
        }
    }

    private static final java.util.regex.Pattern STOPWORD_PATTERN =
            java.util.regex.Pattern.compile(
                    "\\b(있는|없는|되는|하는|위한|대한|통한|관한|가능성이|가능성|여부|검토|수행|진행|상황|경우|것으로|보입니다|합니다|입니다|됩니다|과도한|부당한|의심되는)\\b");

    private static final java.util.regex.Pattern LAW_NAME_PATTERN =
            java.util.regex.Pattern.compile("[가-힣]+(법|령|규칙|조례|규정)");

    private String extractSearchQuery(String content) {
        if (content == null || content.isBlank()) return "";

        java.util.regex.Matcher matcher = LAW_NAME_PATTERN.matcher(content);
        if (matcher.find()) {
            String lawName = matcher.group();
            log.debug("법령명 키워드 추출: '{}' → '{}'", content, lawName);
            return lawName;
        }

        String cleaned = STOPWORD_PATTERN.matcher(content).replaceAll(" ")
                .replaceAll("[^가-힣a-zA-Z0-9 ]", " ")
                .replaceAll("\\s+", " ")
                .trim();

        if (cleaned.length() > 20) {
            cleaned = cleaned.substring(0, 20).trim();
        }

        log.debug("키워드 추출: '{}' → '{}'", content, cleaned);
        return cleaned;
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
