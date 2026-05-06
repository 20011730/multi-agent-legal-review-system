package com.legalreview.repository;

import com.legalreview.domain.LawList;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 법령 목록 메타데이터 레포지토리.
 *
 * PK 타입: Integer (LawList#lawMst — 외부 시스템이 부여하는 법령일련번호).
 *
 * 다른 레포지토리({@link LawDocumentRepository}, {@link CaseDocumentRepository})와의 컨벤션 일치:
 *  - JpaRepository 상속
 *  - 단순 query method (Spring Data 자동 구현)
 *  - 검색은 lawId 기반 단건 조회를 우선
 */
public interface LawListRepository extends JpaRepository<LawList, Integer> {

    /**
     * law_id (앞자리 0 보존 String) 기반 단건 조회.
     * @apiNote 같은 lawId로 lawMst가 여러 개일 수 있어 NonUniqueResultException 위험 존재.
     *          단건이 명확히 보장되는 환경에서만 사용. 일반적으로 {@link #findFirstByLawIdOrderByLawMstDesc(String)} 권장.
     */
    Optional<LawList> findByLawId(String lawId);

    /**
     * lawId 기준 가장 최근 등록(=가장 큰 lawMst) 1건만 조회.
     * 같은 lawId가 여러 row(개정 이력 등)일 때 안전하게 1건만 반환한다.
     */
    Optional<LawList> findFirstByLawIdOrderByLawMstDesc(String lawId);

    /** 법령명 부분일치 검색 (관리자/검색 화면용). */
    List<LawList> findByLawNameKrContaining(String keyword);

    /** 소관부처코드 기준 조회. */
    List<LawList> findByDeptCode(String deptCode);

    /** 법령구분명 기준 조회 (예: "법률" 전체 목록). */
    List<LawList> findByLawTypeName(String lawTypeName);
}
