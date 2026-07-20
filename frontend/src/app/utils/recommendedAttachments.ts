/**
 * Phase 10.19 — 추천 첨부자료 helper (deterministic, rule-based).
 *
 * startupContext / startupExtras / scenarioCategory / reviewType 를 입력으로 받아
 * 사용자가 “왜 이 자료가 필요한지” 이해할 수 있도록 구조화된 추천 목록을 반환한다.
 *
 * 본 helper 는 Input 화면 UI 와 session payload(startupExtras.recommendedAttachments)
 * 양쪽에서 동일하게 사용된다.
 */

export type Sensitivity = "low" | "medium" | "high";

export interface RecommendedAttachment {
  /** 사용자에게 보이는 라벨 (예: 공고문 원문 PDF) */
  label: string;
  /** 왜 이 자료가 필요한지 — hover/title/desc 노출 */
  reason: string;
  /** 데이터 민감도 — high 면 마스킹/사내 승인 강조 */
  sensitivity: Sensitivity;
  /** 필수 여부 — 진단을 위해 필요할수록 false=권장, true=옵션 */
  optional: boolean;
  /** UI/payload 식별자 — analytics 등에서 사용 */
  key: string;
}

interface BuildArgs {
  startupContextPresent: boolean;
  scenarioCategory?: string;
  startupExtras?: Record<string, unknown> | null;
  reviewType?: string;
}

/**
 * 상황 기반 추천 자료를 산출한다.
 *
 * - startupContext 가 있으면 지원사업 특화 자료를 우선 노출
 * - 추가로 startupExtras 값(privacyHandling/ipOutput/workforce 등)을 보고 추가 자료 권장
 * - scenarioCategory 별 기본 목록은 fallback
 */
export function recommendedAttachmentsFor({
  startupContextPresent,
  scenarioCategory,
  startupExtras,
  reviewType,
}: BuildArgs): RecommendedAttachment[] {
  const list: RecommendedAttachment[] = [];

  if (startupContextPresent) {
    list.push(
      {
        key: "announcement",
        label: "공고문 원문 PDF",
        reason: "지원 자격·제외 조건·접수 마감 확인",
        sensitivity: "low",
        optional: false,
      },
      {
        key: "business-plan",
        label: "사업계획서 초안",
        reason: "사업 내용과 수행 범위·성과물 계획 정합성 확인",
        sensitivity: "medium",
        optional: false,
      },
      {
        key: "agreement",
        label: "협약서 / 선정 후 협약 조건",
        reason: "환수·정산·해지·제재 조항 검토",
        sensitivity: "medium",
        optional: false,
      },
      {
        key: "budget",
        label: "예산 산출내역서",
        reason: "사업비 집행 가능 항목·증빙 기준 확인",
        sensitivity: "medium",
        optional: true,
      },
      {
        key: "outsource-contract",
        label: "외주·용역 계약 초안",
        reason: "도급/위탁 구분과 성과물 귀속 확인",
        sensitivity: "medium",
        optional: true,
      },
      {
        key: "ip-clause",
        label: "성과물/IP 귀속 조항",
        reason: "단독·공동 권리 분배와 IP 양도 범위 확인",
        sensitivity: "medium",
        optional: true,
      },
    );

    // startupExtras 기반 추가 권장
    const extras = startupExtras || {};
    if (extras.privacyHandling && String(extras.privacyHandling).trim()) {
      list.push({
        key: "privacy-flow",
        label: "개인정보 처리 흐름",
        reason: "개인정보 수집·보관·제3자 제공 범위 확인",
        sensitivity: "high",
        optional: true,
      });
    }
    if (extras.workforce && String(extras.workforce).trim()) {
      list.push({
        key: "workforce-contracts",
        label: "근로/프리랜서 계약서",
        reason: "근로자성·도급 구분, 임금/4대보험 처리 확인",
        sensitivity: "high",
        optional: true,
      });
    }
    return list;
  }

  switch (scenarioCategory) {
    case "data":
      return [
        { key: "privacy-policy", label: "개인정보 처리방침", reason: "수집·이용·보관 조항 검토", sensitivity: "medium", optional: false },
        { key: "consent", label: "동의서 / 동의 문구", reason: "동의 항목 명시성·선택권", sensitivity: "low", optional: false },
        { key: "data-processor", label: "처리 위탁 계약서", reason: "위탁사·제3자 제공 범위", sensitivity: "high", optional: true },
        { key: "data-map", label: "수집 항목·이용 목적 표", reason: "최소수집 원칙 적합성", sensitivity: "medium", optional: true },
      ];
    case "ip":
      return [
        { key: "joint-rnd", label: "공동연구·협약서", reason: "성과물 단독·공동 귀속", sensitivity: "medium", optional: false },
        { key: "patent-spec", label: "출원 명세서 / 상표권 자료", reason: "권리 범위·우선권", sensitivity: "medium", optional: true },
        { key: "outsource", label: "외주·용역 계약서", reason: "결과물 귀속 조항", sensitivity: "medium", optional: true },
      ];
    case "labor":
      return [
        { key: "employment", label: "근로계약서 / 외주계약서", reason: "근로자성 / 도급 구분", sensitivity: "high", optional: false },
        { key: "internal-rules", label: "사내 규정·취업규칙", reason: "스톡옵션·해지·비밀유지", sensitivity: "medium", optional: true },
        { key: "payroll", label: "임금 명세·지급 방식", reason: "4대보험·퇴직금 처리", sensitivity: "high", optional: true },
      ];
    case "funding":
      return [
        { key: "term-sheet", label: "Term Sheet", reason: "투자 조건·우선권 검토", sensitivity: "high", optional: false },
        { key: "shareholder", label: "주주간계약서", reason: "동의권·태그/드래그 조항", sensitivity: "high", optional: true },
        { key: "cap-table", label: "정관 / cap table", reason: "지분 희석·경영권 확인", sensitivity: "high", optional: true },
      ];
    case "regulation":
      return [
        { key: "service-flow", label: "사업 개요 / 서비스 흐름도", reason: "인허가 범위 확정", sensitivity: "low", optional: false },
        { key: "law-mapping", label: "관련 법령·고시·가이드라인", reason: "근거 규정 매핑", sensitivity: "low", optional: true },
        { key: "permit", label: "기존 인·허가 사본", reason: "변경·갱신 사유 확인", sensitivity: "medium", optional: true },
      ];
    default: {
      // reviewType 별 추가 fallback
      if ((reviewType || "").toLowerCase().includes("contract")) {
        return [
          { key: "contract-draft", label: "계약서 / 약관 초안", reason: "독소조항·해지·환불 조건", sensitivity: "medium", optional: false },
          { key: "estimate", label: "견적서 / 발주서 / 제안서", reason: "거래 조건 명시", sensitivity: "low", optional: true },
          { key: "negotiation", label: "상대방과 협의 이력", reason: "협상 맥락 보완", sensitivity: "low", optional: true },
        ];
      }
      return [
        { key: "contract-draft", label: "계약서 / 약관 초안", reason: "독소조항·해지·환불", sensitivity: "medium", optional: false },
        { key: "estimate", label: "견적서 / 발주서 / 제안서", reason: "거래 조건 명시", sensitivity: "low", optional: true },
        { key: "negotiation", label: "상대방과 협의 이력", reason: "협상 맥락 보완", sensitivity: "low", optional: true },
      ];
    }
  }
}
