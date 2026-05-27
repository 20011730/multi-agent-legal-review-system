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
    private final com.legalreview.service.rag.LegalRetrievalService legalRetrievalService;
    private final com.legalreview.config.RagProperties ragProperties;
    // Phase 10.23 — SSE 브로드캐스터 (이벤트 발행만 담당, polling 흐름은 그대로 유지)
    private final SessionStreamService streamService;
    // Phase 10.44 — followUpQuestionsJson 의 개별 reanalyzeStatus 업데이트용
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    @Value("${app.ai.engine:python}")
    private String aiEngine;

    /**
     * 비동기 AI 분석 실행.
     * Spring 프록시를 통해 호출되므로 @Async가 정상 동작한다.
     */
    /**
     * @Transactional 제거 이유:
     * @Transactional을 걸면 runAnalysis() 전체가 하나의 트랜잭션으로 묶여,
     * 내부의 saveAndFlush(phase)가 커밋 전 상태가 된다.
     * 폴링(READ_COMMITTED)은 미커밋 데이터를 볼 수 없으므로 phase가 5%에 고정됨.
     * 제거하면 각 save/saveAndFlush 호출이 Spring Data JPA의 기본 트랜잭션(메서드 단위)으로 즉시 커밋됨.
     */
    @Async
    public void runAnalysis(Long sessionId, SessionCreateRequest request) {
        // ── 분석 시작 시각 기록 (실험 enabled와 무관하게 항상 기록 — 가벼운 1 컬럼) ──
        final long t0 = System.currentTimeMillis();
        try {
            log.info("비동기 AI 분석 시작 — engine={}, sessionId={}", aiEngine, sessionId);

            ReviewSession session = sessionRepository.findById(sessionId)
                    .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

            // 시작 시각 + 실험 메타 스냅샷
            session.setAnalysisStartedAt(java.time.LocalDateTime.now());
            if (ragProperties.getExperiment().isEnabled()) {
                session.setExperimentTag(ragProperties.getExperiment().getTag());
                session.setRagEnabled(ragProperties.isEnabled());
                session.setRagTopkLaw(ragProperties.getTopK().getLaw());
                session.setRagTopkCase(ragProperties.getTopK().getCaze());
                log.info("[EXPERIMENT] 세션 메타 기록 — sessionId={}, tag={}, ragEnabled={}, law={}, case={}",
                        sessionId, ragProperties.getExperiment().getTag(),
                        ragProperties.isEnabled(),
                        ragProperties.getTopK().getLaw(),
                        ragProperties.getTopK().getCaze());
            }
            sessionRepository.saveAndFlush(session);

            // Phase 10.23 — SSE 로 분석 시작 알림
            streamService.publishStatus(sessionId, "ANALYZING", 15,
                    "Python AI 서버에 분석 요청을 전송했습니다.");

            // phase 업데이트 콜백 — 각 LLM 호출 전에 DB에 현재 단계를 저장
            java.util.function.Consumer<String> phaseCallback = (phase) -> {
                session.setAnalysisPhase(phase);
                sessionRepository.saveAndFlush(session);
                log.debug("분석 단계 변경: {} (sessionId={})", phase, sessionId);
                // Phase 10.23 — SSE 로 phase 변경도 push
                String label = switch (phase == null ? "" : phase) {
                    case "ROUND1_BIZ" -> "비즈니스 전략가가 사업 관점 리스크를 분석 중입니다.";
                    case "ROUND1_LEGAL" -> "법률 전문가가 관련 법령·판례 근거를 확인하고 있습니다.";
                    case "ROUND2_BIZ" -> "비즈니스 측이 법률 측 지적에 대응 중입니다.";
                    case "ROUND2_LEGAL" -> "법률 측이 비즈니스 측 대응을 재검토 중입니다.";
                    case "JUDGING" -> "최종 판정관이 합의된 권고안을 정리하고 있습니다.";
                    case "COLLECTING_EVIDENCE" -> "관련 법령·판례 근거를 확인하고 있습니다.";
                    default -> phase;
                };
                streamService.publishStatus(sessionId, "ANALYZING", null, label);
            };

            // ── ★ RAG retrieval (Chroma) — 토론 시작 직전 1회 ★ ──
            // app.rag.enabled=false면 빈 리스트 반환 → 아래 호출 모두 no-op (기존 동작 100% 유지)
            // 멀티에이전트 모두 같은 evidence pool을 참조 → 라운드 반복 X, 1회 retrieval 후 공유
            java.util.List<com.legalreview.dto.response.EvidenceDto> ragEvidences = java.util.List.of();
            if (ragProperties.isEnabled()) {
                try {
                    ragEvidences = legalRetrievalService.retrieveForSession(request);
                    log.info("[RAG] 분석 전 retrieval — sessionId={}, hits={}",
                            sessionId, ragEvidences.size());
                } catch (Exception ragErr) {
                    log.warn("[RAG] retrieval 실패, 빈 결과로 fallback (sessionId={}): {}",
                            sessionId, ragErr.getMessage());
                    ragEvidences = java.util.List.of();
                }
            }
            String legalEvidenceBlock = buildLegalEvidenceBlock(ragEvidences);
            String commonEvidenceBlock = buildCommonEvidenceBlock(ragEvidences);

            // 명시적 주입 로그 — 운영 가시성용
            int injectedLegal = Math.min(ragEvidences.size(), ragProperties.getPrompt().getMaxItemsLegal());
            int injectedCommon = Math.min(ragEvidences.size(), ragProperties.getPrompt().getMaxItemsCommon());
            if (ragEvidences.isEmpty()) {
                log.info("[RAG] evidence 0건 — 분석은 RAG 미주입으로 계속 진행 (fallback 정상)");
            } else {
                log.info("[RAG] evidence {}건 retrieved → LEGAL prompt에 {}건 / BIZ·JUDGE prompt에 {}건 주입됨",
                        ragEvidences.size(), injectedLegal, injectedCommon);
            }

            // AI 엔진 선택: ollama → 로컬 Ollama, python → 기존 Python 서버
            AiAnalysisResponse aiResponse;
            if ("ollama".equalsIgnoreCase(aiEngine)) {
                log.info("Ollama 엔진으로 분석 실행 (sessionId={}, ragInjected={})",
                        sessionId, !ragEvidences.isEmpty());
                aiResponse = ollamaAnalysisService.analyze(
                        sessionId, request, phaseCallback,
                        legalEvidenceBlock, commonEvidenceBlock);
            } else {
                log.info("Python AI 서버로 분석 실행 (sessionId={})", sessionId);
                aiResponse = aiAnalysisClient.analyze(sessionId, request);
            }

            // 토론 메시지 저장 (개별 저장 → 폴링 시 messageCount 실시간 반영)
            saveDebateMessages(session, aiResponse.messages());

            // 최종 판정 저장
            saveFinalDecision(session, aiResponse.finalDecision());

            // Phase 10.57 — Python AI 가 enrichment 한 첨부 메타데이터를 session.attachmentsJson 에 영속화.
            //   이렇게 해야 /verdict 새로고침 후에도 priorityKeywords / selectedParagraphCount 등이 유지됨.
            //   bodyText / bodyBase64 는 enriched 응답에 포함되지 않음 (보안 + 용량).
            try {
                List<Map<String, Object>> enriched = aiResponse.enrichedAttachments();
                if (enriched != null && !enriched.isEmpty()) {
                    String json = objectMapper.writeValueAsString(enriched);
                    session.setAttachmentsJson(json);
                    log.info("[attach] enriched 첨부 메타 영속화: {}건 (sessionId={})", enriched.size(), sessionId);
                }
            } catch (Exception persistErr) {
                log.debug("[attach] enriched 첨부 영속화 실패 (무시): {}", persistErr.getMessage());
            }

            // 법령/판례 근거 저장 (AI 서버 응답)
            if (aiResponse.evidences() != null && !aiResponse.evidences().isEmpty()) {
                saveEvidences(session, aiResponse.evidences());
                log.info("AI 분석 근거 {}건 저장 (sessionId={})", aiResponse.evidences().size(), sessionId);
            }

            // 법제처 OPEN API 검색으로 추가 근거 보강 (RAG와 무관 — 기존 흐름 유지)
            phaseCallback.accept("COLLECTING_EVIDENCE");
            enrichWithLawSearch(session, request.getContent());

            // RAG 결과를 evidences 테이블에 저장 (결과 페이지/PDF에서 표시 가능하게)
            if (!ragEvidences.isEmpty()) {
                for (com.legalreview.dto.response.EvidenceDto dto : ragEvidences) {
                    evidenceRepository.save(dto.toEntity(session));
                }
                log.info("[RAG] retrieval evidence {}건 DB 저장 (sessionId={})",
                        ragEvidences.size(), sessionId);
            }

            // 안전망: 어떤 이유로든 final_decision이 없으면 fallback 강제 저장
            if (finalDecisionRepository.findBySessionId(sessionId).isEmpty()) {
                log.warn("[FD-SAFETY] 분석은 완료됐지만 final_decision이 누락됨 — fallback 저장 (sessionId={})", sessionId);
                createFallbackFinalDecision(session);
            }

            session.setStatus("COMPLETED");
            session.setAnalysisPhase(null); // 분석 완료 — phase 초기화
            // 종료 시각 + duration 기록
            java.time.LocalDateTime now = java.time.LocalDateTime.now();
            session.setAnalysisCompletedAt(now);
            session.setAnalysisDurationMs(System.currentTimeMillis() - t0);
            // Phase 10.47 — 재검토 완료 상태 정밀 판정.
            //   기준:
            //     - 핵심 에이전트(risk/legal/judge) 의 정상 메시지가 충분히 생성되었는지 검사
            //     - "분석 중 오류 발생|Ollama HTTP|판정 생성 실패" 패턴은 LLM 호출 실패로 판단
            //     - 핵심 healthy 메시지 ≥ 4 (라운드 1·2 의 risk·legal 최소 1세트) 이면 completed
            //     - 핵심 healthy 메시지 ≥ 2 이면 partial (일부 라운드 실패)
            //     - 핵심 healthy 메시지 0~1 이면 failed (사실상 fallback 만 존재)
            //   안내성 system-error(type=error, agentId=system) 메시지는 "치명" 판정에 포함하지 않음.
            java.util.List<DebateMessage> allMsgs = messageRepository.findBySessionIdOrderByRoundAscIdAsc(sessionId);
            java.util.regex.Pattern errPat = java.util.regex.Pattern.compile(
                    "분석 중 오류 발생|Ollama\\s+HTTP|판정 생성 실패|설정/요청\\s*오류");
            long healthyCore = allMsgs.stream()
                    .filter(m -> {
                        String aid = m.getAgentId() == null ? "" : m.getAgentId();
                        return aid.equals("risk") || aid.equals("business") || aid.equals("legal") || aid.equals("judge");
                    })
                    .filter(m -> !"error".equalsIgnoreCase(m.getType()))
                    .filter(m -> {
                        String c = m.getContent() == null ? "" : m.getContent();
                        return !errPat.matcher(c).find();
                    })
                    .count();
            String reanalyzeStatus;
            if (healthyCore >= 4) reanalyzeStatus = "completed";
            else if (healthyCore >= 2) reanalyzeStatus = "partial";
            else reanalyzeStatus = "failed";
            updateFollowUpReanalyzeStatus(session, reanalyzeStatus);
            sessionRepository.save(session);
            log.info("비동기 AI 분석 완료 (sessionId={}, durationMs={}, healthyCore={}, followUpStatus={})",
                    sessionId, session.getAnalysisDurationMs(), healthyCore, reanalyzeStatus);

            // Phase 10.23 — SSE 완료 이벤트 발행 (frontend 가 final fetch 트리거)
            try {
                long msgCount = messageRepository.countBySessionId(sessionId);
                streamService.publishCompleted(sessionId, (int) msgCount);
            } catch (Exception sseErr) {
                log.debug("[SSE] completed publish 실패 (무시): {}", sseErr.getMessage());
            }

        } catch (Exception e) {
            log.error("AI 분석 실패 (sessionId={}): {}", sessionId, e.getMessage(), e);
            // Phase 10.23 — SSE error 발행 (실제 stack trace/url 은 마스킹된 짧은 메시지만)
            try {
                String safeMsg = e.getMessage() == null ? "분석 중 오류" : e.getMessage();
                if (safeMsg.length() > 200) safeMsg = safeMsg.substring(0, 200) + "...";
                streamService.publishError(sessionId, "분석 실패 — fallback 결과 표시 중: " + safeMsg);
            } catch (Exception ignored) { /* */ }
            log.info("더미 데이터로 대체합니다.");

            try {
                ReviewSession session = sessionRepository.findById(sessionId).orElse(null);
                if (session != null) {
                    // Phase 10.49 — 실제 LLM 메시지가 이미 충분히 저장됐는지 먼저 확인.
                    //   enrichWithLawSearch / RAG persist / phase 콜백 같은 후속 단계에서 예외가 났을 뿐
                    //   분석 자체는 성공한 경우, dummy fallback 으로 덮어쓰지 말고 healthyCore 기준으로 상태 정리.
                    java.util.List<DebateMessage> existing = messageRepository.findBySessionIdOrderByRoundAscIdAsc(sessionId);
                    java.util.regex.Pattern recErrPat = java.util.regex.Pattern.compile(
                            "분석 중 오류 발생|Ollama\\s+HTTP|판정 생성 실패|설정/요청\\s*오류");
                    long existingHealthy = existing.stream()
                            .filter(m -> {
                                String aid = m.getAgentId() == null ? "" : m.getAgentId();
                                return aid.equals("risk") || aid.equals("business") || aid.equals("legal") || aid.equals("judge");
                            })
                            .filter(m -> !"error".equalsIgnoreCase(m.getType()))
                            .filter(m -> {
                                String c = m.getContent() == null ? "" : m.getContent();
                                return !recErrPat.matcher(c).find();
                            })
                            .count();
                    boolean realAnalysisSucceeded = existingHealthy >= 4
                            && finalDecisionRepository.findBySessionId(sessionId).isPresent();
                    if (realAnalysisSucceeded) {
                        log.info("[recover] LLM 분석은 성공했지만 후속 단계에서 예외 — 정상 완료로 정리 " +
                                "(sessionId={}, healthyCore={})", sessionId, existingHealthy);
                        session.setStatus("COMPLETED");
                        session.setAnalysisCompletedAt(java.time.LocalDateTime.now());
                        session.setAnalysisDurationMs(System.currentTimeMillis() - t0);
                        String recoverStatus = existingHealthy >= 4 ? "completed" : "partial";
                        updateFollowUpReanalyzeStatus(session, recoverStatus);
                        sessionRepository.save(session);
                    } else {
                        // 진짜 LLM 실패 — fallback dummy 데이터로 진행
                        createFallbackDebateMessages(session);
                        createFallbackFinalDecision(session);
                        enrichWithLawSearch(session, request.getContent());
                        session.setStatus("COMPLETED");
                        java.time.LocalDateTime now = java.time.LocalDateTime.now();
                        session.setAnalysisCompletedAt(now);
                        session.setAnalysisDurationMs(System.currentTimeMillis() - t0);
                        // Phase 10.47 — fallback 경로는 사실상 실제 LLM 분석이 이뤄지지 않은 상태 → failed.
                        updateFollowUpReanalyzeStatus(session, "failed");
                        sessionRepository.save(session);
                    }
                }
            } catch (Exception fallbackErr) {
                log.error("폴백 데이터 생성도 실패 (sessionId={}): {}", sessionId, fallbackErr.getMessage());
                sessionRepository.findById(sessionId).ifPresent(s -> {
                    s.setStatus("FAILED");
                    s.setAnalysisCompletedAt(java.time.LocalDateTime.now());
                    s.setAnalysisDurationMs(System.currentTimeMillis() - t0);
                    // Phase 10.44 — 완전 실패는 failed
                    updateFollowUpReanalyzeStatus(s, "failed");
                    sessionRepository.save(s);
                });
            }
        }
    }

    // ========== RAG evidence → 프롬프트 블록 ==========

    /**
     * LEGAL 에이전트용 상세 evidence 블록 (발표 자료 형식).
     * 형식 예:
     *   [관련 법령 근거]
     *   1. 표시·광고의 공정화에 관한 법률 제3조(부당한 표시·광고 행위의 금지)
     *   - 출처: LAW
     *   - 조문: 제3조 (부당한 표시·광고 행위의 금지)
     *   - 내용: <chunk 본문 max chars 절단>
     *   - 관련 이유: 사용자 검토 안건과 벡터 유사도 0.NN 매칭
     *
     * 정책:
     *   - 법령 우선, 그 다음 판례
     *   - app.rag.prompt.maxItemsLegal 만큼만 포함
     *   - 본문은 maxEvidenceChars로 truncate
     */
    private String buildLegalEvidenceBlock(java.util.List<com.legalreview.dto.response.EvidenceDto> evs) {
        if (evs == null || evs.isEmpty()) return "";
        int maxItems = ragProperties.getPrompt().getMaxItemsLegal();
        int maxChars = ragProperties.getPrompt().getMaxEvidenceChars();

        // Phase 10.64 — source 별 evidence 분리:
        //   primary  : 법령(laws_e5) + 운영 판례(cases_e5) — dataSource null or "cases_e5"/"laws_e5"
        //   extended : 확장 판례 샘플 — dataSource = "extended_case_sample"
        // case_number 기준 dedup → primary 가 이미 가지고 있는 사건은 extended 에서 제외.
        java.util.List<com.legalreview.dto.response.EvidenceDto> primary = new java.util.ArrayList<>();
        java.util.List<com.legalreview.dto.response.EvidenceDto> extended = new java.util.ArrayList<>();
        java.util.Set<String> seenCaseNumbers = new java.util.HashSet<>();
        for (var e : evs) {
            boolean isExtended = "extended_case_sample".equalsIgnoreCase(e.getDataSource());
            if (isExtended) {
                String cn = stringMeta(e.getMetadata(), "case_number");
                if (!cn.isEmpty() && seenCaseNumbers.contains(cn)) continue; // dedup
                if (!cn.isEmpty()) seenCaseNumbers.add(cn);
                extended.add(e);
            } else {
                String cn = stringMeta(e.getMetadata(), "case_number");
                if (!cn.isEmpty()) seenCaseNumbers.add(cn);
                primary.add(e);
            }
        }
        // 법령 먼저, 판례 나중 (primary 내부)
        primary.sort((a, b) -> {
            int ra = "LAW".equalsIgnoreCase(a.getSourceType()) ? 0 : 1;
            int rb = "LAW".equalsIgnoreCase(b.getSourceType()) ? 0 : 1;
            return Integer.compare(ra, rb);
        });

        StringBuilder sb = new StringBuilder();
        sb.append("[기존 판례·법령 검색 결과]\n");
        appendLegalItems(sb, primary, maxItems, maxChars, /*forExtended=*/ false);
        if (!extended.isEmpty()) {
            sb.append("\n[확장 판례 검색 결과 (참고용)]\n");
            sb.append("※ 아래 항목은 보조 참고 자료입니다. 단정적 결론의 직접 근거로 사용하지 말고,\n");
            sb.append("   기존 판례·법령 결과를 우선 인용하세요.\n");
            int extMax = Math.max(1, Math.min(extended.size(), ragProperties.getChroma().getExtendedCasesTopK()));
            appendLegalItems(sb, extended, extMax, maxChars, /*forExtended=*/ true);
        }
        return sb.toString().trim();
    }

    private void appendLegalItems(
            StringBuilder sb,
            java.util.List<com.legalreview.dto.response.EvidenceDto> items,
            int maxItems,
            int maxChars,
            boolean forExtended) {
        int n = Math.min(maxItems, items.size());
        for (int i = 0; i < n; i++) {
            com.legalreview.dto.response.EvidenceDto e = items.get(i);
            java.util.Map<String, Object> meta = e.getMetadata() == null ? java.util.Map.of() : e.getMetadata();
            String typeLabel = "LAW".equalsIgnoreCase(e.getSourceType()) ? "LAW" : "CASE";
            String title = nullSafe(e.getTitle());
            String quoted = truncate(
                    nullSafe(e.getQuotedText() != null && !e.getQuotedText().isEmpty()
                            ? e.getQuotedText() : e.getSummary()),
                    maxChars);
            String articleLine = null;
            String articleNo = stringMeta(meta, "articleNo");
            String articleTitle = stringMeta(meta, "articleTitle");
            if (!articleNo.isEmpty()) {
                articleLine = "제" + articleNo + "조"
                        + (articleTitle.isEmpty() ? "" : " (" + articleTitle + ")");
            }
            // 확장 판례에서는 case_number / court / section_type 만 노출
            String caseNumber = stringMeta(meta, "case_number");
            String court = stringMeta(meta, "court");
            String sectionType = stringMeta(meta, "section_type");
            String reason = nullSafe(e.getRelevanceReason());
            if (reason.isEmpty()) reason = "사용자 검토 안건과 의미 매칭";

            if (forExtended) {
                sb.append(String.format("%d. %s%s%s%n",
                        i + 1,
                        caseNumber.isEmpty() ? title : caseNumber,
                        court.isEmpty() ? "" : " (" + court + ")",
                        sectionType.isEmpty() ? "" : " — " + sectionType));
                sb.append(String.format("- 발췌: %s%n", quoted));
            } else {
                sb.append(String.format("%d. %s%n", i + 1, title));
                sb.append(String.format("- 출처: %s%n", typeLabel));
                if (articleLine != null) sb.append(String.format("- 조문: %s%n", articleLine));
                sb.append(String.format("- 내용: %s%n", quoted));
                sb.append(String.format("- 관련 이유: %s%n", reason));
            }
            sb.append('\n');
        }
    }

    private static String stringMeta(java.util.Map<String, Object> meta, String key) {
        if (meta == null) return "";
        Object v = meta.get(key);
        return v == null ? "" : v.toString();
    }

    /**
     * BIZ/JUDGE 에이전트용 요약 evidence 블록 — 타이틀 위주, 짧게.
     */
    private String buildCommonEvidenceBlock(java.util.List<com.legalreview.dto.response.EvidenceDto> evs) {
        if (evs == null || evs.isEmpty()) return "";
        int maxItems = ragProperties.getPrompt().getMaxItemsCommon();
        // Phase 10.64 — BIZ/JUDGE 프롬프트에는 확장 판례 노이즈 제외 (운영 cases_e5/laws_e5 만)
        java.util.List<com.legalreview.dto.response.EvidenceDto> primaryOnly = new java.util.ArrayList<>();
        for (var e : evs) {
            if ("extended_case_sample".equalsIgnoreCase(e.getDataSource())) continue;
            primaryOnly.add(e);
        }
        StringBuilder sb = new StringBuilder();
        int n = Math.min(maxItems, primaryOnly.size());
        for (int i = 0; i < n; i++) {
            com.legalreview.dto.response.EvidenceDto e = primaryOnly.get(i);
            String typeLabel = "LAW".equalsIgnoreCase(e.getSourceType()) ? "법령" : "판례";
            sb.append(String.format("- [%s] %s%n", typeLabel, nullSafe(e.getTitle())));
        }
        return sb.toString().trim();
    }

    private static String nullSafe(String s) { return s == null ? "" : s; }
    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    // ========== Phase 10.44 — followUp 개별 reanalyzeStatus 갱신 ==========

    /**
     * followUpQuestionsJson 내 각 entry 의 reanalyzeStatus 를 일괄 갱신.
     * status: pending / in-progress / completed / partial / failed
     * 세션은 caller 가 save() 한다.
     */
    private void updateFollowUpReanalyzeStatus(ReviewSession session, String status) {
        String json = session.getFollowUpQuestionsJson();
        if (json == null || json.isBlank()) return;
        try {
            java.util.List<java.util.Map<String, Object>> list = objectMapper.readValue(
                    json, new com.fasterxml.jackson.core.type.TypeReference<>() {});
            for (var q : list) {
                q.put("reanalyzeStatus", status);
                q.put("reanalyzeStatusUpdatedAt", java.time.Instant.now().toString());
            }
            session.setFollowUpQuestionsJson(objectMapper.writeValueAsString(list));
        } catch (Exception ex) {
            log.warn("[followUp] reanalyzeStatus 갱신 실패 (sessionId={}): {}",
                    session.getId(), ex.getMessage());
        }
    }

    // ========== AI 응답 → DB 저장 ==========

    @SuppressWarnings("unchecked")
    private void saveDebateMessages(ReviewSession session, List<Map<String, Object>> messages) {
        // Phase 10.73 — 실제 멀티 에이전트 토론장 UX:
        //   Python LangGraph 가 모든 라운드/agent 응답을 한 번에 묶어 반환하므로 기존엔
        //   saveDebateMessages 가 N개를 빠르게 saveAndFlush + SSE publishMessage 해서
        //   클라이언트가 "동시에 도착" 으로 인식 → 채팅 UX 부재.
        //   본 phase 에서 SSE publish 사이에 chunk 단위 sleep 을 넣어 카톡식 점진 표시를 구현.
        //   DB persist 는 즉시 수행 (폴링/dedup 안정성 보존). sleep 은 SSE push 후 적용.
        long perMessageDelayMs = 900L; // Phase 10.75 — 0.9초 간격 (사용자가 한 줄씩 읽으며 따라갈 수 있는 속도)
        for (int i = 0; i < messages.size(); i++) {
            Map<String, Object> m = messages.get(i);
            DebateMessage msg = new DebateMessage();
            msg.setSession(session);
            msg.setAgentId((String) m.get("agentId"));
            msg.setAgentName((String) m.get("agentName"));
            msg.setContent((String) m.get("content"));
            msg.setType((String) m.get("type"));
            msg.setRound(((Number) m.get("round")).intValue());
            msg.setStance((String) m.get("stance"));
            msg.setEvidenceSummary((String) m.get("evidenceSummary"));
            messageRepository.saveAndFlush(msg); // 즉시 flush → 폴링 시 messageCount 실시간 반영
            try {
                streamService.publishMessage(session.getId(),
                        com.legalreview.controller.SessionStreamController.toMessagePayload(msg));
            } catch (Exception sseErr) {
                log.debug("[SSE] message publish 실패 (무시): {}", sseErr.getMessage());
            }
            // Phase 10.73 — 마지막 메시지 뒤에는 sleep 생략 (전체 완료까지의 추가 지연 방지)
            if (i < messages.size() - 1) {
                try {
                    Thread.sleep(perMessageDelayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void saveFinalDecision(ReviewSession session, Map<String, Object> fdMap) {
        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        // null-safe 변환 — FinalDecision의 5개 컬럼은 nullable=false이므로
        // LLM이 "revisedContent": null 같은 명시적 null을 보낸 경우에도 빈 문자열로 보장
        fd.setVerdict(safeStr(fdMap.get("verdict"), "conditional"));
        fd.setRiskLevel(safeStr(fdMap.get("riskLevel"), "MEDIUM"));
        fd.setSummary(safeStr(fdMap.get("summary"), "AI 분석 결과입니다."));
        fd.setRecommendation(safeStr(fdMap.get("recommendation"), "전문가 검토를 권장합니다."));
        fd.setRevisedContent(safeStr(fdMap.get("revisedContent"), ""));

        // risks를 fd 컬렉션에 먼저 모두 추가 (cascade=ALL이라 한 번의 save로 함께 INSERT)
        List<Map<String, Object>> risks = (List<Map<String, Object>>) fdMap.get("risks");
        if (risks != null) {
            for (Map<String, Object> r : risks) {
                Risk risk = new Risk();
                risk.setFinalDecision(fd);
                risk.setCategory(safeStr(r.get("category"), "기타"));
                risk.setLevel(safeStr(r.get("level"), "medium"));
                risk.setDescription(safeStr(r.get("description"), ""));
                fd.getRisks().add(risk);
            }
        }

        // 1) FD + risks를 한 번에 저장 (cascade=ALL)
        finalDecisionRepository.saveAndFlush(fd);

        // 2) ★ 양방향 관계 동기화 ★
        //    ReviewSession.finalDecision은 mappedBy 측에 cascade=ALL + orphanRemoval=true가 걸려 있다.
        //    이 양방향 참조를 동기화하지 않으면, 이후 runAnalysis() 끝에서 sessionRepository.save(session)을
        //    호출할 때 Hibernate가 session.finalDecision == null 상태로 dirty checking을 수행하고
        //    orphanRemoval=true 규칙에 따라 방금 저장한 fd row를 DELETE 해 버린다.
        //    (실제로 final_decisions_id_seq는 진행됐지만 row가 0인 현상이 이로 인해 발생)
        session.setFinalDecision(fd);
    }

    private static String safeStr(Object v, String fallback) {
        if (v == null) return fallback;
        String s = v.toString();
        return s.isEmpty() ? fallback : s;
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
                    if (isLikelyIrrelevant(dto.getTitle())) continue;     // 무관 법령 필터
                    EvidenceDto enriched = enrichRelevanceReason(dto, query);
                    evidenceRepository.save(enriched.toEntity(session));
                    existingRefIds.add(dto.getReferenceId());
                    totalLawSaved++;
                }
                for (EvidenceDto dto : caseResults) {
                    if (totalCaseSaved >= MAX_ENRICH_PER_TYPE) break;
                    if (existingRefIds.contains(dto.getReferenceId())) continue;
                    if (isLikelyIrrelevant(dto.getTitle())) continue;     // 무관 판례 필터
                    EvidenceDto enriched = enrichRelevanceReason(dto, query);
                    evidenceRepository.save(enriched.toEntity(session));
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

        // ── 화장품 / 의료적 효능 표현 (가장 많이 잘못 분류되던 도메인) ──
        // 효능/효과를 암시하는 표현이 있으면 화장품법/의약품법 우선
        boolean cosmeticEfficacyHint = contentLower.matches(
                ".*(?:화장품|에센스|크림|로션|세럼|토너|마스크팩|클렌저|선크림|자외선|수분|보습|미백|주름|탄력|모공|여드름|아토피|피부.*개선|피부.*회복|콜라겐|히알루론|레티놀|비타민C).*");
        boolean medicalEfficacyHint = contentLower.matches(
                ".*(?:치료|완화|예방|회복|개선|효과|효능|면역|진정|항염|항균|항산화|재생|복원|되돌|정상.*화|살균).*");
        if (cosmeticEfficacyHint) {
            keywords.add("화장품법");
            keywords.add("화장품 표시광고");          // 표시광고법 + 화장품 시행규칙 매칭 유도
            // 화장품에 의약품적 효능 표현이 있으면 위반 가능성 매우 높음
            if (medicalEfficacyHint) {
                keywords.add("의약외품");              // 의약외품/의약품 경계 검토
                keywords.add("부당한 표시광고");
            }
        } else if (medicalEfficacyHint
                && contentLower.matches(".*(?:먹는|복용|섭취|영양제|건강기능식품|식이|식품).*")) {
            keywords.add("건강기능식품");
            keywords.add("식품표시광고법");
        }

        // ── 마케팅/광고 유형 ──
        if (reviewType != null && (reviewType.contains("marketing") || reviewType.contains("광고") || reviewType.contains("마케팅"))) {
            keywords.add("표시광고의 공정화");           // 정확한 법령명 → 매칭 정확도↑
            // 과장/허위/절대적 표현 감지
            if (contentLower.matches(".*(?:최고|최초|유일|업계.*1위|No\\.?1|넘버원|세계.*최|국내.*최|가장|완벽|100%|전부|모두).*")) {
                keywords.add("부당한 표시광고");
            }
            // 비교 표현 감지
            if (contentLower.matches(".*(?:배.*빠|배.*높|보다.*우수|대비|비교|경쟁사).*")) {
                keywords.add("비교광고");
            }
            // 효능 보장/체험기 등
            if (contentLower.matches(".*(?:보장|약속|확실|반드시|증명|체험|후기).*")) {
                keywords.add("기만적인 표시광고");
            }
        }

        // ── 개인정보/보안 관련 ──
        if (contentLower.matches(".*(?:개인정보|보안|데이터|암호|인증|정보보호|ISMS|SSL).*")) {
            keywords.add("개인정보보호법");
        }

        // ── 전자상거래 관련 ──
        if (contentLower.matches(".*(?:구매|결제|환불|반품|배송|할인|쿠폰|이벤트|무료).*")) {
            keywords.add("전자상거래 등에서의 소비자보호");
        }

        // ── 계약/서비스 관련 ──
        if (reviewType != null && (reviewType.contains("contract") || reviewType.contains("계약") || reviewType.contains("약관"))) {
            keywords.add("약관의 규제");
        }

        // ── 산업별 (사용자가 입력한 industry 기반) ──
        if (industry != null) {
            String ind = industry.toLowerCase();
            if (ind.contains("tech") || ind.contains("it") || ind.contains("소프트웨어")) {
                keywords.add("정보통신망법");
            }
            if (ind.contains("food") || ind.contains("식품")) {
                keywords.add("식품표시광고법");
            }
            if (ind.contains("finance") || ind.contains("금융")) {
                keywords.add("금융소비자보호법");
            }
            if (ind.contains("health") || ind.contains("의료") || ind.contains("건강")) {
                keywords.add("의료기기 광고");
            }
            if (ind.contains("cosmetic") || ind.contains("뷰티") || ind.contains("화장품")) {
                if (!keywords.contains("화장품법")) keywords.add("화장품법");
            }
        }

        // ── 무관 도메인 키워드 보호: 너무 일반적 키워드 제거 ──
        // (국가계약법, 양도소득세 등은 키워드로 직접 추가하지 않음)
        return keywords;
    }

    /**
     * 검토 안건과 무관할 가능성이 매우 높은 법령/판례를 필터링.
     * 표시광고/화장품/식품/개인정보 검토 안건에 흔히 잘못 매칭되는 도메인 차단.
     * 보수적으로 적용 — 애매하면 통과 (false 반환).
     */
    private static boolean isLikelyIrrelevant(String title) {
        if (title == null || title.isBlank()) return false;
        String t = title.replaceAll("\\s+", "");
        // 공공계약/세무/부동산 등 — 화장품/광고 안건과 거의 무관
        String[] blockPatterns = {
                "국가를당사자로하는계약",
                "공기업.*계약사무",
                "공공기관의운영에관한법률",
                "지방계약",
                "조달사업",
                "양도소득세",
                "종합부동산세",
                "상속세",
                "증여세",
                "관세법",
                "출입국",
                "병역법",
                "군인사법",
        };
        for (String p : blockPatterns) {
            if (t.matches(".*" + p + ".*")) return true;
        }
        return false;
    }

    /**
     * relevance_reason 강화: 단순 "키워드 매칭"이 아니라
     * "왜 이 법령/판례가 이 검토 안건과 관련 있는지" 한 줄 설명 자동 부착.
     */
    private static EvidenceDto enrichRelevanceReason(EvidenceDto dto, String query) {
        String existing = dto.getRelevanceReason();
        if (existing != null && !existing.isBlank() && existing.length() > 20) {
            return dto;  // 이미 풍부한 reason이 있으면 그대로
        }
        String reason = String.format("검토 키워드 '%s' 기반으로 매칭 — 검토 안건의 표현/맥락이 본 법령·판례의 규율 대상과 관련이 있을 수 있습니다.", query);
        return new EvidenceDto(
                dto.getSourceType(),
                dto.getTitle(),
                dto.getReferenceId(),
                dto.getArticleOrCourt(),
                dto.getSummary(),
                dto.getUrl(),
                reason,
                dto.getQuotedText()
        );
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
        // 이미 저장된 FD가 있으면 중복 INSERT(unique session_id 위반) 방지
        if (finalDecisionRepository.findBySessionId(session.getId()).isPresent()) {
            return;
        }

        FinalDecision fd = new FinalDecision();
        fd.setSession(session);
        fd.setVerdict("error");
        fd.setRiskLevel("UNKNOWN");
        fd.setSummary("AI 분석 서버 연결 실패로 자동 판정을 완료하지 못했습니다. 재검토를 권장합니다.");
        fd.setRecommendation("네트워크 연결 상태를 확인한 뒤 다시 검토를 요청해주세요.");
        fd.setRevisedContent("");

        Risk risk = new Risk();
        risk.setFinalDecision(fd);
        risk.setCategory("시스템 오류");
        risk.setLevel("high");
        risk.setDescription("AI 분석 서버 연결 실패 — 자동 분석 미완료");
        fd.getRisks().add(risk);

        // 한 번의 save로 cascade=ALL을 통해 fd + risks 동시 저장
        finalDecisionRepository.saveAndFlush(fd);

        // 양방향 관계 동기화 (orphanRemoval로 인한 삭제 방지)
        session.setFinalDecision(fd);
    }
}
