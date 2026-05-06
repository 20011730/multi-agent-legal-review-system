package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 판례 원문 저장 테이블.
 *
 * - 법제처 판례 검색 결과 중 상세 본문(판시사항/판결요지/판단이유)을 저장.
 * - Chroma의 cases 컬렉션에는 이 테이블의 id를 metadata로 함께 저장.
 * - chunking은 판시사항/판결요지/판단이유 단위로 분리하여 chunk-level retrieval을 가능하게 한다.
 */
@Entity
@Table(name = "case_documents",
       indexes = {
           @Index(name = "idx_case_documents_case_number", columnList = "caseNumber"),
           @Index(name = "idx_case_documents_court", columnList = "court")
       })
@Getter
@Setter
@NoArgsConstructor
public class CaseDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 판례일련번호 (법제처 PRC ID). */
    @Column(length = 50)
    private String referenceId;

    /** 사건명. */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String title;

    /** 사건번호. */
    @Column(length = 100)
    private String caseNumber;

    /** 법원명. */
    @Column(length = 200)
    private String court;

    /** 선고일자 (YYYYMMDD). */
    @Column(length = 8)
    private String judgmentDate;

    /** 사건종류. */
    @Column(length = 100)
    private String caseType;

    /** 원문 링크. */
    @Column(columnDefinition = "TEXT")
    private String url;

    /** 판시사항 (법원의 핵심 쟁점 정리). */
    @Column(columnDefinition = "TEXT")
    private String issues;

    /** 판결요지 (요지). */
    @Column(columnDefinition = "TEXT")
    private String summary;

    /** 판단이유 / 본문. */
    @Column(columnDefinition = "TEXT")
    private String reasoning;

    /** chunk 적재 완료 여부. */
    @Column(nullable = false)
    private boolean chunked = false;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column
    private LocalDateTime updatedAt;
}
