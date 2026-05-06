package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * law_documents → Chroma laws collection upsert 결과.
 *
 * 응답 예:
 * <pre>
 * {
 *   "processedDocuments": 18,
 *   "chunkedDocuments":   18,
 *   "totalChunks":        120,
 *   "failedDocuments":    0,
 *   "failedReferenceIds": [],
 *   "collectionName":     "laws"
 * }
 * </pre>
 */
@Getter
@Builder
@AllArgsConstructor
public class LawChromaIngestionResult {
    /** 처리 시도한 문서 수 (chunked=false 인 row 중 limit만큼). */
    private int processedDocuments;
    /** Chroma upsert 성공 후 chunked=true 마킹된 문서 수. */
    private int chunkedDocuments;
    /** 모든 문서에서 생성된 chunk 총 개수. */
    private int totalChunks;
    /** Chroma upsert 또는 chunking에서 실패한 문서 수. */
    private int failedDocuments;
    /** 실패한 LawDocument.referenceId 목록. */
    private List<String> failedReferenceIds;
    /** 사용된 Chroma 컬렉션 이름. */
    private String collectionName;
}
