package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.domain.LawDocument;
import com.legalreview.dto.rag.LawChromaIngestionResult;
import com.legalreview.repository.LawDocumentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * law_documents → Chroma laws collection 적재 서비스.
 *
 * 흐름:
 *   1) {@link LawDocumentRepository#findByChunkedFalse()}로 미처리 문서 목록 조회
 *   2) 위에서 limit개를 잘라 처리
 *   3) {@link LegalChunker#chunkLaw(LawDocument)}로 조문 단위 chunk 생성
 *   4) {@link ChromaSearchService#ensureCollection(String)} → 컬렉션 보장
 *   5) {@link ChromaSearchService#upsertChunks(String, java.util.List)} → upsert
 *   6) upsert 성공 시 LawDocument.chunked=true + updatedAt 갱신
 *
 * 안전장치:
 *   - app.rag.enabled=false 면 ChromaSearchService가 즉시 빈 결과 반환 → 본 서비스도 결과 0건
 *   - 한 문서 실패해도 batch 전체 중단 X
 *   - chunked=true는 실제 upsert 성공 시에만 변경
 *   - chunk 0건인 문서는 실패로 기록(rawContent 비어있음 등)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LawDocumentChromaIngestionService {

    private final LawDocumentRepository lawDocumentRepository;
    private final LegalChunker legalChunker;
    private final ChromaSearchService chromaSearchService;
    private final RagProperties ragProperties;

    /**
     * chunked=false 인 LawDocument를 limit개 처리.
     * @param limit 0 이하면 1로 보정. 너무 많으면 호출 측에서 컨트롤 (기본 권장 20~30)
     */
    @Transactional
    public LawChromaIngestionResult ingestPendingLawDocuments(int limit) {
        String collection = ragProperties.getChroma().getLawsCollection();
        int safeLimit = Math.max(1, limit);

        if (!ragProperties.isEnabled()) {
            log.warn("[CHROMA-INGEST] app.rag.enabled=false — 적재 스킵 (no-op)");
            return LawChromaIngestionResult.builder()
                    .processedDocuments(0).chunkedDocuments(0).totalChunks(0)
                    .failedDocuments(0).failedReferenceIds(List.of())
                    .collectionName(collection)
                    .build();
        }

        // 컬렉션 보장 (없으면 생성). 실패 시 명시적 에러 결과 반환.
        boolean ready = chromaSearchService.ensureCollection(collection);
        if (!ready) {
            log.error("[CHROMA-INGEST] 컬렉션 보장 실패 ({}). Chroma 서버 확인 필요.", collection);
            return LawChromaIngestionResult.builder()
                    .processedDocuments(0).chunkedDocuments(0).totalChunks(0)
                    .failedDocuments(0).failedReferenceIds(List.of())
                    .collectionName(collection)
                    .build();
        }

        List<LawDocument> pending = lawDocumentRepository.findByChunkedFalse();
        if (pending.isEmpty()) {
            log.info("[CHROMA-INGEST] chunked=false 문서 없음 — 처리할 작업 없음");
            return LawChromaIngestionResult.builder()
                    .processedDocuments(0).chunkedDocuments(0).totalChunks(0)
                    .failedDocuments(0).failedReferenceIds(List.of())
                    .collectionName(collection)
                    .build();
        }

        int actualLimit = Math.min(safeLimit, pending.size());
        log.info("[CHROMA-INGEST] 시작 — pending={}, limit={}, actual={}",
                pending.size(), safeLimit, actualLimit);

        int processed = 0;
        int chunkedOk = 0;
        int totalChunks = 0;
        int failed = 0;
        List<String> failedRefIds = new ArrayList<>();

        for (int i = 0; i < actualLimit; i++) {
            LawDocument doc = pending.get(i);
            processed++;

            // 진단 로그: 입력 메타
            int rawLen = doc.getRawContent() == null ? 0 : doc.getRawContent().length();
            log.info("[CHROMA-INGEST] [{}/{}] refId={}, title='{}', rawContentLen={}",
                    i + 1, actualLimit,
                    doc.getReferenceId(),
                    truncate(doc.getTitle(), 40),
                    rawLen);

            if (rawLen == 0) {
                log.warn("[CHROMA-INGEST] ↳ SKIP 원인: rawContent 비어있음 (refId={}, title='{}')",
                        doc.getReferenceId(), truncate(doc.getTitle(), 40));
                failed++;
                failedRefIds.add(doc.getReferenceId());
                continue;
            }

            List<LegalChunker.Chunk> chunks;
            try {
                chunks = legalChunker.chunkLaw(doc);
            } catch (Exception e) {
                log.warn("[CHROMA-INGEST] ↳ chunking 예외 (refId={}): {}",
                        doc.getReferenceId(), e.getMessage(), e);
                failed++;
                failedRefIds.add(doc.getReferenceId());
                continue;
            }

            if (chunks == null || chunks.isEmpty()) {
                log.warn("[CHROMA-INGEST] ↳ chunk 0건: refId={} — LegalChunker가 조문 패턴 매칭 실패 (rawContentLen={})",
                        doc.getReferenceId(), rawLen);
                failed++;
                failedRefIds.add(doc.getReferenceId());
                continue;
            }

            log.info("[CHROMA-INGEST] ↳ chunks 생성={} (samples: {})",
                    chunks.size(),
                    chunks.size() > 0 ? chunks.get(0).getChunkId() : "n/a");

            int upserted;
            try {
                upserted = chromaSearchService.upsertChunks(collection, chunks);
            } catch (Exception e) {
                log.warn("[CHROMA-INGEST] ↳ Chroma upsert 예외 (refId={}): {}",
                        doc.getReferenceId(), e.getMessage(), e);
                failed++;
                failedRefIds.add(doc.getReferenceId());
                continue;
            }

            if (upserted <= 0) {
                log.warn("[CHROMA-INGEST] ↳ Chroma upsert 0 (refId={}, attempted={}) — Chroma 응답 비정상 또는 컬렉션 미해석",
                        doc.getReferenceId(), chunks.size());
                failed++;
                failedRefIds.add(doc.getReferenceId());
                continue;
            }

            // 성공 — DB 마킹
            doc.setChunked(true);
            doc.setUpdatedAt(LocalDateTime.now());
            lawDocumentRepository.save(doc);

            chunkedOk++;
            totalChunks += upserted;
            log.info("[CHROMA-INGEST] ↳ OK refId={}, chunks={} ({}/{} 누적)",
                    doc.getReferenceId(), upserted, chunkedOk, actualLimit);
        }

        return LawChromaIngestionResult.builder()
                .processedDocuments(processed)
                .chunkedDocuments(chunkedOk)
                .totalChunks(totalChunks)
                .failedDocuments(failed)
                .failedReferenceIds(failedRefIds)
                .collectionName(collection)
                .build();
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
