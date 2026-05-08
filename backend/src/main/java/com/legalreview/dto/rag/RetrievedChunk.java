package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.Map;

/**
 * Chroma 검색 결과 1건을 표현하는 내부 모델.
 *
 * Chroma 응답의 ids/documents/metadatas/distances 배열이 row 단위로 묶인 형태.
 * EvidenceAssembler에서 이 모델을 EvidenceDto로 변환한다.
 */
@Getter
@Builder
@AllArgsConstructor
public class RetrievedChunk {

    /** Chroma 문서 ID (e.g. "law:277377:art:42"). */
    private String chunkId;

    /** 컬렉션 종류 — "LAW" 또는 "CASE". */
    private String sourceType;

    /** chunk 본문 텍스트. */
    private String chunkText;

    /**
     * Chroma metadata. 화면 출력에 필요한 모든 키-값을 담는다.
     *  - law: title, articleNo, lawId, department, enforceDate, url
     *  - case: title, caseNumber, court, judgmentDate, caseType, section ("issues"|"summary"|"reasoning"), url
     */
    private Map<String, Object> metadata;

    /**
     * Chroma distance (낮을수록 유사). 화면에서는 1 - distance 형태로 가공 가능.
     */
    private Double distance;

    /** PostgreSQL 원문 row id (있으면). */
    private Long sourceRowId;

    public String metaString(String key) {
        Object v = metadata != null ? metadata.get(key) : null;
        return v == null ? "" : v.toString();
    }
}
