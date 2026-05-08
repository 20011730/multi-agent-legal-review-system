package com.legalreview.service.rag;

import com.legalreview.domain.DebateMessage;
import com.legalreview.domain.Evidence;
import com.legalreview.domain.FinalDecision;
import com.legalreview.domain.ReviewSession;
import com.legalreview.dto.response.ExperimentSessionDto;
import com.legalreview.dto.response.ExperimentSummaryDto;
import com.legalreview.repository.DebateMessageRepository;
import com.legalreview.repository.EvidenceRepository;
import com.legalreview.repository.FinalDecisionRepository;
import com.legalreview.repository.ReviewSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 세션별 실험 메트릭 계산 및 집계.
 *
 * 모든 메트릭은 기존 테이블(review_sessions, debate_messages, evidences, final_decisions)에서
 * 즉석 계산. 별도 메트릭 테이블 없이도 비교 분석이 가능하도록 설계.
 *
 * 향후 무거운 집계가 필요해지면 materialized view 또는 별도 테이블로 이전.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ExperimentService {

    private final ReviewSessionRepository sessionRepository;
    private final DebateMessageRepository messageRepository;
    private final EvidenceRepository evidenceRepository;
    private final FinalDecisionRepository finalDecisionRepository;

    /**
     * 최근 N개 세션의 실험 메트릭 (limit 적용).
     * 세션 정렬: createdAt DESC.
     * tag가 null이면 전체, 있으면 해당 태그만.
     */
    @Transactional(readOnly = true)
    public List<ExperimentSessionDto> listRecentSessions(int limit, String tag) {
        // sessionRepository에 별도 메서드를 추가하지 않기 위해 findAll 후 필터링
        // (capstone 규모에선 충분히 빠르고, 후속 최적화 여지 명시)
        List<ReviewSession> sessions = sessionRepository.findAll().stream()
                .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                .filter(s -> tag == null || tag.isBlank() || tag.equals(s.getExperimentTag()))
                .limit(Math.max(1, limit))
                .toList();

        return sessions.stream().map(this::toDto).toList();
    }

    /**
     * 특정 experimentTag의 평균/분포 집계.
     */
    @Transactional(readOnly = true)
    public ExperimentSummaryDto summarize(String tag) {
        List<ReviewSession> sessions = sessionRepository.findAll().stream()
                .filter(s -> tag != null && tag.equals(s.getExperimentTag()))
                .toList();

        long n = sessions.size();
        if (n == 0) {
            return ExperimentSummaryDto.builder()
                    .experimentTag(tag)
                    .sampleCount(0)
                    .verdictDistribution(Map.of())
                    .riskLevelDistribution(Map.of())
                    .build();
        }

        List<ExperimentSessionDto> dtos = sessions.stream().map(this::toDto).toList();

        double avgDuration = dtos.stream()
                .filter(d -> d.getAnalysisDurationMs() != null)
                .mapToLong(ExperimentSessionDto::getAnalysisDurationMs)
                .average().orElse(0.0);
        double avgEv = dtos.stream().mapToLong(ExperimentSessionDto::getTotalEvidenceCount).average().orElse(0.0);
        double avgLawEv = dtos.stream().mapToLong(ExperimentSessionDto::getLawEvidenceCount).average().orElse(0.0);
        double avgCaseEv = dtos.stream().mapToLong(ExperimentSessionDto::getCaseEvidenceCount).average().orElse(0.0);
        double avgLegal = dtos.stream().mapToLong(ExperimentSessionDto::getLegalMsgTotalChars).average().orElse(0.0);
        double avgBiz = dtos.stream().mapToLong(ExperimentSessionDto::getBizMsgTotalChars).average().orElse(0.0);
        double avgJudge = dtos.stream().mapToLong(ExperimentSessionDto::getJudgeMsgTotalChars).average().orElse(0.0);
        double avgMsgCnt = dtos.stream().mapToLong(ExperimentSessionDto::getMessageCount).average().orElse(0.0);

        Map<String, Long> verdictDist = dtos.stream()
                .filter(d -> d.getVerdict() != null && !d.getVerdict().isEmpty())
                .collect(Collectors.groupingBy(ExperimentSessionDto::getVerdict, Collectors.counting()));
        Map<String, Long> riskDist = dtos.stream()
                .filter(d -> d.getRiskLevel() != null && !d.getRiskLevel().isEmpty())
                .collect(Collectors.groupingBy(ExperimentSessionDto::getRiskLevel, Collectors.counting()));

        return ExperimentSummaryDto.builder()
                .experimentTag(tag)
                .sampleCount(n)
                .avgDurationMs(avgDuration)
                .avgEvidenceCount(avgEv)
                .avgLawEvidenceCount(avgLawEv)
                .avgCaseEvidenceCount(avgCaseEv)
                .avgLegalMsgChars(avgLegal)
                .avgBizMsgChars(avgBiz)
                .avgJudgeMsgChars(avgJudge)
                .avgMessageCount(avgMsgCnt)
                .verdictDistribution(verdictDist)
                .riskLevelDistribution(riskDist)
                .build();
    }

    /** 두 태그 비교 — A/B 평균을 한 번에 반환. */
    @Transactional(readOnly = true)
    public Map<String, ExperimentSummaryDto> compare(String tagA, String tagB) {
        Map<String, ExperimentSummaryDto> result = new LinkedHashMap<>();
        result.put(tagA, summarize(tagA));
        result.put(tagB, summarize(tagB));
        return result;
    }

    // ── 내부: 세션 → DTO 변환 ──

    private ExperimentSessionDto toDto(ReviewSession s) {
        Long sid = s.getId();

        // 메시지 메트릭
        List<DebateMessage> msgs = messageRepository.findBySessionIdOrderByRoundAscIdAsc(sid);
        long legalChars = msgs.stream()
                .filter(m -> "legal".equalsIgnoreCase(m.getAgentId()))
                .mapToLong(m -> safeLen(m.getContent())).sum();
        long bizChars = msgs.stream()
                .filter(m -> "risk".equalsIgnoreCase(m.getAgentId()) || "business".equalsIgnoreCase(m.getAgentId()))
                .mapToLong(m -> safeLen(m.getContent())).sum();
        long judgeChars = msgs.stream()
                .filter(m -> "judge".equalsIgnoreCase(m.getAgentId()) || "ethics".equalsIgnoreCase(m.getAgentId()))
                .mapToLong(m -> safeLen(m.getContent())).sum();

        // evidence 메트릭
        List<Evidence> evs = evidenceRepository.findBySessionIdOrderByIdAsc(sid);
        long lawCnt = evs.stream().filter(e -> "LAW".equalsIgnoreCase(e.getSourceType())).count();
        long caseCnt = evs.stream().filter(e -> "CASE".equalsIgnoreCase(e.getSourceType())).count();

        // 최종 판정
        FinalDecision fd = finalDecisionRepository.findBySessionId(sid).orElse(null);
        String verdict = fd != null ? fd.getVerdict() : null;
        String riskLevel = fd != null ? fd.getRiskLevel() : null;
        long riskCount = fd != null && fd.getRisks() != null ? fd.getRisks().size() : 0;

        return ExperimentSessionDto.builder()
                .sessionId(sid)
                .createdAt(s.getCreatedAt() == null ? null : s.getCreatedAt().toString())
                .status(s.getStatus())
                .experimentTag(s.getExperimentTag())
                .ragEnabled(s.getRagEnabled())
                .ragTopkLaw(s.getRagTopkLaw())
                .ragTopkCase(s.getRagTopkCase())
                .analysisDurationMs(s.getAnalysisDurationMs())
                .messageCount(msgs.size())
                .legalMsgTotalChars(legalChars)
                .bizMsgTotalChars(bizChars)
                .judgeMsgTotalChars(judgeChars)
                .totalEvidenceCount(evs.size())
                .lawEvidenceCount(lawCnt)
                .caseEvidenceCount(caseCnt)
                .verdict(verdict)
                .riskLevel(riskLevel)
                .riskCount(riskCount)
                .reviewType(s.getReviewType())
                .industry(s.getIndustry())
                .build();
    }

    private static long safeLen(String s) {
        return s == null ? 0L : s.length();
    }
}
