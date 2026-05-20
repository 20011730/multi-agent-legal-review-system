/**
 * startupSupportInsight.ts — 지원사업 카드의 AI 요약/추천 deterministic util (Phase 9.6).
 *
 * 향후 실제 AI 모델로 교체 가능. 현재는 rule 기반.
 * 호출 시그니처: `buildStartupSupportInsight(item, userContext?)`
 */
import type { SupportItem } from "./mockStartupSupport";

export type InsightLevel = "높음" | "보통" | "낮음";

export interface StartupSupportInsight {
  summary: string;          // 한 줄 요약
  level: InsightLevel;      // 추천도
  reason: string;           // 왜 추천하는지
  fitFor: string;           // 어떤 사용자에게 적합한지
  legalReviewPoints: string[]; // 법률 검토 연결 포인트 (0~3개)
  score: number;            // 내부 점수 (0~100), 카드 표시는 level 만
}

interface UserContext {
  industry?: string;
  stage?: "예비" | "초기" | "성장" | "확장";
}

const KEYWORDS = {
  invest: ["투자", "ir", "tips", "팁스", "데모데이", "피칭", "투자유치"],
  rnd: ["r&d", "rnd", "연구개발", "기술개발", "특허기술"],
  hr: ["고용", "인력", "청년", "채용", "근로", "노무"],
  global: ["해외", "수출", "글로벌", "global", "export"],
  funding: ["사업화", "바우처", "패키지", "지원금", "정책자금"],
  ip: ["지식재산", "ip", "특허"],
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
  // YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD
  const m = deadline.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * deterministic 추천 / 요약 / 법률 검토 포인트 계산.
 * @param userContext (선택) 사용자 상황 — 현재는 사용 안 함, 향후 확장용 시그니처만 유지.
 */
export function buildStartupSupportInsight(
  item: SupportItem,
  _userContext?: UserContext,
): StartupSupportInsight {
  const h = hay(item);
  const points: string[] = [];

  let score = 40; // base
  if (item.status === "모집중") score += 20;
  else if (item.status === "마감임박") score += 30;
  else if (item.status === "상시모집") score += 12;
  else if (item.status === "마감") score -= 15;

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

  if (isInvest) {
    score += 20;
    points.push("투자계약 / 지분구조 / 우선주·CB 조건 검토 필요");
  }
  if (isRnd || isIp) {
    score += 15;
    points.push("지식재산 귀속 / 공동연구 성과물 권리 분배 검토");
  }
  if (isHr) {
    score += 10;
    points.push("근로계약 / 청년채용 의무 / 임금 조건 노무 리스크 점검");
  }
  if (isGlobal) {
    score += 12;
    points.push("국제거래 계약 / 개인정보 국외이전 / 통관 리스크 검토");
  }
  if (isFunding) {
    score += 10;
    points.push("정부지원금 집행 / 협약서 / 정산·환수 조건 사전 점검");
  }

  // level 결정 (Phase 9.7 — 너무 많이 "낮음" 되지 않도록 threshold 완화)
  let level: InsightLevel = "보통";
  if (score >= 70) level = "높음";
  else if (score < 35) level = "낮음";

  // summary 라이트하게
  let summary = item.fieldSummary || item.title;
  if (summary.length > 80) summary = summary.slice(0, 80) + "...";

  // reason
  const reasonChunks: string[] = [];
  if (isInvest) reasonChunks.push("투자/IR 관련");
  if (isRnd) reasonChunks.push("R&D·기술개발 카테고리");
  if (isFunding) reasonChunks.push("사업화 자금/바우처 성격");
  if (item.status === "마감임박") reasonChunks.push("마감 임박");
  else if (item.status === "모집중") reasonChunks.push("현재 모집중");
  const reason = reasonChunks.length
    ? reasonChunks.join(" · ") + " — 빠르게 검토하면 도움이 됩니다."
    : "기본 큐레이션 항목 — 일정과 신청 자격을 확인해 보세요.";

  // fitFor
  const fitChunks: string[] = [];
  if (item.target) fitChunks.push(item.target);
  if (isInvest) fitChunks.push("초기 투자 유치를 준비 중인 팀");
  if (isRnd) fitChunks.push("기술 기반·연구개발 중심 팀");
  if (isFunding) fitChunks.push("MVP·시장진입 단계");
  const fitFor = fitChunks.length ? Array.from(new Set(fitChunks)).join(" / ") : "창업 준비/초기 단계 팀";

  if (points.length === 0) {
    points.push("협약서·신청 자격·지급 조건을 사전에 확인해 두세요.");
  }

  return {
    summary,
    level,
    reason,
    fitFor,
    legalReviewPoints: points.slice(0, 3),
    score: Math.max(0, Math.min(100, score)),
  };
}
