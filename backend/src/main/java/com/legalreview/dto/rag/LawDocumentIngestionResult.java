package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

/**
 * 단건 법령 본문 적재 결과.
 */
@Getter
@Builder
@AllArgsConstructor
public class LawDocumentIngestionResult {
    /** 적재 성공 여부. */
    private boolean success;
    /** 법령일련번호. */
    private Integer lawMst;
    /** 법령ID (앞자리 0 보존 String). */
    private String lawId;
    /** 법령명 한글. */
    private String title;
    /** 저장된 LawDocument PK. 실패/스킵 시 null. */
    private Long documentId;
    /** rawContent 길이(문자수). */
    private int contentLength;
    /** 결과 사유 / 에러 메시지. */
    private String message;
}
