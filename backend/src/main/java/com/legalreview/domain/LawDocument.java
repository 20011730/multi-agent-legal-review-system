package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 법령 원문 저장 테이블.
 *
 * - 법제처 OPEN API 등에서 수집한 법령의 메타정보 + 본문을 저장.
 * - Chroma의 laws 컬렉션에는 이 테이블의 id를 metadata로 함께 저장하여
 *   retrieval 결과에서 PostgreSQL 원문으로 다시 거슬러 갈 수 있게 한다.
 * - chunking은 LegalChunker에서 본문을 조문 단위로 분리해 별도 chunk DB(또는 Chroma만)로 적재한다.
 */
@Entity
@Table(name = "law_documents",
       indexes = {
           @Index(name = "idx_law_documents_reference_id", columnList = "referenceId"),
           @Index(name = "idx_law_documents_title", columnList = "title")
       })
@Getter
@Setter
@NoArgsConstructor
public class LawDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 법령일련번호 (법제처 MST). 컬렉션 내 고유 식별자로 사용 가능. */
    @Column(length = 50)
    private String referenceId;

    /** 법령명 (한글). */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String title;

    /** 법령약칭. */
    @Column(length = 200)
    private String shortName;

    /** 소관부처. */
    @Column(length = 200)
    private String department;

    /** 시행일자 (YYYYMMDD). */
    @Column(length = 8)
    private String enforceDate;

    /** 제·개정 구분. */
    @Column(length = 50)
    private String revisionType;

    /** 원문 링크. */
    @Column(columnDefinition = "TEXT")
    private String url;

    /** 법령 본문 전체 (조문 분리 전 raw text). */
    @Column(columnDefinition = "TEXT")
    private String rawContent;

    /** chunk 적재 완료 여부 — Chroma 적재 시 true로 표시. */
    @Column(nullable = false)
    private boolean chunked = false;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column
    private LocalDateTime updatedAt;
}
