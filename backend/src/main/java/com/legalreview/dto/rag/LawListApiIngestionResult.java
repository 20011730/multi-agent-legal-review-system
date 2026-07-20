package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 법령 목록 API 적재 결과.
 *
 * 응답 예:
 * <pre>
 * {
 *   "message": "law_list API ingestion completed",
 *   "totalCnt": 5583,
 *   "pagesProcessed": 1,
 *   "savedCount": 100,
 *   "display": 100,
 *   "completedAll": false,
 *   "skippedRows": 0,
 *   "failedPages": []
 * }
 * </pre>
 */
@Getter
@Builder
@AllArgsConstructor
public class LawListApiIngestionResult {
    /** API가 보고한 전체 법령 수. -1이면 응답에서 추출 실패. */
    private int totalCnt;
    /** 실제로 처리한 페이지 수. */
    private int pagesProcessed;
    /** law_list 테이블에 저장(신규+갱신)된 row 수. */
    private int savedCount;
    /** 사용된 display 값. */
    private int display;
    /** 전체 totalCnt를 모두 처리했는지 여부. */
    private boolean completedAll;
    /** 필수 필드 누락 등으로 skip된 row 수. */
    private int skippedRows;
    /** 호출 실패한 페이지 번호 목록. */
    private List<Integer> failedPages;
}
