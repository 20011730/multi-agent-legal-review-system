/**
 * startupSupportInsight.ts — 지원사업 카드/모달의 deterministic 분석 util (Phase 10.9 강화).
 *
 * 향후 실제 LLM 으로 교체 가능. 함수명에 "AI" 안 쓰는 정직한 네이밍.
 * 호출 시그니처: `buildStartupSupportInsight(item, userContext?)`
 */
import type { SupportItem } from "./mockStartupSupport";

export type InsightLevel = "높음" | "보통" | "낮음";

/** 공고 성격 분류 — 모달 한 줄 요약 / 리스크 분류에 사용. */
export type ProgramKind =
  | "교육"
  | "멘토링·컨설팅"
  | "R&D"
  | "투자·IR"
  | "정책자금·바우처"
  | "사업화·창업패키지"
  | "보조금·정산"
  | "행사·네트워킹"
  | "기타";

export interface StartupSupportInsight {
  summary: string;
  level: InsightLevel;
  reason: string;
  fitFor: string;
  legalReviewPoints: string[];
  /** Phase 10.9 — 예상 리스크 태그 (UI chip) */
  riskTags: string[];
  /** Phase 10.9 — 공고 성격 분류 */
  kind: ProgramKind;
  /** Phase 10.9 — 추천 첨부 자료 */
  recommendedAttachments: string[];
  /** Phase 10.9 — 원문 근거 문장(있는 그대로, 분석문장과 별도) */
  evidenceSnippet: string;
  score: number;
  /** Phase 10.13 — 신청자 관점 핵심 (실제 신청 기업이 준비해야 할 사항) */
  applicantPerspective: string[];
}

interface UserContext {
  industry?: string;
  stage?: "예비" | "초기" | "성장" | "확장";
}

const KEYWORDS = {
  invest: ["투자", "ir", "tips", "팁스", "데모데이", "피칭", "투자유치", "vc"],
  rnd: ["r&d", "rnd", "연구개발", "기술개발", "특허기술"],
  hr: ["고용", "인력", "청년", "채용", "근로", "노무", "외주", "용역"],
  global: ["해외", "수출", "글로벌", "global", "export"],
  funding: ["사업화", "바우처", "패키지", "지원금", "정책자금"],
  ip: ["지식재산", "ip", "특허", "성과물"],
  edu: ["교육", "아카데미", "세미나", "설명회", "캠프", "강좌"],
  mentoring: ["멘토링", "컨설팅", "상담", "자문"],
  subsidy: ["보조금", "정산", "환수", "협약"],
  privacy: ["개인정보", "데이터", "ai", "고객정보"],
  marketing: ["100%", "무료", "보장", "최저가"],
};

function hay(item: SupportItem): string {
  return [
    item.title,
    item.fieldSummary,
    item.recommendReason,
    item.target,
    item.organization,
    item.rawCategory ?? "",
    item.category,
  ]
    .join(" ")
    .toLowerCase();
}

function matchesAny(h: string, kws: string[]): boolean {
  return kws.some((kw) => h.includes(kw));
}

function safeDateDiff(deadline: string): number | null {
  const m = deadline.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Phase 10.9 — 공고 성격 분류 (한 줄 요약·리스크 태그·첨부 추천에 활용). */
function classifyKind(item: SupportItem): ProgramKind {
  const h = hay(item);
  if (matchesAny(h, KEYWORDS.invest)) return "투자·IR";
  if (matchesAny(h, KEYWORDS.rnd)) return "R&D";
  if (matchesAny(h, KEYWORDS.mentoring)) return "멘토링·컨설팅";
  if (matchesAny(h, KEYWORDS.edu)) return "교육";
  if (matchesAny(h, KEYWORDS.subsidy)) return "보조금·정산";
  if (matchesAny(h, ["행사", "네트워크", "네트워킹"])) return "행사·네트워킹";
  if (matchesAny(h, KEYWORDS.funding)) return "사업화·창업패키지";
  if (matchesAny(h, ["정책자금", "융자", "보증", "대출"])) return "정책자금·바우처";
  return "기타";
}

/** Phase 10.9 — 말줄임으로 끝나는 문장(원문 truncation) 은 요약으로 부적합 → 안전 fallback. */
function isTruncatedSentence(s: string | undefined | null): boolean {
  if (!s) return true;
  const t = s.trim();
  return t.endsWith("...") || t.endsWith("…") || t.endsWith("..") || t.length < 12;
}

/** Phase 10.9 — 카테고리 기반 자연어 한 줄 요약 생성. truncated 본문에 의존하지 않음. */
function buildSummary(item: SupportItem, kind: ProgramKind): string {
  const org = item.organization && item.organization !== "확인 필요" ? item.organization : "공공기관";
  const target = item.target && item.target !== "확인 필요" ? item.target : "스타트업/예비창업자";
  const cat = item.category;

  const map: Record<ProgramKind, string> = {
    "교육": `${org}이 ${target}에게 제공하는 ${cat} 분야 교육·강좌 프로그램입니다.`,
    "멘토링·컨설팅": `${org}이 ${target} 대상으로 진행하는 멘토링·컨설팅 지원사업입니다.`,
    "R&D": `${org}이 ${target}의 R&D·기술개발을 지원하는 프로그램으로 성과물·지식재산권 귀속 검토가 필요합니다.`,
    "투자·IR": `${org}이 ${target}의 투자·IR 활동을 지원하는 프로그램으로 투자계약·지분구조 검토가 동반될 수 있습니다.`,
    "정책자금·바우처": `${org}이 ${target}에게 정책자금·바우처를 제공하는 사업으로 사용 목적·정산 요건 검토가 필요합니다.`,
    "사업화·창업패키지": `${org}이 ${target}의 사업화 단계를 종합 지원하는 패키지로 협약·정산·성과물 관련 리스크가 동반됩니다.`,
    "보조금·정산": `${org}이 ${target}에게 보조금을 지원하는 사업으로 정산·환수·중복수혜 리스크를 신청 전 점검해야 합니다.`,
    "행사·네트워킹": `${org}이 주최하는 ${cat} 관련 행사·네트워킹 프로그램입니다.`,
    "기타": `${org}이 ${target}에게 제공하는 ${cat} 분야 지원사업입니다.`,
  };
  return map[kind];
}

/** Phase 10.9 — 카테고리 기반 추천 첨부 자료. */
function buildRecommendedAttachments(kind: ProgramKind): string[] {
  const base = ["공고문 원문 PDF", "사업계획서 초안"];
  switch (kind) {
    case "R&D":
      return [...base, "공동연구·협약서 안", "성과물/IP 귀속 조항", "외주·용역 계획"];
    case "투자·IR":
      return [...base, "Term Sheet", "주주간계약서", "cap table"];
    case "정책자금·바우처":
    case "보조금·정산":
      return [...base, "예산 산출내역서", "사업비 집행 기준", "정산 보고서 양식"];
    case "사업화·창업패키지":
      return [...base, "협약서/협약 예정 문구", "외주·용역 계약서", "팀 구성표"];
    case "멘토링·컨설팅":
      return [...base, "용역계약서", "비밀유지서약(NDA)"];
    case "교육":
      return [...base, "교육 일정·이수 요건"];
    default:
      return base;
  }
}

/** Phase 10.9 — 원문 근거 문장 (요약과 분리. 끊긴 문장이라도 그대로 인용). */
function pickEvidenceSnippet(item: SupportItem): string {
  const src = item.fieldSummary?.trim() || item.recommendReason?.trim() || "";
  if (!src) return "";
  // 첫 2문장 또는 200자 이내
  const firstTwo = src.split(/[.。\n]/).slice(0, 2).join(". ").trim();
  const out = firstTwo.length >= 30 ? firstTwo : src;
  return out.length > 200 ? out.slice(0, 200) + "..." : out;
}

/**
 * deterministic 추천 / 요약 / 법률 검토 포인트 / 리스크 태그 / 첨부 추천 계산.
 * @param userContext (선택) 향후 확장용
 */
export function buildStartupSupportInsight(
  item: SupportItem,
  _userContext?: UserContext,
): StartupSupportInsight {
  const h = hay(item);
  const points: string[] = [];
  const riskTags: string[] = [];
  const kind = classifyKind(item);

  let score = 40;
  if (item.status === "모집중") score += 20;
  else if (item.status === "마감임박") score += 30;
  else if (item.status === "상시모집") score += 12;
  else if (item.status === "마감" || item.status === "모집마감") score -= 15;

  const days = safeDateDiff(item.deadline);
  if (days !== null) {
    if (days >= 0 && days <= 14) score += 10;
    else if (days < 0) score -= 20;
  }

  const isInvest = matchesAny(h, KEYWORDS.invest);
  const isRnd = matchesAny(h, KEYWORDS.rnd);
  const isHr = matchesAny(h, KEYWORDS.hr);
  const isGlobal = matchesAny(h, KEYWORDS.global);
  const isFunding = matchesAny(h, KEYWORDS.funding);
  const isIp = matchesAny(h, KEYWORDS.ip);
  const isSubsidy = matchesAny(h, KEYWORDS.subsidy);
  const isPrivacy = matchesAny(h, KEYWORDS.privacy);
  const isMarketing = matchesAny(h, KEYWORDS.marketing);

  if (isInvest) {
    score += 20;
    points.push("투자계약 / 지분구조 / 우선주·CB 조건 검토");
    riskTags.push("투자/IR");
  }
  if (isRnd || isIp) {
    score += 15;
    points.push("지식재산 귀속 / 공동연구 성과물 권리 분배 검토");
    riskTags.push("지식재산권 귀속");
  }
  if (isHr) {
    score += 10;
    points.push("근로계약 / 청년채용 의무 / 외주·용역 계약 점검");
    riskTags.push("고용·외주");
  }
  if (isGlobal) {
    score += 12;
    points.push("국제거래 / 개인정보 국외이전 / 통관 리스크 검토");
    riskTags.push("국제거래");
  }
  if (isFunding || isSubsidy) {
    score += 10;
    points.push("협약 체결 / 사업비 집행 / 정산·환수 조건 사전 점검");
    riskTags.push("협약·정산");
    if (isSubsidy) riskTags.push("환수 리스크");
  }
  if (isPrivacy) {
    score += 8;
    points.push("개인정보 동의·보관·제3자 제공 / 데이터 처리 위탁 검토");
    riskTags.push("개인정보·데이터");
  }
  if (isMarketing) {
    score += 5;
    points.push("\"100%·무료·보장\" 표현의 객관적 근거 / 소비자 오인 가능성 검토");
    riskTags.push("표시광고");
  }

  // 항상 포함되는 기본 리스크 태그
  if (!riskTags.includes("중복 수혜")) riskTags.push("중복 수혜");

  // level
  let level: InsightLevel = "보통";
  if (score >= 70) level = "높음";
  else if (score < 35) level = "낮음";

  // 한 줄 요약: truncation 안전 + 카테고리 기반
  const summary = buildSummary(item, kind);

  // reason — 구체화
  const reasonChunks: string[] = [];
  if (item.status === "마감임박") reasonChunks.push("접수 마감이 임박");
  else if (item.status === "모집중") reasonChunks.push("현재 모집 진행 중");
  else if (item.status === "상시모집") reasonChunks.push("상시 접수 공고");
  if (isInvest) reasonChunks.push("투자·IR 카테고리");
  if (isRnd) reasonChunks.push("R&D·기술개발 성격");
  if (isFunding) reasonChunks.push("사업화 자금 성격");
  if (isSubsidy) reasonChunks.push("보조금·정산 의무");
  const reason = reasonChunks.length
    ? reasonChunks.join(" · ") +
      " — 협약 체결 전 사업비·성과물·고용·개인정보 관점에서 사전 검토하면 도움이 됩니다."
    : "기본 큐레이션 항목 — 일정과 신청 자격을 먼저 확인해 보세요.";

  // fitFor — 구체화
  const fitChunks: string[] = [];
  if (item.target && !isTruncatedSentence(item.target) && item.target !== "확인 필요") {
    fitChunks.push(item.target);
  }
  if (kind === "R&D") fitChunks.push("R&D 수행 예정 스타트업");
  if (kind === "투자·IR") fitChunks.push("초기 투자 유치 준비 팀");
  if (kind === "사업화·창업패키지") fitChunks.push("MVP·시장진입 단계 팀");
  if (kind === "보조금·정산" || isSubsidy) fitChunks.push("정부지원금 정산 경험이 적은 초기 기업");
  if (kind === "교육") fitChunks.push("AI/실무 역량 강화가 필요한 팀");
  if (kind === "멘토링·컨설팅") fitChunks.push("외부 전문가 조언이 필요한 팀");
  if (isPrivacy) fitChunks.push("AI/데이터 서비스를 운영하는 팀");

  const fitFor = fitChunks.length
    ? Array.from(new Set(fitChunks)).slice(0, 3).join(" / ")
    : "창업 준비 / 초기 단계 팀";

  if (points.length === 0) {
    points.push("협약서·신청 자격·지급 조건을 사전에 확인해 두세요.");
  }

  // Phase 10.13 — 신청자 관점 핵심: 카테고리별 실제 준비사항
  const applicantPerspective = buildApplicantPerspective(kind, item);

  return {
    summary,
    level,
    reason,
    fitFor,
    legalReviewPoints: points.slice(0, 4),
    riskTags: Array.from(new Set(riskTags)).slice(0, 6),
    kind,
    recommendedAttachments: buildRecommendedAttachments(kind),
    evidenceSnippet: pickEvidenceSnippet(item),
    score: Math.max(0, Math.min(100, score)),
    applicantPerspective,
  };
}

/** Phase 10.13 — 카테고리별 신청 기업이 실제 준비/확인해야 할 항목. */
function buildApplicantPerspective(kind: ProgramKind, item: SupportItem): string[] {
  const base = [
    "신청 자격 / 업종·연차·매출 결격사유 확인",
    "협약 체결 시 사업비 사용 목적·정산 요건 사전 점검",
  ];
  switch (kind) {
    case "R&D":
      return [
        ...base,
        "공동연구·외주 인력의 성과물/IP 귀속 사전 합의",
        "기술자료 제공·반환 조건 협의",
        "데이터·개인정보 활용 시 동의·보관 정책 준비",
      ];
    case "투자·IR":
      return [
        ...base,
        "투자 조건 (우선주·전환권·동의권) 검토",
        "주주간계약·정관과 충돌 여부 확인",
      ];
    case "정책자금·바우처":
    case "보조금·정산":
      return [
        ...base,
        "사업비 사용 항목·증빙 자료 사전 준비",
        "중복 수혜 / 동일 비목 타 지원사업 병행 가능 여부 확인",
        "환수 조건 (목적 외 사용 · 미이행) 사전 인지",
      ];
    case "사업화·창업패키지":
      return [
        ...base,
        "외주·용역 사용 시 도급 단가·증빙 요건 확인",
        "성과물 공시·홍보 시 표시광고 리스크 점검",
        "참여 인력 고용 형태·청년채용 의무 확인",
      ];
    case "멘토링·컨설팅":
    case "교육":
      return [
        ...base,
        "교육·멘토링 결과물의 활용 범위 확인",
        "참여자 개인정보 수집·동의 절차 준비",
      ];
    case "행사·네트워킹":
      return [
        ...base,
        "참가자 개인정보 수집·이용 동의서 준비",
        "행사 운영 비용 정산 가능 항목 확인",
      ];
    default:
      return [
        ...base,
        "협약/계약 조항 중 환수·해지·위약 조항 검토",
        item.target && item.target !== "확인 필요"
          ? `지원 대상 적합성 (${item.target}) 자체 확인`
          : "지원 대상 적합성 자체 확인",
      ];
  }
}
