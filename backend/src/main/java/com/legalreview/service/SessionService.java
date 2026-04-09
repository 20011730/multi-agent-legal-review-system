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

            // 5. 법령/판례 근거 저장 (AI 서버 응답)
            if (aiResponse.evidences() != null && !aiResponse.evidences().isEmpty()) {
                saveEvidences(session, aiResponse.evidences());
                log.info("AI 분석 근거 {}건 저장 (sessionId={})", aiResponse.evidences().size(), session.getId());
            }

            // 6. 법제처 OPEN API 검색으로 추가 근거 보강
            enrichWithLawSearch(session, request.getContent());

            session.setStatus("COMPLETED");
        } catch (Exception e) {
            log.error("AI 서버 호출 실패 (sessionId={}): {}", session.getId(), e.getMessage());
            log.info("더미 데이터로 대체합니다.");

            // AI 서버 장애 시 더미 데이터로 폴백
            createFallbackDebateMessages(session);
            createFallbackFinalDecision(session);

            // AI 서버 없어도 법제처 검색으로 근거 보강 시도
            enrichWithLawSearch(session, request.getContent());

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

    /**
     * 법제처 OPEN API로 법령/판례를 검색하여 세션에 evidence로 추가 저장한다.
     * - AI 서버가 이미 제공한 evidence와 referenceId가 같은 항목은 중복 저장하지 않는다.
     * - content 전문 대신 핵심 키워드를 추출하여 검색한다.
     * - 검색 실패 시 무시하고 진행 (전체 흐름을 막지 않음).
     */
    private void enrichWithLawSearch(ReviewSession session, String content) {
        try {
            // 1. 이미 저장된 evidence의 referenceId 수집 (중복 방지)
            List<Evidence> existing = evidenceRepository.findBySessionIdOrderByIdAsc(session.getId());
            java.util.Set<String> existingRefIds = existing.stream()
                    .map(Evidence::getReferenceId)
                    .filter(id -> id != null && !id.isEmpty())
                    .collect(java.util.stream.Collectors.toSet());

            // 2. 검색 키워드 추출 (content에서 앞 50자 사용)
            String query = extractSearchQuery(content);
            if (query.isEmpty()) {
                return;
            }

            // 3. 법령 + 판례 검색
            List<EvidenceDto> lawResults = lawSearchService.searchLawsAsEvidence(query);
            List<EvidenceDto> caseResults = lawSearchService.searchCasesAsEvidence(query);

            int saved = 0;

            // 4. 중복 제거 후 저장 (각 타입 최대 5건)
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

    /** 법제처 검색에 불필요한 조사/어미/일반 동사 패턴 */
    private static final java.util.regex.Pattern STOPWORD_PATTERN =
            java.util.regex.Pattern.compile(
                    "\\b(있는|없는|되는|하는|위한|대한|통한|관한|가능성이|가능성|여부|검토|수행|진행|상황|경우|것으로|보입니다|합니다|입니다|됩니다|과도한|부당한|의심되는)\\b");

    /** "~법", "~령", "~규칙", "~조례" 형태의 법령명 패턴 */
    private static final java.util.regex.Pattern LAW_NAME_PATTERN =
            java.util.regex.Pattern.compile("[가-힣]+(법|령|규칙|조례|규정)");

    /**
     * content에서 법제처 검색에 적합한 키워드를 추출한다.
     * 1순위: "~법", "~령" 등 법령명이 포함되어 있으면 그것을 검색어로 사용.
     * 2순위: 불용어를 제거한 뒤 앞 20자를 검색어로 사용.
     */
    private String extractSearchQuery(String content) {
        if (content == null || content.isBlank()) return "";

        // 1순위: 법령명 추출
        java.util.regex.Matcher matcher = LAW_NAME_PATTERN.matcher(content);
        if (matcher.find()) {
            String lawName = matcher.group();
            log.debug("법령명 키워드 추출: '{}' → '{}'", content, lawName);
            return lawName;
        }

        // 2순위: 불용어 제거 후 앞 20자
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
