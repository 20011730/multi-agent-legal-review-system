package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 다건 법령 본문 적재 결과 (keyword/recommended).
 */
@Getter
@Builder
@AllArgsConstructor
public class LawDocumentBatchIngestionResult {
    /** 검색 keyword (recommended일 경우 "recommended" 같은 식별자). */
    private String keyword;
    /** 사용자가 요청한 limit. */
    private int requestedLimit;
    /** 실제 처리(API 호출 시도)한 건수. */
    private int processedCount;
    /** law_documents에 저장(신규+갱신)된 건수. */
    private int savedCount;
    /** 실패한 건수. */
    private int failedCount;
    /** 실패한 lawMst 목록 (lawMst 없으면 null 포함 가능). */
    private List<Integer> failedLawMstList;
    /** 항목별 상세 결과. */
    private List<LawDocumentIngestionResult> results;
}
