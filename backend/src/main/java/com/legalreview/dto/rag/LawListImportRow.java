package com.legalreview.dto.rag;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 법령 목록 import 입력 DTO.
 *
 * 다양한 입력 형식(JSON / CSV / Excel / API 응답)을 모두 이 DTO로 정규화한 뒤
 * {@link com.legalreview.service.rag.LawListImportMapper}가 LawList Entity로 변환한다.
 *
 * 주의:
 *  - lawId는 앞자리 0 보존을 위해 String 유지
 *  - 날짜는 YYYYMMDD String(8) 유지
 *  - 외부 입력 컬럼명이 달라질 경우 별도 adapter에서 본 DTO로 매핑
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class LawListImportRow {
    private Integer lawMst;
    private String lawId;
    private String currentHistoryCode;
    private String lawNameKr;
    private String lawNameShort;
    private String lawTypeName;
    private String deptName;
    private String deptCode;
    private String promulgateDate;
    private String enforceDate;
    private String promulgateNo;
    private String amendType;
    private String detailLink;
    private String selfOtherLaw;
    private String jointDeptInfo;
    private String jointPromulgateNo;
}
