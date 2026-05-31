package com.legalreview.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.domain.*;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.request.StartupContextDto;
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
    private final AssistantMessageRepository assistantMessageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;
    private final UserRepository userRepository;
    private final AnalysisAsyncRunner analysisAsyncRunner;
    private final AiAnalysisClient aiAnalysisClient;
    // Phase 10.23 — SSE 브로드캐스터 (재분석 시작 시 status + system 메시지 즉시 발행)
    private final SessionStreamService streamService;
    private final ObjectMapper objectMapper = new ObjectMapper();

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

        // Phase 10.4 — 지원사업 컨텍스트가 있으면 (1) situation 앞에 짧은 맥락 헤더 prepend → 에이전트 입력 반영,
        //   (2) JSON 직렬화하여 entity 저장 → 결과 페이지에서 복원 가능.
        StartupContextDto ctx = request.getStartupContext();
        String situation = request.getSituation();
        if (ctx != null && ctx.getTitle() != null
                && !situation.contains("[지원사업 기반 검토 컨텍스트]")
                && !situation.contains("[지원사업 기반 검토 맥락]") /* 9.x 호환 */) {
            String header = formatStartupContextForLegalReview(ctx);
            situation = header + "\n\n[사용자 입력 상황]\n" + situation;
            request.setSituation(situation);
        }
        // Phase 10.7/10.57 — 첨부 파일 metadata 가 있으면 situation 끝에 간략 안내 추가.
        // PDF/DOCX 본문은 Python 분석 단계에서 가능한 범위로 추출되어 별도 첨부 컨텍스트에 반영된다.
        if (request.getAttachments() != null && !request.getAttachments().isEmpty()
                && !situation.contains("[사용자 첨부 자료]")) {
            StringBuilder att = new StringBuilder("\n\n[사용자 첨부 자료]\n");
            int count = 0;
            for (var meta : request.getAttachments()) {
                if (meta == null) continue;
                Object nm = meta.get("name");
                Object mt = meta.get("mimeType");
                Object sz = meta.get("size");
                att.append("- ").append(nm != null ? nm : "(이름 없음)")
                        .append(" [").append(mt != null ? mt : "unknown")
                        .append(", ").append(sz != null ? sz : "?").append("B]\n");
                if (++count >= 10) break;
            }
            att.append("※ 첨부 본문은 가능한 경우 별도 추출되어 함께 반영됩니다. 추출되지 않은 항목은 파일명·유형을 참고해 추가 확인 사항으로 다룹니다.\n");
            situation = situation + att;
            request.setSituation(situation);
        }
        session.setSituation(situation);
        session.setContent(request.getContent());
        session.setParticipationMode(request.getParticipationMode());
        if (ctx != null) {
            try {
                session.setStartupContextJson(objectMapper.writeValueAsString(ctx));
            } catch (Exception ex) {
                log.warn("[session] startupContext JSON 직렬화 실패 — 진단은 계속 진행: {}", ex.getMessage());
            }
        }
        // Phase 10.16 — startupExtras / attachments 도 entity 에 영구 저장
        if (request.getStartupExtras() != null && !request.getStartupExtras().isEmpty()) {
            try {
                session.setStartupExtrasJson(objectMapper.writeValueAsString(request.getStartupExtras()));
            } catch (Exception ex) {
                log.warn("[session] startupExtras JSON 직렬화 실패: {}", ex.getMessage());
            }
        }
        if (request.getAttachments() != null && !request.getAttachments().isEmpty()) {
            try {
                session.setAttachmentsJson(objectMapper.writeValueAsString(request.getAttachments()));
            } catch (Exception ex) {
                log.warn("[session] attachments JSON 직렬화 실패: {}", ex.getMessage());
            }
        }
        session.setStatus("ANALYZING");
        request.setAnalysisMode("ROUND1_ONLY");
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
     * Phase 10.9 — 라운드 사이 추가 질문 저장 (followUpQuestionsJson 누적).
     * 동일 메시지 중복 저장은 무시.
     * @return 저장 후 총 질문 수
     */
    @Transactional
    public int appendFollowUpQuestion(Long sessionId, java.util.Map<String, Object> question) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));
        java.util.List<java.util.Map<String, Object>> list = new java.util.ArrayList<>();
        if (session.getFollowUpQuestionsJson() != null && !session.getFollowUpQuestionsJson().isBlank()) {
            try {
                list = objectMapper.readValue(session.getFollowUpQuestionsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ex) {
                log.warn("[session] followUp JSON 파싱 실패 — 새 리스트로 시작: {}", ex.getMessage());
            }
        }
        java.util.Map<String, Object> entry = new java.util.LinkedHashMap<>(question);
        entry.putIfAbsent("createdAt", java.time.Instant.now().toString());
        // Phase 10.44 — 신규 질문은 pending 상태로 시작 (재검토 트리거 시 in-progress 로 전환됨)
        entry.putIfAbsent("reanalyzeStatus", "pending");
        // 중복 메시지 가드
        String msg = String.valueOf(question.get("message")).trim();
        boolean dup = list.stream().anyMatch(q -> msg.equals(String.valueOf(q.get("message")).trim()));
        if (!dup) list.add(entry);
        try {
            session.setFollowUpQuestionsJson(objectMapper.writeValueAsString(list));
        } catch (Exception ex) {
            log.warn("[session] followUp JSON 직렬화 실패: {}", ex.getMessage());
        }
        sessionRepository.save(session);
        return list.size();
    }

    /**
     * Phase 10.85 — 저장된 후속 질문 1건 삭제/수정.
     * 재검토(in-progress) 또는 이미 반영(completed/reflected/partial)된 질문은 변경할 수 없다.
     * @param index 질문 배열 인덱스 (system 메시지 포함, 클라이언트가 정확히 지정)
     * @param newMessage null 이면 삭제, 비어있지 않은 문자열이면 message 갱신
     * @return 변경 후 총 질문 수 (-1 이면 수정/삭제 불가 상태)
     */
    @Transactional
    public int updateFollowUpQuestion(Long sessionId, int index, String newMessage) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));
        java.util.List<java.util.Map<String, Object>> list = new java.util.ArrayList<>();
        if (session.getFollowUpQuestionsJson() != null && !session.getFollowUpQuestionsJson().isBlank()) {
            try {
                list = objectMapper.readValue(session.getFollowUpQuestionsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ex) {
                log.warn("[session] followUp JSON 파싱 실패: {}", ex.getMessage());
            }
        }
        if (index < 0 || index >= list.size()) {
            throw new IllegalArgumentException("질문 인덱스가 범위를 벗어났습니다: " + index);
        }
        java.util.Map<String, Object> target = list.get(index);
        String status = String.valueOf(target.getOrDefault("reanalyzeStatus", "pending"));
        // 이미 반영되었거나 진행 중인 질문은 변경 불가
        if (!"pending".equals(status) && !"failed".equals(status)) {
            return -1;
        }
        if (newMessage == null) {
            list.remove(index);
        } else {
            String trimmed = newMessage.trim();
            if (trimmed.isEmpty()) {
                throw new IllegalArgumentException("message 가 비어 있습니다");
            }
            for (int i = 0; i < list.size(); i++) {
                if (i == index) continue;
                java.util.Map<String, Object> q = list.get(i);
                String existing = String.valueOf(q.getOrDefault("message", "")).trim();
                if (trimmed.equals(existing)) {
                    throw new IllegalArgumentException("이미 같은 질문이 저장되어 있습니다");
                }
            }
            target.put("message", trimmed);
            target.put("updatedAt", java.time.Instant.now().toString());
        }
        try {
            session.setFollowUpQuestionsJson(objectMapper.writeValueAsString(list));
        } catch (Exception ex) {
            log.warn("[session] followUp JSON 직렬화 실패: {}", ex.getMessage());
        }
        sessionRepository.save(session);
        return list.size();
    }

    /**
     * Phase 10.17 — 저장된 followUpQuestions / startupContext / startupExtras / attachments 를
     * 기존 세션의 입력에 합쳐서 재분석 트리거.
     *
     * <p>흐름:
     * <ol>
     *   <li>세션 조회</li>
     *   <li>followUpQuestionsJson + startupContextJson + startupExtrasJson + attachmentsJson 역직렬화</li>
     *   <li>SessionCreateRequest 재구성 — situation 앞에 [후속 질문] 블록 추가</li>
     *   <li>session.status = "REANALYZING" 으로 변경</li>
     *   <li>analysisAsyncRunner.runAnalysis 다시 호출 (afterCommit)</li>
     * </ol>
     */
    @Transactional
    public java.util.Map<String, Object> reanalyze(Long sessionId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        // 1) followUpQuestions 역직렬화
        java.util.List<java.util.Map<String, Object>> followUps = new java.util.ArrayList<>();
        if (session.getFollowUpQuestionsJson() != null && !session.getFollowUpQuestionsJson().isBlank()) {
            try {
                followUps = objectMapper.readValue(session.getFollowUpQuestionsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ex) {
                log.warn("[reanalyze] followUpQuestions 역직렬화 실패: {}", ex.getMessage());
            }
        }
        boolean waitingForRound2 = "WAITING_FOR_ROUND2_INPUT".equalsIgnoreCase(session.getStatus())
                || "WAITING_FOR_USER_INPUT".equalsIgnoreCase(session.getStatus());
        boolean waitingForFinal = "WAITING_FOR_FINAL_INPUT".equalsIgnoreCase(session.getStatus());
        boolean isRoundIntervention = waitingForRound2 || waitingForFinal;
        java.util.List<java.util.Map<String, Object>> storedFollowUps = followUps;
        java.util.List<java.util.Map<String, Object>> requestFollowUps = storedFollowUps.stream()
                .filter(SessionService::isUsableFollowUp)
                .filter(q -> isRoundIntervention || isPendingFollowUp(q))
                .toList();
        java.util.List<java.util.Map<String, Object>> applyingFollowUps = storedFollowUps.stream()
                .filter(SessionService::isUsableFollowUp)
                .filter(SessionService::isPendingFollowUp)
                .toList();

        if (storedFollowUps.isEmpty() && !isRoundIntervention) {
            throw new IllegalArgumentException("저장된 후속 질문이 없습니다. 먼저 질문을 추가해 주세요.");
        }
        if (requestFollowUps.isEmpty() && !isRoundIntervention) {
            throw new IllegalArgumentException("반영할 추가 질문이 없습니다. 먼저 질문을 추가해 주세요.");
        }

        // 2) startupContext / startupExtras / attachments 역직렬화
        StartupContextDto ctx = null;
        if (session.getStartupContextJson() != null && !session.getStartupContextJson().isBlank()) {
            try {
                ctx = objectMapper.readValue(session.getStartupContextJson(), StartupContextDto.class);
            } catch (Exception ignored) { /* */ }
        }
        java.util.Map<String, Object> extras = null;
        if (session.getStartupExtrasJson() != null && !session.getStartupExtrasJson().isBlank()) {
            try {
                extras = objectMapper.readValue(session.getStartupExtrasJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ignored) { /* */ }
        }
        java.util.List<java.util.Map<String, Object>> attachments = null;
        if (session.getAttachmentsJson() != null && !session.getAttachmentsJson().isBlank()) {
            try {
                attachments = objectMapper.readValue(session.getAttachmentsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ignored) { /* */ }
        }

        // 3) request 재구성 — situation 앞에 [후속 질문] 블록 prepend
        SessionCreateRequest req = new SessionCreateRequest();
        req.setCompanyName(session.getCompanyName());
        req.setIndustry(session.getIndustry());
        req.setReviewType(session.getReviewType());
        req.setParticipationMode(session.getParticipationMode());
        req.setContent(session.getContent());

        String analysisMode = waitingForRound2
                ? "ROUND2_ONLY"
                : waitingForFinal
                    ? "ROUND3_FINAL"
                    : "ROUND2_FINAL";
        int applyingRound = waitingForRound2 ? 2 : waitingForFinal ? 3 : 0;
        StringBuilder followBlock = new StringBuilder(waitingForFinal
                ? "\n\n[Round 3 진행 조건]\n"
                : "\n\n[Round 2 진행 조건]\n");
        if (requestFollowUps.isEmpty()) {
            followBlock.append(waitingForFinal
                    ? "- 사용자가 추가 질문 없이 최종 라운드 진행을 선택했습니다.\n"
                    : "- 사용자가 추가 질문 없이 다음 라운드 진행을 선택했습니다.\n");
        } else {
            followBlock.append(isRoundIntervention
                    ? waitingForFinal
                        ? "[사용자 추가 질문 — 최종 라운드 반영]\n"
                        : "[사용자 추가 질문 — 다음 라운드 반영]\n"
                    : "[사용자 후속 질문 — 재검토 요청]\n");
            for (var q : requestFollowUps) {
                Object tgt = q.get("targetAgent");
                Object msg = q.get("message");
                followBlock.append("- ")
                        .append(tgt != null ? "[" + tgt + "] " : "")
                        .append(msg != null ? msg : "")
                        .append("\n");
            }
        }
        followBlock.append(waitingForFinal
                ? "위 조건을 Round 3 최종 토론과 최종 결과에 반영해 주세요.\n"
                : "위 조건을 Round 2와 이후 최종 결과에 반영해 주세요.\n");
        // 기존 situation 의 [지원사업 기반 검토 컨텍스트] 블록은 그대로 둠
        req.setSituation(session.getSituation() + followBlock);
        req.setStartupContext(ctx);
        req.setStartupExtras(extras);
        req.setAttachments(attachments);
        req.setFollowUpQuestions(requestFollowUps);
        req.setAnalysisMode(analysisMode);

        // Phase 10.26 — 이전 토론 기록 **보존**. 재검토 결과는 기존 라운드 아래에 append.
        // 이전(10.18)에는 messages/evidences/finalDecision 을 삭제했지만, 사용자 QA 결과
        // "기존 토론 + 새 결과 모두 보존" 요구로 변경.
        //
        // - 토론 메시지: 삭제하지 않음. AnalysisAsyncRunner.saveDebateMessages 가 round 값을
        //   그대로 저장하므로 기존 라운드 1·2 와 새 라운드 1·2 가 함께 존재. frontend 에서는
        //   "추가 질문 반영 재검토" system 메시지(SSE publishMessage 가 발행)로 경계 표시.
        // - 최종 판정: 새 분석이 만든 FinalDecision 으로 교체됨 (AnalysisAsyncRunner.saveFinalDecision
        //   안의 orphanRemoval 동작). 이전 finalDecision row 만 삭제되고 토론 메시지는 살아있음.
        // - 근거(evidences): 토론과 함께 누적 보관.
        log.info("[reanalyze] 이전 토론 기록 보존 — 새 분석 결과는 기존 아래에 append (sessionId={})", sessionId);

        // 5) status 변경 + 트랜잭션 커밋 후 비동기 분석
        session.setStatus("REANALYZING");
        session.setAnalysisStartedAt(java.time.LocalDateTime.now());
        session.setAnalysisCompletedAt(null);

        // Phase 10.44 — followUp 들을 in-progress 상태로 마킹 후 영속화 (영구 status 추적 source of truth)
        try {
            for (var q : applyingFollowUps) {
                q.put("reanalyzeStatus", "in-progress");
                if (applyingRound > 0) {
                    q.put("appliedRound", applyingRound);
                } else {
                    q.put("appliedRound", "reanalysis");
                }
                q.put("reanalyzeStatusUpdatedAt", java.time.Instant.now().toString());
            }
            session.setFollowUpQuestionsJson(objectMapper.writeValueAsString(storedFollowUps));
        } catch (Exception ex) {
            log.warn("[reanalyze] followUp in-progress 마킹 실패: {}", ex.getMessage());
        }

        sessionRepository.save(session);
        log.info("[reanalyze] 분석 재개 트리거 (sessionId={}, mode={}, followUps={}건)",
                sessionId, analysisMode, requestFollowUps.size());

        // Phase 10.23 — SSE 로 즉시 REANALYZING 상태 + system 메시지 발행
        try {
            boolean hasNewFollowUps = !applyingFollowUps.isEmpty();
            streamService.publishStatus(sessionId, "REANALYZING", 40,
                    !hasNewFollowUps
                            ? waitingForFinal
                                ? "추가 질문 없이 최종 라운드를 진행하고 있습니다."
                                : "추가 질문 없이 다음 라운드를 진행하고 있습니다."
                            : waitingForFinal
                                ? "추가 질문을 반영해 최종 라운드를 진행하고 있습니다."
                                : isRoundIntervention
                                    ? "추가 질문을 반영해 다음 라운드를 진행하고 있습니다."
                                    : "추가 질문을 반영해 재검토하고 있습니다.");
            java.util.Map<String, Object> sysMsg = new java.util.LinkedHashMap<>();
            sysMsg.put("id", null);
            sysMsg.put("agentId", "system");
            sysMsg.put("agentName", "시스템");
            sysMsg.put("content", !hasNewFollowUps
                    ? waitingForFinal
                        ? "최종 라운드를 시작합니다. 추가 질문 없이 기존 토론 내용을 바탕으로 이어갑니다."
                        : "다음 라운드를 시작합니다. 추가 질문 없이 기존 검토 내용을 바탕으로 이어갑니다."
                    : waitingForFinal
                        ? "추가 질문 " + applyingFollowUps.size() + "건을 반영해 최종 라운드를 시작합니다."
                        : isRoundIntervention
                            ? "추가 질문 " + applyingFollowUps.size() + "건을 반영해 다음 라운드를 시작합니다."
                            : "추가 질문 " + applyingFollowUps.size() + "건을 반영해 재검토를 시작합니다.");
            sysMsg.put("type", "system");
            sysMsg.put("round", 0);
            sysMsg.put("stance", "NEUTRAL");
            sysMsg.put("evidenceSummary", "");
            streamService.publishMessage(sessionId, sysMsg);
        } catch (Exception sseErr) {
            log.debug("[SSE] reanalyze publish 실패 (무시): {}", sseErr.getMessage());
        }

        final SessionCreateRequest finalReq = req;
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                log.info("[reanalyze] 트랜잭션 커밋 후 비동기 재분석 시작 (sessionId={})", sessionId);
                analysisAsyncRunner.runAnalysis(sessionId, finalReq);
            }
        });

        return java.util.Map.of(
                "sessionId", sessionId,
                "status", "REANALYZING",
                "followUpCount", applyingFollowUps.size(),
                "message", waitingForFinal
                        ? "최종 라운드를 시작했습니다. 잠시 후 결과 페이지를 새로고침해 주세요."
                        : "다음 라운드를 시작했습니다. 잠시 후 결과 페이지를 새로고침해 주세요."
        );
    }

    private static boolean isUsableFollowUp(java.util.Map<String, Object> q) {
        if (q == null) return false;
        if ("system".equalsIgnoreCase(String.valueOf(q.getOrDefault("targetAgent", "")))) return false;
        if ("deleted".equalsIgnoreCase(String.valueOf(q.getOrDefault("reanalyzeStatus", "")))) return false;
        Object msg = q.get("message");
        return msg != null && !msg.toString().isBlank();
    }

    private static boolean isPendingFollowUp(java.util.Map<String, Object> q) {
        String status = String.valueOf(q.getOrDefault("reanalyzeStatus", "pending"));
        return status.isBlank()
                || "pending".equalsIgnoreCase(status)
                || "failed".equalsIgnoreCase(status);
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
                hasFinalDecision,
                session.getAnalysisPhase()
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

        // Phase 10.4 — 저장된 startupContextJson 복원
        StartupContextDto startupCtx = null;
        if (session.getStartupContextJson() != null && !session.getStartupContextJson().isBlank()) {
            try {
                startupCtx = objectMapper.readValue(session.getStartupContextJson(), StartupContextDto.class);
            } catch (Exception ex) {
                log.warn("[session] startupContext JSON 역직렬화 실패: {}", ex.getMessage());
            }
        }

        // Phase 10.12 — followUpQuestions 도 응답에 포함
        java.util.List<java.util.Map<String, Object>> followUps = new java.util.ArrayList<>();
        if (session.getFollowUpQuestionsJson() != null && !session.getFollowUpQuestionsJson().isBlank()) {
            try {
                followUps = objectMapper.readValue(session.getFollowUpQuestionsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ex) {
                log.warn("[session] followUpQuestionsJson 역직렬화 실패: {}", ex.getMessage());
            }
        }

        // Phase 10.57 — enriched attachments 도 응답에 포함 (priorityKeywords/selectedParagraphCount 등)
        java.util.List<java.util.Map<String, Object>> attachments = new java.util.ArrayList<>();
        if (session.getAttachmentsJson() != null && !session.getAttachmentsJson().isBlank()) {
            try {
                attachments = objectMapper.readValue(session.getAttachmentsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<>() {});
            } catch (Exception ex) {
                log.warn("[session] attachmentsJson 역직렬화 실패: {}", ex.getMessage());
            }
        }

        DebateResultResponse resp = new DebateResultResponse(
                sessionId, 1L, session.getStatus(), messageDtos, fdDto, evidenceDtos, startupCtx, followUps, attachments);
        return resp;
    }

    @Transactional(readOnly = true)
    public java.util.List<java.util.Map<String, Object>> getAssistantMessages(Long sessionId) {
        if (!sessionRepository.existsById(sessionId)) {
            throw new IllegalArgumentException("Session not found: " + sessionId);
        }
        return assistantMessageRepository.findBySessionIdOrderByMessageOrderAscIdAsc(sessionId).stream()
                .map(SessionService::assistantMessageToMap)
                .toList();
    }

    @Transactional
    public java.util.Map<String, Object> askAssistant(Long sessionId, String message, String clientRequestId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        String trimmed = message == null ? "" : message.trim();
        if (trimmed.isBlank()) {
            throw new IllegalArgumentException("message 필드가 필요합니다");
        }
        if (trimmed.length() > 1200) {
            throw new IllegalArgumentException("질문은 1200자 이하로 입력해 주세요.");
        }
        String safeClientRequestId = truncateForAssistant(clientRequestId, 80);
        if (!safeClientRequestId.isBlank()) {
            java.util.Optional<AssistantMessage> existingAnswer =
                    assistantMessageRepository.findFirstBySessionIdAndRoleAndClientRequestIdOrderByIdAsc(
                            sessionId, "ASSISTANT", safeClientRequestId);
            if (existingAnswer.isPresent()) {
                java.util.Map<String, Object> response = assistantMessageToMap(existingAnswer.get());
                response.put("sessionId", sessionId);
                response.put("messages", getAssistantMessages(sessionId));
                return response;
            }
        }

        if (safeClientRequestId.isBlank()
                || assistantMessageRepository.findFirstBySessionIdAndRoleAndClientRequestIdOrderByIdAsc(
                        sessionId, "USER", safeClientRequestId).isEmpty()) {
            AssistantMessage userMessage = new AssistantMessage();
            userMessage.setSession(session);
            userMessage.setRole("USER");
            userMessage.setContent(trimmed);
            userMessage.setStatus("COMPLETED");
            userMessage.setClientRequestId(safeClientRequestId.isBlank() ? null : safeClientRequestId);
            userMessage.setMessageOrder(nextAssistantMessageOrder(sessionId));
            assistantMessageRepository.save(userMessage);
        }

        DebateResultResponse result = getLatestDebateResult(sessionId);
        java.util.Map<String, Object> context = new java.util.LinkedHashMap<>();
        context.put("message", trimmed);
        context.put("status", session.getStatus());
        context.put("companyName", session.getCompanyName());
        context.put("industry", session.getIndustry());
        context.put("reviewType", session.getReviewType());
        context.put("situation", truncateForAssistant(session.getSituation(), 1600));
        context.put("content", truncateForAssistant(session.getContent(), 1000));
        context.put("messages", (result.getMessages() == null ? java.util.List.<AgentMessageDto>of() : result.getMessages()).stream()
                .limit(18)
                .map(m -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("agentName", safeForAssistant(m.getAgentName()));
                    row.put("agentId", safeForAssistant(m.getAgentId()));
                    row.put("round", m.getRound());
                    row.put("type", safeForAssistant(m.getType()));
                    row.put("content", truncateForAssistant(m.getContent(), 700));
                    return row;
                })
                .toList());
        if (result.getFinalDecision() != null) {
            FinalDecisionDto fd = result.getFinalDecision();
            java.util.Map<String, Object> fdMap = new java.util.LinkedHashMap<>();
            fdMap.put("verdict", safeForAssistant(fd.getVerdict()));
            fdMap.put("riskLevel", safeForAssistant(fd.getRiskLevel()));
            fdMap.put("summary", truncateForAssistant(fd.getSummary(), 700));
            fdMap.put("recommendation", truncateForAssistant(fd.getRecommendation(), 900));
            fdMap.put("risks", fd.getRisks() == null ? java.util.List.of() : fd.getRisks().stream()
                    .limit(5)
                    .map(r -> java.util.Map.of(
                            "category", safeForAssistant(r.getCategory()),
                            "level", safeForAssistant(r.getLevel()),
                            "description", truncateForAssistant(r.getDescription(), 400)
                    ))
                    .toList());
            context.put("finalDecision", fdMap);
        }
        context.put("evidences", result.getEvidences() == null ? java.util.List.of() : result.getEvidences().stream()
                .limit(6)
                .map(ev -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("sourceType", safeForAssistant(ev.getSourceType()));
                    row.put("title", truncateForAssistant(ev.getTitle(), 140));
                    row.put("referenceId", truncateForAssistant(ev.getReferenceId(), 80));
                    row.put("summary", truncateForAssistant(ev.getSummary(), 350));
                    row.put("relevanceReason", truncateForAssistant(ev.getRelevanceReason(), 350));
                    row.put("quotedText", truncateForAssistant(ev.getQuotedText(), 350));
                    return row;
                })
                .toList());
        context.put("followUpQuestions", result.getFollowUpQuestions() == null ? java.util.List.of() : result.getFollowUpQuestions().stream()
                .filter(SessionService::isUsableFollowUp)
                .limit(8)
                .map(q -> java.util.Map.of(
                        "targetAgent", safeForAssistant(String.valueOf(q.getOrDefault("targetAgent", "all"))),
                        "message", truncateForAssistant(String.valueOf(q.getOrDefault("message", "")), 400),
                        "status", safeForAssistant(String.valueOf(q.getOrDefault("reanalyzeStatus", "pending"))),
                        "appliedRound", safeForAssistant(String.valueOf(q.getOrDefault("appliedRound", "")))
                ))
                .toList());
        context.put("attachments", result.getAttachments() == null ? java.util.List.of() : result.getAttachments().stream()
                .limit(6)
                .map(a -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("name", truncateForAssistant(String.valueOf(a.getOrDefault("name", "")), 160));
                    row.put("mimeType", truncateForAssistant(String.valueOf(a.getOrDefault("mimeType", a.getOrDefault("fileType", ""))), 80));
                    row.put("extractionStatus", safeForAssistant(String.valueOf(a.getOrDefault("extractionStatus", ""))));
                    row.put("characterCount", a.getOrDefault("characterCount", ""));
                    row.put("bodyTruncated", a.getOrDefault("bodyTruncated", false));
                    Object keywords = a.get("priorityKeywords");
                    if (keywords instanceof java.util.List<?> list) {
                        row.put("priorityKeywords", list.stream().limit(8).map(String::valueOf).toList());
                    }
                    row.put("hasBodyText", a.getOrDefault("hasBodyText", false));
                    return row;
                })
                .toList());

        java.util.Map<String, Object> aiResponse = aiAnalysisClient.askSessionAssistant(sessionId, context);
        String answer = String.valueOf(aiResponse.getOrDefault("message", "")).trim();
        if (answer.isBlank()) {
            answer = "현재 검토 내용을 설명하는 중 문제가 발생했습니다. 잠시 후 다시 질문해 주세요.";
        }
        AssistantMessage assistantMessage = new AssistantMessage();
        assistantMessage.setSession(session);
        assistantMessage.setRole("ASSISTANT");
        assistantMessage.setContent(sanitizeAssistantDisplayText(answer));
        assistantMessage.setStatus("COMPLETED");
        assistantMessage.setClientRequestId(safeClientRequestId.isBlank() ? null : safeClientRequestId);
        assistantMessage.setMessageOrder(nextAssistantMessageOrder(sessionId));
        assistantMessageRepository.save(assistantMessage);

        java.util.Map<String, Object> response = assistantMessageToMap(assistantMessage);
        response.put("sessionId", sessionId);
        response.put("message", assistantMessage.getContent());
        response.put("messages", getAssistantMessages(sessionId));
        return response;
    }

    private int nextAssistantMessageOrder(Long sessionId) {
        long count = assistantMessageRepository.countBySessionId(sessionId);
        return count >= Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) count + 1;
    }

    private static java.util.Map<String, Object> assistantMessageToMap(AssistantMessage message) {
        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("id", message.getId());
        row.put("role", "USER".equalsIgnoreCase(message.getRole()) ? "user" : "assistant");
        row.put("message", sanitizeAssistantDisplayText(message.getContent()));
        row.put("content", sanitizeAssistantDisplayText(message.getContent()));
        row.put("createdAt", message.getCreatedAt() == null ? "" : message.getCreatedAt().toString());
        row.put("messageOrder", message.getMessageOrder());
        row.put("status", safeForAssistant(message.getStatus()));
        return row;
    }

    private static String safeForAssistant(String value) {
        return truncateForAssistant(value, 500);
    }

    private static String truncateForAssistant(String value, int max) {
        if (value == null || value.isBlank()) return "";
        String cleaned = value
                .replaceAll("(?i)OLLAMA[^\\n]*", "")
                .replaceAll("(?i)stack trace[^\\n]*", "")
                .replaceAll("(?i)API payload[^\\n]*", "")
                .replaceAll("(?i)serviceKey[^\\n]*", "")
                .replaceAll("(?i)bearer[^\\n]*", "")
                .trim();
        return cleaned.length() <= max ? cleaned : cleaned.substring(0, max) + "...";
    }

    private static String sanitizeAssistantDisplayText(String value) {
        String cleaned = truncateForAssistant(value, 4000);
        if (cleaned.matches("(?is).*(파싱 실패|파싱에 실패|기본 판정|판정 생성 실패|AI 판정 원문|raw exception|endpoint|model).*")) {
            return "현재 검토 내용을 설명하는 중 일부 정보를 정리하지 못했습니다. 핵심 쟁점은 계약서, 정산 증빙, 개인정보 처리 문서를 순서대로 확인하는 것입니다.";
        }
        return cleaned;
    }

    /**
     * Phase 10.5 — 지원사업 컨텍스트를 구조화된 섹션 형태로 변환하여 에이전트가 이해하기 쉽게 정리.
     * <ul>
     *   <li>섹션 1: 지원사업 기반 검토 컨텍스트 (key:value 정리)</li>
     *   <li>섹션 2: 검토 지시 (10대 우선 검토 영역)</li>
     *   <li>섹션 3: 안전 문구 가이드 (확정적 표현 금지)</li>
     * </ul>
     * null-safe, fieldSummary truncate, URL 은 도메인만, key 노출 없음.
     */
    private String formatStartupContextForLegalReview(StartupContextDto ctx) {
        StringBuilder sb = new StringBuilder();
        sb.append("[지원사업 기반 검토 컨텍스트]\n");
        sb.append("- 공고명: ").append(safe(ctx.getTitle())).append("\n");
        sb.append("- 주관기관: ").append(safe(ctx.getOrganization())).append("\n");
        sb.append("- 모집상태/카테고리: ").append(safe(ctx.getCategory())).append("\n");
        sb.append("- 마감일: ").append(safe(ctx.getDeadline())).append("\n");
        sb.append("- 지원대상: ").append(safe(ctx.getTarget())).append("\n");
        sb.append("- 데이터 출처: ").append(safe(ctx.getSource())).append("\n");
        sb.append("- 공고 요약: ").append(truncate(ctx.getFieldSummary(), 300)).append("\n");
        if (ctx.getAiInsightHint() != null && !ctx.getAiInsightHint().isBlank()) {
            sb.append("- 추천/검토 힌트: ").append(truncate(ctx.getAiInsightHint(), 200)).append("\n");
        }
        if (ctx.getLegalReviewHint() != null && !ctx.getLegalReviewHint().isBlank()) {
            sb.append("- 법률 검토 포인트(힌트): ").append(truncate(ctx.getLegalReviewHint(), 300)).append("\n");
        }
        // applyUrl 은 도메인만 노출 (긴 URL 프롬프트 노이즈 방지)
        String urlHost = extractHost(ctx.getApplyUrl());
        if (urlHost != null) sb.append("- 원문 공고 출처: ").append(urlHost).append("\n");

        sb.append("\n[검토 지시]\n");
        sb.append("이 사안은 정부/공공기관 지원사업 신청 또는 수행과 관련된 법률 리스크 검토입니다.\n");
        sb.append("다음 10개 영역을 우선적으로 점검하세요:\n");
        sb.append(" 1) 협약 체결 조건 — 협약서 효력, 해제/해지, 위약\n");
        sb.append(" 2) 사업비 집행 및 정산 — 사용 목적, 증빙 요건\n");
        sb.append(" 3) 지원금 환수 가능성 — 부정 수급, 목적 외 사용, 미이행\n");
        sb.append(" 4) 성과물 소유권 / 지식재산권 귀속 — 단독·공동, 사용권 범위\n");
        sb.append(" 5) 개인정보 처리 — 수집·동의·보관·제3자 제공·국외이전\n");
        sb.append(" 6) 고용 / 외주 / 용역 계약 — 청년 의무, 도급·위탁, 4대 보험\n");
        sb.append(" 7) 공동/컨소시엄 수행 시 책임 분담 — 주관·공동수행 책임\n");
        sb.append(" 8) 보고/증빙/사후관리 의무 — 정기 보고, 변경 신고, 사후 감사\n");
        sb.append(" 9) 지원 대상 자격 요건 — 업종·연차·매출·인원·결격사유\n");
        sb.append("10) 중복 수혜 / 타 지원사업 병행 — 중복 금지, 동일 비목 중복 집행\n");

        sb.append("\n[안전 문구 가이드]\n");
        sb.append("- 공고 데이터만으로 확정할 수 없는 사항은 단정 표현 금지.\n");
        sb.append("- 예: \"반드시 위법\" → \"협약서/공고문 원문에 따라 제한될 수 있으므로 확인이 필요\".\n");
        sb.append("- 예: \"환수 대상\" → \"사용 목적·증빙 위반 시 환수 리스크 발생 가능\".\n");
        sb.append("- 법령/판례 근거가 없는 경우 \"추가 확인 필요\" 또는 \"협약서/공고문 원문 확인 필요\" 로 표현.\n");
        return sb.toString();
    }

    private static String safe(String s) {
        return (s == null || s.isBlank()) ? "확인 필요" : s.trim();
    }

    private static String truncate(String s, int max) {
        if (s == null || s.isBlank()) return "확인 필요";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max) + "...";
    }

    private static String extractHost(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            java.net.URI u = java.net.URI.create(url.trim());
            return u.getHost();
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<EvidenceDto> loadEvidenceDtos(Long sessionId) {
        List<Evidence> evidences = evidenceRepository.findBySessionIdOrderByIdAsc(sessionId);
        if (evidences == null || evidences.isEmpty()) {
            return new ArrayList<>();
        }
        return evidences.stream()
                .map(ev -> {
                    EvidenceDto dto = new EvidenceDto(
                            ev.getSourceType(),
                            ev.getTitle(),
                            ev.getReferenceId(),
                            ev.getArticleOrCourt(),
                            ev.getSummary(),
                            ev.getUrl(),
                            ev.getRelevanceReason(),
                            ev.getQuotedText()
                    );
                    // Phase 10.70 — persisted dataSource 복원 (EvidenceCard chip 표시용)
                    dto.setDataSource(ev.getDataSource());
                    return dto;
                })
                .toList();
    }
}
