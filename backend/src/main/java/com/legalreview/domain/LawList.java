package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 법령 목록 메타데이터 테이블.
 *
 * 국가법령정보센터(law.go.kr) 법령 목록 API에서 가져온 메타정보를 그대로 저장.
 * - 본 테이블은 "목록"용. 법령 본문/원문은 {@link LawDocument}에 별도 저장.
 * - {@code law_id} 또는 {@code law_mst}를 기준으로 {@link LawDocument}와 soft link 가능
 *   (현 단계에서는 DB-level FK 미적용 — 외부 데이터 적재 순서/실패에 유연하게 대응).
 *
 * 역할 분리:
 *   law_list                  → 법령 목록 메타데이터 (이 테이블)
 *   law_documents             → 법령 본문/원문 마스터 (chunking 대상)
 *   Chroma laws collection    → 법령 본문 chunk + embedding + metadata
 *   evidences                 → 특정 검토 세션에서 최종 선택된 법령/판례 근거
 *
 * 추후 연결 예정:
 *   law_documents.reference_id 또는 별도 컬럼(예: law_mst)을 추가하여 본 테이블과 명시적 매핑.
 *   현재는 reference_id를 law.go.kr MST 값으로 채워두면 서로 조회 가능 (soft link).
 *
 * 주의:
 * - {@code lawMst}는 외부 시스템(국가법령정보센터)에서 제공하는 고유 식별자이므로
 *   {@code @GeneratedValue}를 붙이지 않는다 — 들어온 값을 그대로 PK로 사용.
 * - {@code lawId}는 앞자리 0 보존이 필요하므로 Integer가 아닌 String(20) 유지.
 * - 날짜는 YYYYMMDD String(8)로 유지 (기존 LawDocument와 동일 컨벤션).
 */
@Entity
@Table(
        name = "law_list",
        indexes = {
                @Index(name = "idx_law_list_law_id", columnList = "law_id")
        }
)
@Getter
@Setter
@NoArgsConstructor
public class LawList {

    /** 법령일련번호 — 국가법령정보센터에서 제공하는 고유 식별자 (PK). */
    @Id
    @Column(name = "law_mst", nullable = false)
    private Integer lawMst;

    /** 법령 ID — 예: "011546". 앞자리 0 보존이 필요하므로 String 유지. */
    @Column(name = "law_id", length = 20, nullable = false)
    private String lawId;

    /** 현행연혁코드. */
    @Column(name = "current_history_code", length = 10)
    private String currentHistoryCode;

    /** 법령명한글. */
    @Column(name = "law_name_kr", length = 255, nullable = false)
    private String lawNameKr;

    /** 법령약칭명. */
    @Column(name = "law_name_short", length = 100)
    private String lawNameShort;

    /** 법령구분명. 예: "법률", "대통령령". */
    @Column(name = "law_type_name", length = 50)
    private String lawTypeName;

    /** 소관부처명. */
    @Column(name = "dept_name", length = 100)
    private String deptName;

    /** 소관부처코드. */
    @Column(name = "dept_code", length = 50)
    private String deptCode;

    /** 공포일자 (YYYYMMDD 문자열). */
    @Column(name = "promulgate_date", length = 8)
    private String promulgateDate;

    /** 시행일자 (YYYYMMDD 문자열). */
    @Column(name = "enforce_date", length = 8)
    private String enforceDate;

    /** 공포번호. */
    @Column(name = "promulgate_no", length = 50)
    private String promulgateNo;

    /** 제·개정 구분명. */
    @Column(name = "amend_type", length = 50)
    private String amendType;

    /** 법령상세링크. */
    @Column(name = "detail_link", length = 255)
    private String detailLink;

    /** 자법·타법 여부. */
    @Column(name = "self_other_law", length = 50)
    private String selfOtherLaw;

    /** 공동부령정보. */
    @Column(name = "joint_dept_info", length = 255)
    private String jointDeptInfo;

    /** 공동부령 공포번호. */
    @Column(name = "joint_promulgate_no", length = 50)
    private String jointPromulgateNo;
}
