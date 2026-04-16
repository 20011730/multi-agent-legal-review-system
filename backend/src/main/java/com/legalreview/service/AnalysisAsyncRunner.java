package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.EvidenceDto;
import com.legalreview.repository.*;
import com.legalreview.service.AiAnalysisClient.AiAnalysisResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * AI 분석을 비동기로 실행하는 별도 컴포넌트.
 *
 * Spring @Async는 프록시 기반이므로, 같은 클래스 내에서 호출하면 동기 실행된다.
 * SessionService에서 분리하여 프록시를 통한 정상적인 비동기 실행을 보장한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AnalysisAsyncRunner {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;
    private final AiAnalysisClient aiAnalysisClient;
    private final OllamaAnalysisService ollamaAnalysisService;
    private final LawSearchService lawSearchService;

    @Value("${app.ai.engine:python}")
    private String aiEngine;

    /**
     * 비동기 AI 분석 실행.
     * Spring 프록시를 통해 호출되므로 @Async가 정상 동작한다.
     */
    @Async
    @Transactional
    public void runAnalysis(Long sessionId, SessionCreateRequest request) {
        try {
            log.info("비동기 AI 분석 시작 — engine={}, sessionId={}", aiEngine, sessionId);

            ReviewSession session = sessionRepository.findById(sessionId)
                    .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

            // AI 엔진 선택: ollama → 로컬 Ollama, python → 기존 Python 서버
            AiAnalysisResponse aiResponse;
            if ("ollama".equalsIgnoreCase(aiEngine)) {
                log.info("Ollama 엔진으로 분석 실행 (sessionId={})", sessionId);
                aiResponse = ollamaAnalysisService.analyze(sessionId, request);
            } else {
                log.info("Python AI 서버로 분석 실행 (sessionId={})", sessionId);
                aiResponse = aiAnalysisClient.analyze(sessionId, request);
            }

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
            log.error("AI 분석 실패 (sessionId={}): {}", sessionId, e.getMessage(), e);
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
                sessionRepository.findById(sessionId).ifPresent(s -> {
                    s.setStatus("FAILED");
                    sessionRepository.save(s);
                });
            }
        }
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

    // ========== 법제처 검색으로 evidence 보강 ==========

    private static final int MAX_ENRICH_PER_TYPE = 5;

    private static final java.util.regex.Pattern STOPWORD_PATTERN =
            java.util.regex.Pattern.compile(
                    "\\b(있는|없는|되는|하는|위한|대한|통한|관한|가능성이|가능성|여부|검토|수행|진행|상황|경우|것으로|보입니다|합니다|입니다|됩니다|과도한|부당한|의심되는)\\b");

    private static final java.util.regex.Pattern LAW_NAME_PATTERN =
            java.util.regex.Pattern.compile("[가-힣]+(법|령|규칙|조례|규정)");

    private void enrichWithLawSearch(ReviewSession session, String content) {
        try {
            List<Evidence> existing = evidenceRepository.findBySessionIdOrderByIdAsc(session.getId());
            Set<String> existingRefIds = existing.stream()
                    .map(Evidence::getReferenceId)
                    .filter(id -> id != null && !id.isEmpty())
                    .collect(Collectors.toSet());

            log.info("[EVIDENCE-DEBUG] enrichWithLawSearch 시작: sessionId={}, 기존 evidence={}건",
                    session.getId(), existing.size());

            List<String> queries = extractSearchQueries(content, session);
            if (queries.isEmpty()) {
                log.warn("[EVIDENCE-DEBUG] 검색 키워드 추출 실패 — 원문: '{}'", content);
                return;
            }

            int totalLawSaved = 0;
            int totalCaseSaved = 0;

            for (String query : queries) {
                log.info("[EVIDENCE-DEBUG] 검색 쿼리 실행: '{}'", query);

                List<EvidenceDto> lawResults = lawSearchService.searchLawsAsEvidence(query);
                List<EvidenceDto> caseResults = lawSearchService.searchCasesAsEvidence(query);

                log.info("[EVIDENCE-DEBUG] 검색 결과: query='{}', 법령={}건, 판례={}건",
                        query, lawResults.size(), caseResults.size());

                for (EvidenceDto dto : lawResults) {
                    if (totalLawSaved >= MAX_ENRICH_PER_TYPE) break;
                    if (existingRefIds.contains(dto.getReferenceId())) continue;
                    evidenceRepository.save(dto.toEntity(session));
                    existingRefIds.add(dto.getReferenceId());
                    totalLawSaved++;
                }
                for (EvidenceDto dto : caseResults) {
                    if (totalCaseSaved >= MAX_ENRICH_PER_TYPE) break;
                    if (existingRefIds.contains(dto.getReferenceId())) continue;
                    evidenceRepository.save(dto.toEntity(session));
                    existingRefIds.add(dto.getReferenceId());
                    totalCaseSaved++;
                }
            }

            int total = totalLawSaved + totalCaseSaved;
            log.info("[EVIDENCE-DEBUG] enrichWithLawSearch 완료: sessionId={}, 법령={}건, 판례={}건, 총={}건",
                    session.getId(), totalLawSaved, totalCaseSaved, total);

            // 저장 후 DB 검증
            long dbCount = evidenceRepository.findBySessionIdOrderByIdAsc(session.getId()).size();
            log.info("[EVIDENCE-DEBUG] DB evidence 총 저장 수: sessionId={}, count={}", session.getId(), dbCount);

        } catch (Exception e) {
            log.warn("[EVIDENCE-DEBUG] 법제처 검색 보강 실패 (sessionId={}): {}", session.getId(), e.getMessage(), e);
        }
    }

    /**
     * 법률 검색용 키워드 추출 — 여러 쿼리를 순서대로 시도.
     *
     * 1순위: 원문에 법령명이 있으면 법령명 추출
     * 2순위: 검토 유형 + 산업에 맞는 도메인 키워드 생성
     * 3순위: 원문에서 핵심 명사 추출 (기존 방식)
     */
    private List<String> extractSearchQueries(String content, ReviewSession session) {
        List<String> queries = new ArrayList<>();

        // 1순위: 법령명 패턴
        java.util.regex.Matcher matcher = LAW_NAME_PATTERN.matcher(content);
        while (matcher.find()) {
            String lawName = matcher.group();
            if (!queries.contains(lawName)) queries.add(lawName);
        }

        // 2순위: 검토 유형 + 산업 기반 도메인 키워드
        String reviewType = session.getReviewType();
        String industry = session.getIndustry();
        List<String> domainKeywords = buildDomainKeywords(reviewType, industry, content);
        for (String kw : domainKeywords) {
            if (!queries.contains(kw)) queries.add(kw);
        }

        // 3순위: 원문 키워드 fallback (기존 방식)
        if (queries.isEmpty()) {
            String fallback = extractFallbackQuery(content);
            if (!fallback.isEmpty()) queries.add(fallback);
        }

        log.info("[EVIDENCE-DEBUG] 키워드 추출 결과: 원문='{}...', queries={}",
                content.length() > 30 ? content.substring(0, 30) : content, queries);
        return queries;
    }

    /**
     * 검토 유형과 산업에 따른 법률 검색 키워드 생성
     */
    private List<String> buildDomainKeywords(String reviewType, String industry, String content) {
        List<String> keywords = new ArrayList<>();
        String contentLower = content != null ? content : "";

        // 마케팅/광고 유형
        if (reviewType != null && (reviewType.contains("marketing") || reviewType.contains("광고") || reviewType.contains("마케팅"))) {
            keywords.add("표시광고");
            // 과장/허위 표현 감지
            if (contentLower.matches(".*(?:최고|최초|유일|업계.*1위|No\\.?1|넘버원|세계.*최|국내.*최|가장).*")) {
                keywords.add("부당광고");
            }
            // 비교 표현 감지
            if (contentLower.matches(".*(?:배.*빠|배.*높|보다.*우수|대비|비교|경쟁사).*")) {
                keywords.add("비교광고");
            }
        }

        // 개인정보/보안 관련
        if (contentLower.matches(".*(?:개인정보|보안|데이터|암호|인증|정보보호|ISMS|SSL).*")) {
            keywords.add("개인정보보호법");
        }

        // 전자상거래 관련
        if (contentLower.matches(".*(?:구매|결제|환불|반품|배송|할인|쿠폰|이벤트|무료).*")) {
            keywords.add("전자상거래");
        }

        // 계약/서비스 관련
        if (reviewType != null && (reviewType.contains("contract") || reviewType.contains("계약") || reviewType.contains("약관"))) {
            keywords.add("약관규제법");
        }

        // 산업별
        if (industry != null) {
            if (industry.contains("tech") || industry.contains("IT") || industry.contains("소프트웨어")) {
                keywords.add("정보통신망법");
            }
            if (industry.contains("food") || industry.contains("식품")) {
                keywords.add("식품표시광고법");
            }
            if (industry.contains("finance") || industry.contains("금융")) {
                keywords.add("금융소비자보호법");
            }
            if (industry.contains("health") || industry.contains("의료") || industry.contains("건강")) {
                keywords.add("의료법");
            }
        }

        return keywords;
    }

    /** 기존 방식: 원문에서 불용어 제거 후 앞 20자 */
    private String extractFallbackQuery(String content) {
        if (content == null || content.isBlank()) return "";
        String cleaned = STOPWORD_PATTERN.matcher(content).replaceAll(" ")
                .replaceAll("[^가-힣a-zA-Z0-9 ]", " ")
                .replaceAll("\\s+", " ").trim();
        return cleaned.length() > 20 ? cleaned.substring(0, 20).trim() : cleaned;
    }

    // ========== 폴백 더미 데이터 ==========

    private void createFallbackDebateMessages(ReviewSession session) {
        // 실패 시 최소한의 메시지 1건만 생성 (오해 유발 방지)
        DebateMessage msg = new DebateMessage();
        msg.setSession(session);
        msg.setAgentId("system");
        msg.setAgentName("시스템 알림");
        msg.setContent("AI 분석 서버 연결에 실패하여 자동 분석을 완료하지 못했습니다. "
                + "잠시 후 다시 시도하거나, 관리자에게 문의해주세요.");
        msg.setType("error");
        msg.setRound(0);
        msg.setStance("NEUTRAL");
        msg.setEvidenceSummary("AI 분석 실패 — 폴백 응답");
        messageRepository.save(msg);
    }

    private void createFallbackFinalDecision(ReviewSession session) {
        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        fd.setVerdict("error");
        fd.setRiskLevel("UNKNOWN");
        fd.setSummary("AI 분석 서버 연결 실패로 자동 판정을 완료하지 못했습니다. 재검토를 권장합니다.");
        fd.setRecommendation("네트워크 연결 상태를 확인한 뒤 다시 검토를 요청해주세요.");
        fd.setRevisedContent("");
        finalDecisionRepository.save(fd);

        Risk risk = new Risk();
        risk.setFinalDecision(fd);
        risk.setCategory("시스템 오류");
        risk.setLevel("high");
        risk.setDescription("AI 분석 서버 연결 실패 — 자동 분석 미완료");
        fd.getRisks().add(risk);
        finalDecisionRepository.save(fd);
    }
}
