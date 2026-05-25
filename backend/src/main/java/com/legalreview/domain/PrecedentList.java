package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 판례 목록 메타데이터 테이블.
 *
 * 국가법령정보센터(law.go.kr) 판례 목록 API에서 가져온 메타정보를 그대로 저장.
 * - 본 테이블은 "목록"용. 판례 본문/원문은 별도 테이블(예: PrecedentDocument)에 저장 예정.
 * - {@code precSerial}(판례일련번호)을 기준으로 본문 테이블과 soft link 가능
 *   (현 단계에서는 DB-level FK 미적용 — 외부 데이터 적재 순서/실패에 유연하게 대응).
 *
 * 역할 분리:
 *   precedent_list                → 판례 목록 메타데이터 (이 테이블)
 *   CaseDocument           → 판례 본문/원문 마스터 (chunking 대상, 추후 추가)
 *   Chroma precedents collection  → 판례 본문 chunk + embedding + metadata
 *   evidences                     → 특정 검토 세션에서 최종 선택된 법령/판례 근거
 *
 * 주의:
 * - {@code precSerial}은 외부 시스템(국가법령정보센터)에서 제공하는 고유 식별자이므로
 *   {@code @GeneratedValue}를 붙이지 않는다 — 들어온 값을 그대로 PK로 사용.
 * - API 응답의 {@code prec id}는 검색 결과 내 순번(검색결과번호)이므로 PK로 부적합.
 *   레코드 고유성은 {@code 판례일련번호} 기준.
 * - 날짜는 YYYYMMDD String(8)로 유지 (LawList와 동일 컨벤션).
 */
@Entity
@Table(
        name = "precedent_list",
        indexes = {
                @Index(name = "idx_prec_list_case_no", columnList = "case_no"),
                @Index(name = "idx_prec_list_court_type_code", columnList = "court_type_code"),
                @Index(name = "idx_prec_list_judgment_date", columnList = "judgment_date")
        }
)
@Getter
@Setter
@NoArgsConstructor
public class PrecedentList {

    /** 판례일련번호 — 국가법령정보센터에서 제공하는 고유 식별자 (PK). */
    @Id
    @Column(name = "prec_serial", nullable = false)
    private Integer precSerial;

    /** 사건명. */
    // 변경 — nullable=false 제거 (기본값이 nullable=true)
    @Column(name = "case_name", length = 500)
    private String caseName;

    /** 사건번호. 예: "2009느합133". 복수 사건번호가 콤마로 들어오는 경우가 있어 length 여유 있게. */
    @Column(name = "case_no", length = 200)
    private String caseNo;

    /** 선고일자 (YYYYMMDD 문자열). */
    @Column(name = "judgment_date", length = 8)
    private String judgmentDate;

    /** 법원명. 예: "대법원", "서울고등법원". */
    @Column(name = "court_name", length = 100)
    private String courtName;

    /** 법원종류코드. 대법원:400201, 하위법원:400202. */
    @Column(name = "court_type_code")
    private Integer courtTypeCode;

    /** 사건종류명. 예: "민사", "형사", "행정". */
    @Column(name = "case_type_name", length = 50)
    private String caseTypeName;

    /** 사건종류코드. */
    @Column(name = "case_type_code")
    private Integer caseTypeCode;

    /** 판결유형. 예: "판결", "결정". */
    @Column(name = "judgment_type", length = 50)
    private String judgmentType;

    /** 선고. 예: "선고", "자". */
    @Column(name = "judgment_result", length = 50)
    private String judgmentResult;

    /** 데이터출처명. 예: "국세법령정보시스템", "근로복지공단산재판례", "대법원". */
    @Column(name = "data_source", length = 100)
    private String dataSource;

    /** 판례상세링크. 본문 fetch URL 구성에 사용. */
    @Column(name = "detail_link", length = 512)
    private String detailLink;
}