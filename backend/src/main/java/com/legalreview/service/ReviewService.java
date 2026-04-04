package com.legalreview.service;

import com.legalreview.domain.*;
import com.legalreview.dto.response.*;
import com.legalreview.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ReviewService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final FinalDecisionRepository finalDecisionRepository;
    private final EvidenceRepository evidenceRepository;

    /**
     * 사용자의 검토 기록 목록 조회 (최신순)
     */
    @Transactional(readOnly = true)
    public List<ReviewSummaryDto> getReviewList(Long userId) {
        List<ReviewSession> sessions = sessionRepository.findByUserIdOrderByCreatedAtDesc(userId);

        return sessions.stream()
                .map(ReviewSummaryDto::from)
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
                    .toList()
                : new ArrayList<>();

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
                evidenceDtos
        );
    }
}
