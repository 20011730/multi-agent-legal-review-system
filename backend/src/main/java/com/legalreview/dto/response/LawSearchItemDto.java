package com.legalreview.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

/**
 * 법제처 검색 결과 개별 항목 DTO.
 * 법령(LAW)과 판례(CASE) 모두 이 형식으로 통일한다.
 * toEvidenceDto()로 기존 EvidenceDto와 호환 변환 가능.
 */
@Getter
@Builder
@AllArgsConstructor
public class LawSearchItemDto {

    private String sourceType;     // "LAW" 또는 "CASE"
    private String title;          // 법령명 또는 사건명
    private String snippet;        // 요약 정보 (약칭|시행일 또는 사건종류|선고일|법원)
    private String referenceId;    // 법령일련번호 또는 사건번호
    private String articleOrCourt; // 소관부처명 또는 법원명
    private String url;            // 법령정보 상세 링크

    /**
     * 기존 EvidenceDto로 변환.
     * verdict/review detail 응답에서 evidence 필드로 재사용할 때 사용.
     */
    public EvidenceDto toEvidenceDto() {
        return new EvidenceDto(
                sourceType,        // sourceType
                title,             // title
                referenceId,       // referenceId
                articleOrCourt,    // articleOrCourt
                snippet,           // summary
                url,               // url
                "",                // relevanceReason (검색 결과에서는 빈 값)
                ""                 // quotedText (검색 결과에서는 빈 값)
        );
    }
}
