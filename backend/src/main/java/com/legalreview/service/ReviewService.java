package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ReviewService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;
    private final AssistantMessageRepository assistantMessageRepository;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * 사용자의 검토 기록 목록 조회 (최신순)
     */
    @Transactional(readOnly = true)
    public List<ReviewSummaryDto> getReviewList(Long userId) {
        List<ReviewSession> sessions = sessionRepository.findByUserIdOrderByCreatedAtDesc(userId);

        return sessions.stream()
                .map(session -> {
                    List<Map<String, Object>> followUps = parseFollowUps(session.getFollowUpQuestionsJson());
                    long activeFollowUps = followUps.stream().filter(ReviewService::isVisibleFollowUp).count();
                    long reanalysisFollowUps = followUps.stream()
                            .filter(ReviewService::isVisibleFollowUp)
                            .filter(q -> "reanalysis".equalsIgnoreCase(String.valueOf(q.getOrDefault("appliedRound", ""))))
                            .count();
                    return ReviewSummaryDto.from(
                            session,
                            messageRepository.countBySessionId(session.getId()),
                            evidenceRepository.findBySessionIdOrderByIdAsc(session.getId()).size(),
                            activeFollowUps,
                            reanalysisFollowUps,
                            assistantMessageRepository.countBySessionId(session.getId())
                    );
                })
                .toList();
    }

    /**
     * 검토 세션 상세 조회 (재열람용)
     */
    @Transactional(readOnly = true)
    public ReviewDetailResponse getReviewDetail(Long sessionId) {
        ReviewSession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("검토 세션을 찾을 수 없습니다: " + sessionId));

        // 토론 메시지
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

        // 최종 판정
        FinalDecisionDto fdDto = null;
        FinalDecision fd = finalDecisionRepository.findBySessionId(sessionId).orElse(null);
        if (fd != null) {
            List<RiskItemDto> riskDtos = fd.getRisks().stream()
                    .map(r -> new RiskItemDto(r.getCategory(), r.getLevel(), r.getDescription()))
                    .toList();

            fdDto = new FinalDecisionDto(
                    fd.getVerdict(),
                    fd.getRiskLevel(),
                    riskDtos,
                    fd.getSummary(),
                    fd.getRecommendation(),
                    fd.getRevisedContent()
            );
        }

        // 법령/판례 근거 조회
        List<Evidence> evidences = evidenceRepository.findBySessionIdOrderByIdAsc(sessionId);
        List<EvidenceDto> evidenceDtos = evidences != null
                ? evidences.stream()
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
                        // Phase 10.70 — persisted dataSource 복원
                        dto.setDataSource(ev.getDataSource());
                        return dto;
                    })
                    .toList()
                : new ArrayList<>();
        List<Map<String, Object>> followUps = parseFollowUps(session.getFollowUpQuestionsJson()).stream()
                .filter(ReviewService::isVisibleFollowUp)
                .toList();
        List<Map<String, Object>> attachments = parseJsonList(session.getAttachmentsJson());

        return new ReviewDetailResponse(
                session.getId(),
                session.getCompanyName(),
                session.getIndustry(),
                session.getReviewType(),
                session.getSituation(),
                session.getContent(),
                session.getParticipationMode(),
                session.getStatus(),
                session.getCreatedAt().toString(),
                messageDtos,
                fdDto,
                evidenceDtos,
                followUps,
                attachments,
                assistantMessageRepository.countBySessionId(sessionId)
        );
    }

    private List<Map<String, Object>> parseFollowUps(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private List<Map<String, Object>> parseJsonList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static boolean isVisibleFollowUp(Map<String, Object> item) {
        if (item == null) return false;
        String message = String.valueOf(item.getOrDefault("message", "")).trim();
        String status = String.valueOf(item.getOrDefault("reanalyzeStatus", "")).trim();
        return !message.isBlank() && !"deleted".equalsIgnoreCase(status);
    }
}
