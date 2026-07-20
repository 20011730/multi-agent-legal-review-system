package com.legalreview.service.rag;

import com.legalreview.domain.LawList;
import com.legalreview.dto.rag.LawListImportRow;
import org.springframework.stereotype.Component;

/**
 * LawListImportRow → LawList Entity 변환기.
 *
 * 책임:
 *   - row의 모든 String 필드 trim
 *   - 빈 문자열을 null로 정규화 (DB에 의미 없는 ""가 들어가는 것 방지)
 *   - 기존 Entity가 주어지면 in-place 갱신, 없으면 새 Entity 생성
 *   - lawMst를 PK로 그대로 보존 (외부 시스템 ID 그대로 사용)
 */
@Component
public class LawListImportMapper {

    /**
     * row를 target Entity에 적용.
     * @param row    import 입력 데이터
     * @param target null이면 새 LawList 생성, 아니면 기존 Entity 갱신
     * @return 적용된 LawList (target과 동일 인스턴스, target이 null이면 새 인스턴스)
     */
    public LawList apply(LawListImportRow row, LawList target) {
        LawList e = (target == null) ? new LawList() : target;

        e.setLawMst(row.getLawMst());
        e.setLawId(normalize(row.getLawId()));
        e.setCurrentHistoryCode(normalize(row.getCurrentHistoryCode()));
        e.setLawNameKr(normalize(row.getLawNameKr()));
        e.setLawNameShort(normalize(row.getLawNameShort()));
        e.setLawTypeName(normalize(row.getLawTypeName()));
        e.setDeptName(normalize(row.getDeptName()));
        e.setDeptCode(normalize(row.getDeptCode()));
        e.setPromulgateDate(normalize(row.getPromulgateDate()));
        e.setEnforceDate(normalize(row.getEnforceDate()));
        e.setPromulgateNo(normalize(row.getPromulgateNo()));
        e.setAmendType(normalize(row.getAmendType()));
        e.setDetailLink(normalize(row.getDetailLink()));
        e.setSelfOtherLaw(normalize(row.getSelfOtherLaw()));
        e.setJointDeptInfo(normalize(row.getJointDeptInfo()));
        e.setJointPromulgateNo(normalize(row.getJointPromulgateNo()));
        return e;
    }

    /**
     * trim 후 빈 문자열은 null로. null은 그대로 null.
     */
    private static String normalize(String v) {
        if (v == null) return null;
        String t = v.trim();
        return t.isEmpty() ? null : t;
    }

    /**
     * 필수 필드(lawMst / lawId / lawNameKr) 검증.
     * @return null이면 valid, 아니면 누락 사유 문자열
     */
    public String validate(LawListImportRow row) {
        if (row.getLawMst() == null) return "lawMst is required";
        String lawId = row.getLawId() == null ? "" : row.getLawId().trim();
        if (lawId.isEmpty()) return "lawId is required";
        String name = row.getLawNameKr() == null ? "" : row.getLawNameKr().trim();
        if (name.isEmpty()) return "lawNameKr is required";
        return null;
    }
}
