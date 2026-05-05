package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.EvidenceDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * 법령/판례 RAG retrieval orchestration.
 *
 * 책임:
 *  1) 사용자 입력(SessionCreateRequest)으로부터 검색 쿼리 생성
 *     - 원문 + reviewType + industry 결합
 *  2) Chroma의 laws/cases 컬렉션을 각각 top-k 검색
 *  3) 결과를 EvidenceDto 리스트로 변환 (assembler 사용)
 *  4) 멀티에이전트가 공통으로 참조할 수 있는 evidence pool로 반환
 *
 * 호출 시점은 AnalysisAsyncRunner.runAnalysis()의 토론 시작 직전 1회.
 * 라운드마다 반복 호출하지 않는다 — 같은 evidence pool을 모든 에이전트가 참조한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LegalRetrievalService {

    private final RagProperties ragProperties;
    private final ChromaSearchService chromaSearchService;
    private final EvidenceAssembler evidenceAssembler;

    /**
     * 세션 입력 기반 retrieval 1회.
     * RAG가 비활성이거나 Chroma 미응답이면 빈 리스트 반환 (호출 측이 legacy fallback 가능).
     *
     * @return 법령 chunk + 판례 chunk를 합친 EvidenceDto 리스트 (법령 먼저, 판례 나중).
     */
    public List<EvidenceDto> retrieveForSession(SessionCreateRequest request) {
        if (!ragProperties.isEnabled()) {
            log.debug("[RAG] disabled — retrieveForSession 건너뜀");
            return List.of();
        }

        String query = buildQuery(request);
        if (query.isBlank()) return List.of();

        int kLaw = Math.max(0, ragProperties.getTopK().getLaw());
        int kCase = Math.max(0, ragProperties.getTopK().getCaze());

        List<RetrievedChunk> lawChunks = chromaSearchService.queryLaws(query, kLaw);
        List<RetrievedChunk> caseChunks = chromaSearchService.queryCases(query, kCase);

        log.info("[RAG] retrieval 완료 — query='{}', lawTopK={}, caseTopK={}, lawHits={}, caseHits={}",
                truncate(query, 80), kLaw, kCase, lawChunks.size(), caseChunks.size());

        List<EvidenceDto> evidences = new ArrayList<>(lawChunks.size() + caseChunks.size());
        evidences.addAll(evidenceAssembler.toEvidenceDtos(lawChunks));
        evidences.addAll(evidenceAssembler.toEvidenceDtos(caseChunks));
        return evidences;
    }

    /**
     * 검색 쿼리 생성:
     *   "{reviewType} {industry} {content}"
     * (LLM 임베딩이 한국어 처리 가능한 모델이라는 전제 — bge-m3 등.)
     *
     * 추후 확장 포인트:
     *  - 키워드 추출 (TF-IDF / KeyBERT)
     *  - reviewType별 도메인 어휘 부착
     *  - 다중 쿼리 분해 (sub-query reformulation)
     */
    private String buildQuery(SessionCreateRequest request) {
        LinkedHashSet<String> tokens = new LinkedHashSet<>();
        if (request.getReviewType() != null) tokens.add(request.getReviewType());
        if (request.getIndustry() != null) tokens.add(request.getIndustry());
        if (request.getContent() != null) tokens.add(request.getContent());
        // situation은 보조적이므로 너무 긴 경우만 제외
        if (request.getSituation() != null && request.getSituation().length() < 200) {
            tokens.add(request.getSituation());
        }
        return String.join(" ", tokens).trim();
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "...";
    }
}
