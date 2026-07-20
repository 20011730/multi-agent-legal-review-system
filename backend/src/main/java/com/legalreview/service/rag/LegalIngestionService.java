package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.config.RagProperties;
import com.legalreview.domain.CaseDocument;
import com.legalreview.domain.LawDocument;
import com.legalreview.repository.CaseDocumentRepository;
import com.legalreview.repository.LawDocumentRepository;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 법령/판례 시드 데이터를 PostgreSQL + Chroma에 적재하는 ingestion 오케스트레이터.
 *
 * 흐름:
 *   1) classpath:rag-seed/laws.json, cases.json 로드
 *   2) referenceId 기준으로 LawDocument/CaseDocument upsert (PostgreSQL)
 *   3) LegalChunker로 chunk 생성 (조문/섹션 단위)
 *   4) Chroma 컬렉션 보장 (없으면 생성) → upsert (chunkId 기준 idempotent)
 *   5) PostgreSQL의 chunked 플래그 true 처리
 *
 * 호출 진입점:
 *   - RagDevController로 HTTP 요청 (개발자가 명시적 트리거)
 *   - 또는 application 코드에서 직접 호출 가능
 *
 * 멱등성:
 *   - LawDocument/CaseDocument는 referenceId로 조회 후 update
 *   - Chroma는 ids가 같으면 upsert(=overwrite) — 재실행해도 row가 폭증하지 않음
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LegalIngestionService {

    private final LawDocumentRepository lawRepo;
    private final CaseDocumentRepository caseRepo;
    private final LegalChunker chunker;
    private final ChromaSearchService chromaSearchService;
    private final RagProperties ragProperties;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 시드 적재 entrypoint.
     * @return 실행 통계
     */
    @Transactional
    public IngestionReport runSeedIngestion() {
        IngestionReport report = new IngestionReport();
        if (!ragProperties.isEnabled()) {
            log.warn("[RAG-INGEST] app.rag.enabled=false — 적재 스킵");
            report.setSkippedReason("RAG disabled");
            return report;
        }

        // 컬렉션 보장
        boolean lawsOk = chromaSearchService.ensureCollection(ragProperties.getChroma().getLawsCollection());
        boolean casesOk = chromaSearchService.ensureCollection(ragProperties.getChroma().getCasesCollection());
        report.setLawsCollectionReady(lawsOk);
        report.setCasesCollectionReady(casesOk);
        if (!lawsOk && !casesOk) {
            log.error("[RAG-INGEST] Chroma 컬렉션 보장 실패 — 적재 중단");
            report.setSkippedReason("Chroma 미응답");
            return report;
        }

        // 법령
        try {
            List<LawSeed> lawSeeds = loadLawSeeds();
            for (LawSeed s : lawSeeds) {
                IngestionItemResult r = ingestLaw(s);
                report.getLawResults().add(r);
            }
        } catch (Exception e) {
            log.error("[RAG-INGEST] 법령 시드 적재 실패", e);
        }

        // 판례
        try {
            List<CaseSeed> caseSeeds = loadCaseSeeds();
            for (CaseSeed s : caseSeeds) {
                IngestionItemResult r = ingestCase(s);
                report.getCaseResults().add(r);
            }
        } catch (Exception e) {
            log.error("[RAG-INGEST] 판례 시드 적재 실패", e);
        }

        // 컬렉션 카운트
        report.setLawsCollectionCount(chromaSearchService.countCollection(ragProperties.getChroma().getLawsCollection()));
        report.setCasesCollectionCount(chromaSearchService.countCollection(ragProperties.getChroma().getCasesCollection()));

        log.info("[RAG-INGEST] 적재 완료 — laws docs={}, cases docs={}, chromaLaws={}, chromaCases={}",
                report.getLawResults().size(), report.getCaseResults().size(),
                report.getLawsCollectionCount(), report.getCasesCollectionCount());
        return report;
    }

    private IngestionItemResult ingestLaw(LawSeed seed) {
        Optional<LawDocument> existing = lawRepo.findByReferenceId(seed.getReferenceId());
        LawDocument doc = existing.orElseGet(LawDocument::new);
        doc.setReferenceId(seed.getReferenceId());
        doc.setTitle(seed.getTitle());
        doc.setShortName(seed.getShortName());
        doc.setDepartment(seed.getDepartment());
        doc.setEnforceDate(seed.getEnforceDate());
        doc.setRevisionType(seed.getRevisionType());
        doc.setUrl(seed.getUrl());
        doc.setRawContent(seed.getRawContent());
        doc.setUpdatedAt(LocalDateTime.now());

        // 기존이 chunked이고 overwrite=false면 chunk 단계 skip
        boolean alreadyChunked = doc.isChunked();
        boolean shouldChunk = !alreadyChunked || ragProperties.getIngestion().isOverwriteExisting();

        List<LegalChunker.Chunk> chunks = List.of();
        int upserted = 0;
        if (shouldChunk) {
            chunks = chunker.chunkLaw(doc);
            upserted = chromaSearchService.upsertChunks(
                    ragProperties.getChroma().getLawsCollection(), chunks);
            doc.setChunked(upserted > 0);
        }

        lawRepo.save(doc);
        return new IngestionItemResult(seed.getReferenceId(), seed.getTitle(),
                chunks.size(), upserted, alreadyChunked);
    }

    private IngestionItemResult ingestCase(CaseSeed seed) {
        Optional<CaseDocument> existing = caseRepo.findByReferenceId(seed.getReferenceId());
        CaseDocument doc = existing.orElseGet(CaseDocument::new);
        doc.setReferenceId(seed.getReferenceId());
        doc.setTitle(seed.getTitle());
        doc.setCaseNumber(seed.getCaseNumber());
        doc.setCourt(seed.getCourt());
        doc.setJudgmentDate(seed.getJudgmentDate());
        doc.setCaseType(seed.getCaseType());
        doc.setUrl(seed.getUrl());
        doc.setIssues(seed.getIssues());
        doc.setSummary(seed.getSummary());
        doc.setReasoning(seed.getReasoning());
        doc.setUpdatedAt(LocalDateTime.now());

        boolean alreadyChunked = doc.isChunked();
        boolean shouldChunk = !alreadyChunked || ragProperties.getIngestion().isOverwriteExisting();

        List<LegalChunker.Chunk> chunks = List.of();
        int upserted = 0;
        if (shouldChunk) {
            chunks = chunker.chunkCase(doc);
            upserted = chromaSearchService.upsertChunks(
                    ragProperties.getChroma().getCasesCollection(), chunks);
            doc.setChunked(upserted > 0);
        }

        caseRepo.save(doc);
        return new IngestionItemResult(seed.getReferenceId(), seed.getTitle(),
                chunks.size(), upserted, alreadyChunked);
    }

    @SuppressWarnings("unchecked")
    private List<LawSeed> loadLawSeeds() throws Exception {
        try (InputStream is = new ClassPathResource("rag-seed/laws.json").getInputStream()) {
            List<Map<String, Object>> raw = objectMapper.readValue(is, List.class);
            List<LawSeed> result = new ArrayList<>();
            for (Map<String, Object> m : raw) {
                LawSeed s = new LawSeed();
                s.referenceId = (String) m.get("referenceId");
                s.title = (String) m.get("title");
                s.shortName = (String) m.get("shortName");
                s.department = (String) m.get("department");
                s.enforceDate = (String) m.get("enforceDate");
                s.revisionType = (String) m.get("revisionType");
                s.url = (String) m.get("url");
                s.rawContent = (String) m.get("rawContent");
                result.add(s);
            }
            return result;
        }
    }

    @SuppressWarnings("unchecked")
    private List<CaseSeed> loadCaseSeeds() throws Exception {
        try (InputStream is = new ClassPathResource("rag-seed/cases.json").getInputStream()) {
            List<Map<String, Object>> raw = objectMapper.readValue(is, List.class);
            List<CaseSeed> result = new ArrayList<>();
            for (Map<String, Object> m : raw) {
                CaseSeed s = new CaseSeed();
                s.referenceId = (String) m.get("referenceId");
                s.title = (String) m.get("title");
                s.caseNumber = (String) m.get("caseNumber");
                s.court = (String) m.get("court");
                s.judgmentDate = (String) m.get("judgmentDate");
                s.caseType = (String) m.get("caseType");
                s.url = (String) m.get("url");
                s.issues = (String) m.get("issues");
                s.summary = (String) m.get("summary");
                s.reasoning = (String) m.get("reasoning");
                result.add(s);
            }
            return result;
        }
    }

    // ── 내부 모델 ──

    @Getter
    public static class LawSeed {
        private String referenceId;
        private String title;
        private String shortName;
        private String department;
        private String enforceDate;
        private String revisionType;
        private String url;
        private String rawContent;
    }

    @Getter
    public static class CaseSeed {
        private String referenceId;
        private String title;
        private String caseNumber;
        private String court;
        private String judgmentDate;
        private String caseType;
        private String url;
        private String issues;
        private String summary;
        private String reasoning;
    }

    @Getter
    @AllArgsConstructor
    public static class IngestionItemResult {
        private final String referenceId;
        private final String title;
        private final int chunkCount;
        private final int upsertedCount;
        private final boolean alreadyChunked;
    }

    @Getter
    @lombok.Setter
    public static class IngestionReport {
        private boolean lawsCollectionReady;
        private boolean casesCollectionReady;
        private int lawsCollectionCount = -1;
        private int casesCollectionCount = -1;
        private String skippedReason;
        private final List<IngestionItemResult> lawResults = new ArrayList<>();
        private final List<IngestionItemResult> caseResults = new ArrayList<>();
    }
}
