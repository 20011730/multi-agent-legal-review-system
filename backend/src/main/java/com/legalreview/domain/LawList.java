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
 * ─────────────────────────────────────────────────────────────────────
 * 문자열 컬럼 타입 정책 (2026-05-13 갱신):
 *   - 기존: 각 컬럼별 VARCHAR(8/20/50/100/255) 길이 제한
 *   - 변경: 모든 문자열 메타 필드를 PostgreSQL {@code TEXT}로 통일
 *   - 이유: 국가법령정보센터 응답의 일부 필드(부처명 결합, 상세링크, 공동부령 정보 등)가
 *           예상보다 길어 적재 중 {@code value too long for type character varying(N)}
 *           오류 발생. 수집 안정성을 위해 길이 제한을 모두 해제.
 *   - 운영 방식: {@code @Column(columnDefinition = "TEXT")}로 명시. 실제 DB도 동일하게
 *                {@code ALTER TABLE ... ALTER COLUMN ... TYPE TEXT}로 변경 완료.
 *
 * 주의:
 * - {@code lawMst}는 외부 시스템(국가법령정보센터)에서 제공하는 고유 식별자이므로
 *   {@code @GeneratedValue}를 붙이지 않는다 — 들어온 값을 그대로 PK로 사용.
 * - {@code lawId}는 앞자리 0 보존이 필요하므로 Integer가 아닌 String 유지.
 * - 날짜(promulgateDate/enforceDate)는 YYYYMMDD 문자열로 유지하되 타입은 TEXT.
 * - {@code law_status}는 ai/generate_rag Python 적재 스크립트가 사용하는 컬럼(현행/시행예정 구분).
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

    /** 법령일련번호 — 국가법령정보센터에서 제공하는 고유 식별자 (PK). Integer 유지. */
    @Id
    @Column(name = "law_mst", nullable = false)
    private Integer lawMst;

    /** 법령 ID — 예: "011546". 앞자리 0 보존이 필요하므로 String 유지 (타입은 TEXT). */
    @Column(name = "law_id", columnDefinition = "TEXT", nullable = false)
    private String lawId;

    /** 현행연혁코드. */
    @Column(name = "current_history_code", columnDefinition = "TEXT")
    private String currentHistoryCode;

    /** 법령명한글. 서비스상 필수값이지만 DB 타입은 TEXT (긴 법령명 대응). */
    @Column(name = "law_name_kr", columnDefinition = "TEXT", nullable = false)
    private String lawNameKr;

    /** 법령약칭명. */
    @Column(name = "law_name_short", columnDefinition = "TEXT")
    private String lawNameShort;

    /** 법령구분명. 예: "법률", "대통령령". */
    @Column(name = "law_type_name", columnDefinition = "TEXT")
    private String lawTypeName;

    /** 소관부처명. */
    @Column(name = "dept_name", columnDefinition = "TEXT")
    private String deptName;

    /** 소관부처코드 (여러 부처 결합 시 길어질 수 있어 TEXT). */
    @Column(name = "dept_code", columnDefinition = "TEXT")
    private String deptCode;

    /** 공포일자 (YYYYMMDD 문자열). 타입은 TEXT. */
    @Column(name = "promulgate_date", columnDefinition = "TEXT")
    private String promulgateDate;

    /** 시행일자 (YYYYMMDD 문자열). 타입은 TEXT. */
    @Column(name = "enforce_date", columnDefinition = "TEXT")
    private String enforceDate;

    /** 공포번호. */
    @Column(name = "promulgate_no", columnDefinition = "TEXT")
    private String promulgateNo;

    /** 제·개정 구분명. */
    @Column(name = "amend_type", columnDefinition = "TEXT")
    private String amendType;

    /** 법령상세링크 (URL). */
    @Column(name = "detail_link", columnDefinition = "TEXT")
    private String detailLink;

    /** 자법·타법 여부. */
    @Column(name = "self_other_law", columnDefinition = "TEXT")
    private String selfOtherLaw;

    /** 공동부령정보. */
    @Column(name = "joint_dept_info", columnDefinition = "TEXT")
    private String jointDeptInfo;

    /** 공동부령 공포번호. */
    @Column(name = "joint_promulgate_no", columnDefinition = "TEXT")
    private String jointPromulgateNo;

    /**
     * 법령 상태 (현행/시행예정/연혁 등).
     * ai/generate_rag Python 적재 스크립트(2-2.insert_lawList.py)가 사용하는 컬럼.
     */
    @Column(name = "law_status", columnDefinition = "TEXT")
    private String lawStatus;
}
