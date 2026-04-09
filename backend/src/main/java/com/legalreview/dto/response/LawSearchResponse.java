package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 법제처 검색 API 통합 응답 DTO.
 */
@Getter
@Builder
@AllArgsConstructor
public class LawSearchResponse {

    private String keyword;
    private int totalCount;
    private List<LawSearchItemDto> evidences;
}
