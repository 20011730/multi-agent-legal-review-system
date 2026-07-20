import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { connectSessionStream, type StreamController, type StreamDebateMessage } from "../lib/sessionStream";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FileCheck,
  Gavel,
  Loader2,
  Scale,
  Shield,
  Zap,
  AlertCircle,
  MessageSquare,
} from "lucide-react";

/* ── 타입 ── */
interface Message {
  agentId: string;
  agentName?: string;
  content: string;
  type: string;
  round: number;
  stance?: string;
  evidenceSummary?: string;
}

type FollowUpStatus = "pending" | "in-progress" | "completed" | "reflected" | "partial" | "failed" | "deleted";

interface FollowUpQuestion {
  id?: string | number;
  targetAgent?: string;
  message: string;
  createdAt?: string;
  updatedAt?: string;
  reanalyzeStatus?: FollowUpStatus;
  appliedRound?: number | string;
  sourceRound?: number | string;
  afterRound?: number | string;
  round?: number | string;
  roundNumber?: number | string;
  nextRound?: number | string;
  sequence?: number | string;
  questionOrder?: number | string;
  sender?: string;
}

type WaitingStage = "round2" | "round3" | "round4" | "round5";
type InterventionMode = WaitingStage | "completed";

const ROUND_TITLES: Record<number, string> = {
  1: "사안 접수 및 초기 쟁점 식별",
  2: "사실관계 및 증빙자료 보완",
  3: "법령·판례 근거 검토",
  4: "반론 검증 및 리스크 시나리오 분석",
  5: "종합 의견 및 실행 체크리스트",
};

const WAITING_STATUS_TO_STAGE: Record<string, WaitingStage> = {
  WAITING_FOR_USER_INPUT: "round2",
  WAITING_FOR_ROUND2_INPUT: "round2",
  WAITING_FOR_FINAL_INPUT: "round3",
  WAITING_FOR_ROUND3_INPUT: "round3",
  WAITING_FOR_ROUND4_INPUT: "round4",
  WAITING_FOR_ROUND5_INPUT: "round5",
};

function roundTitle(round: number): string {
  return ROUND_TITLES[round] || `Round ${round} 검토`;
}

function stageTargetRound(stage: WaitingStage): number {
  return Number(stage.replace("round", ""));
}

function waitingStatusLabel(stage: WaitingStage): string {
  const completedRound = stageTargetRound(stage) - 1;
  return `Round ${completedRound} ${roundTitle(completedRound)}가 끝났습니다.`;
}

function waitingStatusDescription(stage: WaitingStage): string {
  if (stage === "round5") {
    return "종합 의견 및 실행 체크리스트 전에 마지막으로 확인할 질문이나 조건이 있나요? 질문이 없다면 바로 종합 라운드를 진행할 수 있습니다.";
  }
  return `Round ${stageTargetRound(stage)} ${roundTitle(stageTargetRound(stage))}에 반영할 질문이나 추가 조건을 입력하세요. 질문이 없다면 바로 다음 라운드를 진행할 수 있습니다.`;
}

function waitingProgress(stage: WaitingStage): number {
  return ({ round2: 35, round3: 55, round4: 70, round5: 82 } as Record<WaitingStage, number>)[stage];
}

/* ── 에이전트 맵 (judge 추가, ethics 호환) ── */
type AgentKey = "business" | "legal" | "risk" | "ethics" | "judge";

const agentMap: Record<
  AgentKey,
  { name: string; icon: typeof Scale; color: string; bg: string; border: string }
> = {
  business: {
    name: "비즈니스 전략가",
    icon: Shield,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  legal: {
    name: "법률 전문가",
    icon: Scale,
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  risk: {
    name: "리스크 검토자",
    icon: Shield,
    color: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
  },
  ethics: {
    // Phase 10.41 — provisional 카드에서 "최종 판정관" 중복 표시되던 문제 해결.
    // ethics 는 리스크/윤리 관점이므로 "리스크 검토자"로 분리.
    name: "리스크 검토자",
    icon: Shield,
    color: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
  },
  judge: {
    name: "최종 판정관",
    icon: Gavel,
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
  },
};

/* ── 대시보드 펄스에 표시할 3가지 에이전트 (UI용) ── */
const dashboardAgents: AgentKey[] = ["business", "legal", "risk"];

/* ── 실제 분석 단계 → progress / 활성 에이전트 ── */
interface PhaseInfo {
  label: string;
  description: string;
  progress: number;
  activeAgent?: AgentKey;
  humourLabel: string;
}

const phaseMap: Record<string, PhaseInfo> = {
  ROUND1_BIZ: {
    label: "Round 1 — 사안 접수 및 초기 쟁점 식별",
    description: "사업 상황을 이해하고 초기 쟁점과 확인할 자료를 정리하고 있습니다.",
    progress: 15,
    activeAgent: "business",
    humourLabel: "AI 에이전트가 공고와 입력 자료를 검토하고 있습니다.",
  },
  ROUND1_LEGAL: {
    label: "Round 1 — 사안 접수 및 초기 쟁점 식별",
    description: "핵심 법률 쟁점과 초기 위험 신호를 확인하고 있습니다.",
    progress: 30,
    activeAgent: "legal",
    humourLabel: "AI 에이전트가 공고와 입력 자료를 검토하고 있습니다.",
  },
  ROUND1_RISK: {
    label: "Round 1 — 사안 접수 및 초기 쟁점 식별",
    description: "누락된 사실관계와 먼저 확인할 자료를 정리하고 있습니다.",
    progress: 34,
    activeAgent: "risk",
    humourLabel: "AI 에이전트가 공고와 입력 자료를 검토하고 있습니다.",
  },
  ROUND2_BIZ: {
    label: "Round 2 — 사실관계 및 증빙자료 보완",
    description: "사용자 질문과 첨부자료를 반영해 사실관계를 보완하고 있습니다.",
    progress: 40,
    activeAgent: "business",
    humourLabel: "에이전트 간 쟁점이 교차 검증되고 있습니다.",
  },
  ROUND2_LEGAL: {
    label: "Round 2 — 사실관계 및 증빙자료 보완",
    description: "보완된 자료의 법률상 의미를 검토하고 있습니다.",
    progress: 55,
    activeAgent: "legal",
    humourLabel: "에이전트 간 쟁점이 교차 검증되고 있습니다.",
  },
  ROUND2_RISK: {
    label: "Round 2 — 사실관계 및 증빙자료 보완",
    description: "아직 부족한 사실관계와 추가 자료 요청 사항을 정리하고 있습니다.",
    progress: 62,
    activeAgent: "risk",
    humourLabel: "에이전트 간 쟁점이 교차 검증되고 있습니다.",
  },
  ROUND3_BIZ: {
    label: "Round 3 — 법령·판례 근거 검토",
    description: "검색된 근거가 사업 실행에 미치는 영향을 확인하고 있습니다.",
    progress: 68,
    activeAgent: "business",
    humourLabel: "세 번의 논쟁 끝에 합의점에 가까워졌습니다!",
  },
  ROUND3_LEGAL: {
    label: "Round 3 — 법령·판례 근거 검토",
    description: "관련 법령·판례와 첨부자료 근거를 검토하고 있습니다.",
    progress: 80,
    activeAgent: "legal",
    humourLabel: "세 번의 논쟁 끝에 합의점에 가까워졌습니다!",
  },
  ROUND3_RISK: {
    label: "Round 3 — 법령·판례 근거 검토",
    description: "근거가 부족하거나 추가 확인이 필요한 부분을 정리하고 있습니다.",
    progress: 84,
    activeAgent: "risk",
    humourLabel: "세 번의 논쟁 끝에 합의점에 가까워졌습니다!",
  },
  ROUND4_BIZ: {
    label: "Round 4 — 반론 검증 및 리스크 시나리오 분석",
    description: "낙관적 실행 시나리오와 보수적 반론을 비교하고 있습니다.",
    progress: 72,
    activeAgent: "business",
    humourLabel: "에이전트들이 서로의 빈틈을 점검하고 있습니다.",
  },
  ROUND4_LEGAL: {
    label: "Round 4 — 반론 검증 및 리스크 시나리오 분석",
    description: "문제가 될 수 있는 반론과 보수적 법률 해석을 검토하고 있습니다.",
    progress: 76,
    activeAgent: "legal",
    humourLabel: "에이전트들이 서로의 빈틈을 점검하고 있습니다.",
  },
  ROUND4_RISK: {
    label: "Round 4 — 반론 검증 및 리스크 시나리오 분석",
    description: "최악의 상황과 대응 가능성, 우선순위를 분석하고 있습니다.",
    progress: 80,
    activeAgent: "risk",
    humourLabel: "에이전트들이 서로의 빈틈을 점검하고 있습니다.",
  },
  ROUND5_BIZ: {
    label: "Round 5 — 종합 의견 및 실행 체크리스트",
    description: "사업 관점의 실행 가능 조건과 체크리스트를 정리하고 있습니다.",
    progress: 86,
    activeAgent: "business",
    humourLabel: "최종 리포트를 만들기 전 마지막 정리 단계입니다.",
  },
  ROUND5_LEGAL: {
    label: "Round 5 — 종합 의견 및 실행 체크리스트",
    description: "최종 법률 조건과 확인할 문서·조항을 정리하고 있습니다.",
    progress: 90,
    activeAgent: "legal",
    humourLabel: "최종 리포트를 만들기 전 마지막 정리 단계입니다.",
  },
  ROUND5_RISK: {
    label: "Round 5 — 종합 의견 및 실행 체크리스트",
    description: "남은 리스크와 즉시 실행할 우선순위를 정리하고 있습니다.",
    progress: 94,
    activeAgent: "risk",
    humourLabel: "최종 리포트를 만들기 전 마지막 정리 단계입니다.",
  },
  JUDGING: {
    label: "최종 판정 생성 중",
    description: "5개 라운드와 사용자 의견을 종합하여 최종 리포트를 작성하고 있습니다.",
    progress: 97,
    activeAgent: "judge",
    humourLabel: "세 명의 전문가를 설득하는 데 성공했습니다!",
  },
  COLLECTING_EVIDENCE: {
    label: "법령·판례 근거 수집 중",
    description: "공공 법령·판례 데이터에서 관련 근거를 검색하고 있습니다.",
    progress: 95,
    humourLabel: "세 명의 전문가를 설득하는 데 성공했습니다!",
  },
};

const defaultPhase: PhaseInfo = {
  label: "검토 준비 중",
  description: "입력 정보, 공고 정보, 첨부자료를 함께 정리하고 있습니다.",
  progress: 10,
  humourLabel: "AI 검토팀이 자료를 검토할 준비를 하고 있습니다.",
};

/* ── 실시간 중계 텍스트 (flavor) ── */
const liveTicker = [
  { speaker: "business" as AgentKey, text: "에이전트들이 회의실에 입장하여 서류를 검토하기 시작합니다.",     conflict: false },
  { speaker: "business" as AgentKey, text: "비즈니스 전략가가 법무 에이전트의 보수적 태도에 깊은 한숨을 내쉽니다.", conflict: true },
  { speaker: "risk" as AgentKey,     text: "리스크 검토자가 정산과 운영 지연 가능성을 근거로 제동을 겁니다.", conflict: true },
  { speaker: "legal" as AgentKey,  text: "법무 에이전트가 판례집을 뒤적거리며 커피를 리필합니다.",              conflict: false },
  { speaker: "business" as AgentKey, text: "비즈니스 전략가가 숫자를 들이밀며 실행 가능성 반박 자료를 제출합니다.", conflict: true },
  { speaker: "judge" as AgentKey,    text: "최종 판정관이 세 에이전트 의견을 취합해 결론 문안을 정리 중입니다.", conflict: false },
];

const POLL_INTERVAL = 3000;

/**
 * Phase 10.33 — targetAgent 내부 코드 → 사용자 친화 한국어 라벨 매핑.
 * 사용자 화면(말풍선, 헤더, /verdict)에서 judge/ethics/system 같은 내부명이 노출되지 않도록.
 */
export function targetAgentLabel(v?: string | null): string {
  if (!v) return "전체 에이전트";
  const k = v.toLowerCase().trim();
  switch (k) {
    case "all": return "전체 에이전트";
    case "business": return "비즈니스 전략가";
    case "risk": return "리스크 검토자";
    case "legal": return "법률 전문가";
    case "ethics": return "리스크 검토자";
    case "judge": return "최종 판정관";
    case "system": return "시스템 안내";
    default: return v;
  }
}

function resolveAgentKey(agentId?: string, agentName?: string, type?: string): AgentKey {
  if ((agentId === "judge" || agentId === "ethics") && type === "recommendation") return "judge";
  if (agentId === "business") return "business";
  if (agentId === "risk" && /비즈니스|사업/.test(agentName || "")) return "business";
  if (agentId === "risk") return "risk";
  if (agentId === "legal") return "legal";
  if (agentId === "judge" || agentId === "ethics") return "judge";
  return "legal";
}

/* ── JUDGE 메시지 렌더링 (JSON → 사람이 읽는 형식) ── */
function renderJudgeContent(content: string) {
  // 이미 마크다운 형식이면 그대로 렌더링
  if (content.includes("## ")) {
    return (
      <div className="space-y-1">
        {content.split("\n").map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("## ")) {
            return <h4 key={i} className="font-semibold text-violet-800 mt-2 mb-1 text-sm">{trimmed.replace(/^##\s*/, "")}</h4>;
          }
          if (trimmed === "") return <div key={i} className="h-1" />;
          return <p key={i} className="text-sm text-slate-700 leading-relaxed">{line}</p>;
        })}
      </div>
    );
  }
  // JSON 문자열 파싱 시도 (이전 세션 호환)
  try {
    let json = content.trim();
    if (json.includes("```json")) {
      json = json.substring(json.indexOf("```json") + 7, json.indexOf("```", json.indexOf("```json") + 7)).trim();
    }
    if (json.startsWith("{")) {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const recommendation = typeof parsed.recommendation === "string" ? parsed.recommendation : "";
      const revisedContent = typeof parsed.revisedContent === "string" ? parsed.revisedContent : "";
      return (
        <div className="space-y-2 text-sm text-slate-700">
          {summary && <p className="leading-relaxed">📋 {summary}</p>}
          {recommendation && <p className="leading-relaxed mt-1">💡 {recommendation}</p>}
          {revisedContent && (
            <div className="mt-2 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="text-xs font-semibold text-violet-700 mb-1">수정 문안 제안</p>
              <p className="text-violet-800">{revisedContent}</p>
            </div>
          )}
        </div>
      );
    }
  } catch { /* fallback below */ }
  // 일반 텍스트 렌더링
  return <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{content}</p>;
}

/* ── 일반 에이전트 메시지 렌더링 (## 헤더 지원) ── */
/** Phase 10.7 — raw HTTP/네트워크 오류가 메시지 본문에 들어왔을 때 사용자 친화 문구로 치환. */
function sanitizeAgentContent(content: string): string {
  if (!content) return content;
  const errorPatterns = [
    /Ollama\s+HTTP\s+\d+[^\n]*/gi,
    /HTTP\s+(4\d\d|5\d\d)[^\n]*/g,
    /Connection\s+refused[^\n]*/gi,
    /Connect(?:ion)?\s+timed?\s*out[^\n]*/gi,
    /설정\/요청\s*오류[^\n]*/g,
    /SocketTimeoutException[^\n]*/g,
    /ResourceAccessException[^\n]*/g,
    /RuntimeException[^\n]*/g,
    /stack trace[^\n]*/gi,
    /raw exception[^\n]*/gi,
    /catastrophic[^\n]*/gi,
    /fallback[^\n]*/gi,
    /API payload[^\n]*/gi,
    /CASE_SEARCH_MODE[^\n]*/g,
    /dataSource[^\n]*/g,
    /vector[^\n]*/gi,
    /similarity[^\n]*/gi,
    /distance[^\n]*/gi,
    /\bscore\s*[:=]?\s*[0-9.]+/gi,
  ];
  let sanitized = content;
  let replaced = false;
  for (const pat of errorPatterns) {
    if (pat.test(sanitized)) {
      sanitized = sanitized.replace(pat, "");
      replaced = true;
    }
  }
  if (replaced) {
    sanitized = "일부 AI 응답을 불러오지 못했습니다. 다시 시도하거나 관리자에게 문의해 주세요.";
  }
  sanitized = sanitized
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[A-Za-z][A-Za-z0-9 ,.;:!?/()_\-]{90,}/g, " ")
    .replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]{18,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!sanitized) {
    sanitized = "일부 AI 응답을 불러오지 못했습니다. 다시 시도하거나 관리자에게 문의해 주세요.";
  }
  return sanitized;
}

function renderAgentContent(content: string) {
  const safe = sanitizeAgentContent(content);
  return safe.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return <h4 key={i} className="font-semibold text-slate-800 mt-3 mb-1 text-sm">{trimmed.replace(/^##\s*/, "")}</h4>;
    }
    if (trimmed === "") return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm text-slate-700 leading-relaxed">{line}</p>;
  });
}

function cleanMarkdownForBubble(content: string): string {
  const safe = sanitizeAgentContent(content || "");
  return safe
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\|.*\|$/.test(trimmed)) return false;
      if (/^[-:| ]{3,}$/.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[(?:라운드|Round)\s*\d+[^\]]*\]/gi, "")
    .replace(/\bCSO\s*입장\s*:\s*/gi, "")
    .replace(/최종\s*입장\s*정리/gi, "")
    .replace(/실제\s*수정\s*표현\s*제시\s*\+?\s*합의\s*정리/gi, "")
    .replace(/\bVerdict\s*:\s*\w+/gi, "")
    .replace(/\b(MEDIUM|HIGH|LOW)\b/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bubblePreview(content: string, isJudge = false): { preview: string; detail: string; collapsed: boolean } {
  const cleaned = cleanMarkdownForBubble(content);
  if (!cleaned) {
    return {
      preview: "일부 AI 응답을 불러오지 못했습니다. 다시 시도하거나 관리자에게 문의해 주세요.",
      detail: "",
      collapsed: false,
    };
  }
  const sentenceParts = cleaned
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？다요니다까])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const maxChars = isJudge ? 320 : 420;
  const seed = sentenceParts.slice(0, isJudge ? 3 : 5).join(" ") || cleaned;
  const preview = seed.length > maxChars ? seed.slice(0, maxChars).trim() + "..." : seed;
  const collapsed = cleaned.length > preview.length + 20;
  return { preview, detail: cleaned, collapsed };
}

function BubbleContent({ content, isJudge = false }: { content: string; isJudge?: boolean }) {
  const { preview, detail, collapsed } = bubblePreview(content, isJudge);
  return (
    <div className="text-sm leading-relaxed text-slate-800">
      <p className="whitespace-pre-wrap break-keep">{preview}</p>
      {collapsed && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-[#1E3A8A] hover:underline">
            자세히 보기
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-keep text-[12.5px] leading-relaxed text-slate-600">
            {detail}
          </p>
        </details>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   Result 컴포넌트
══════════════════════════════════════════ */
export function Result() {
  const navigate = useNavigate();

  const [messages, setMessages]               = useState<Message[]>([]);
  const [isComplete, setIsComplete]           = useState(false);
  const [isWaitingForUserInput, setIsWaitingForUserInput] = useState(false);
  const [waitingStage, setWaitingStage] = useState<WaitingStage | null>(null);
  const [showDetailedLogs, setShowDetailedLogs] = useState(true);
  const [error, setError]                     = useState("");
  const [recheckRequest, setRecheckRequest]   = useState<{ target: string; question: string } | null>(null);
  const [tickerIndex, setTickerIndex]         = useState(0);
  const [currentPhase, setCurrentPhase]       = useState<PhaseInfo>(defaultPhase);
  const [isAnalyzing, setIsAnalyzing]         = useState(true);
  const [elapsedSeconds, setElapsedSeconds]   = useState(0);
  // Phase 10.4 — 백엔드 응답에 포함된 지원사업 컨텍스트 (없으면 null, 일반 진단은 영향 없음)
  const [startupContext, setStartupContext]   = useState<{
    title?: string;
    organization?: string;
    deadline?: string;
    category?: string;
    source?: string;
    applyUrl?: string;
  } | null>(null);
  // Phase 10.11/10.38 — 사용자 추가 질문 누적. reanalyzeStatus 로 반영 상태 추적.
  const [userFollowUps, setUserFollowUps] = useState<FollowUpQuestion[]>([]);

  // Phase 10.20 — 재분석 완료 후 1회성 안내 배너 ("이번 재검토에는 사용자 추가 질문 N건이 반영되었습니다")
  const [reanalyzeBadge, setReanalyzeBadge] = useState<{ count: number; at: string } | null>(null);
  const wasReanalyzingRef = useRef(false);
  const continuationModeRef = useRef<InterventionMode | "reanalysis" | null>(null);

  // Phase 10.21 — staged reveal. messages 가 한꺼번에 도착해도 화면엔 1개씩 ~350ms 간격으로 등장.
  const [visibleCount, setVisibleCount] = useState(0);
  // Phase 10.23/10.24 — SSE 연결 상태. 5단계 — connecting / open / error(자동복구중) / fallback(polling) / closed(완료).
  const [streamStatus, setStreamStatus] = useState<
    "connecting" | "open" | "error" | "fallback" | "closed"
  >("connecting");
  const streamRef = useRef<StreamController | null>(null);
  // SSE 메시지 중복 제거용 — id 또는 (round + agentId + content 64자) 키 set
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  // Phase 10.21 — 사용자가 위로 스크롤한 상태에서 새 메시지 도착 시 "새 메시지 N개" 버튼으로 알림.
  const [unseenCount, setUnseenCount] = useState(0);
  const userNearBottomRef = useRef(true);

  const pollRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchedCountRef   = useRef(0);          // 마지막으로 가져온 메시지 수
  const isCompleteRef     = useRef(false);
  // Phase 10.14 — 새 메시지 도착 시 사용자가 하단 근처에 있을 때만 자동 스크롤
  const messagesEndRef    = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);

  /* ── 정리 ── */
  // Phase 10.14/10.21 — 새 메시지 등장 시 사용자가 하단 근처일 때만 자동 스크롤.
  // 위로 스크롤해 읽고 있으면 강제 이동 대신 unseenCount 만 증가시킴 (플로팅 버튼으로 안내).
  useEffect(() => {
    if (visibleCount <= prevMessageCountRef.current) {
      prevMessageCountRef.current = visibleCount;
      return;
    }
    const newOnes = visibleCount - prevMessageCountRef.current;
    prevMessageCountRef.current = visibleCount;
    const el = messagesEndRef.current;
    const distanceFromBottom = window.innerHeight + window.scrollY - document.body.offsetHeight;
    const nearBottom = Math.abs(distanceFromBottom) < 400;
    userNearBottomRef.current = nearBottom;
    if (nearBottom && el) {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
      setUnseenCount(0);
    } else {
      setUnseenCount((prev) => prev + newOnes);
    }
  }, [visibleCount]);

  // Phase 10.21/10.22/10.51/10.73 — staged reveal:
  //   - 백엔드 (Phase 10.73) 가 agent 메시지 사이 ~700ms 간격으로 SSE push → 클라이언트는 즉시 표시.
  //   - 페이지 재진입 / reload / 백로그 burst: 짧은 interval 로 따라잡음.
  //   - 완료(isComplete) 상태: 즉시 전체 표시.
  useEffect(() => {
    if (visibleCount >= messages.length) return;
    if (isCompleteRef.current) {
      setVisibleCount(messages.length);
      return;
    }
    const backlog = messages.length - visibleCount;
    // backlog=1 (백엔드가 보낸 단일 신규 메시지) → 거의 즉시 표시 (50ms — 페이드 인 트리거용).
    // backlog 큰 burst 는 기존 80~280ms.
    const interval = backlog === 1 ? 50 : backlog >= 5 ? 80 : backlog >= 3 ? 160 : 220;
    const timer = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + 1, messages.length));
    }, interval);
    return () => clearTimeout(timer);
  }, [visibleCount, messages.length, isComplete]);

  // Phase 10.21 — 사용자 스크롤 위치 추적 (debounce 없이 가벼움)
  useEffect(() => {
    const onScroll = () => {
      const dist = window.innerHeight + window.scrollY - document.body.offsetHeight;
      const near = Math.abs(dist) < 400;
      userNearBottomRef.current = near;
      if (near && unseenCount > 0) setUnseenCount(0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [unseenCount]);

  // Phase 10.21 — 재분석 시작 시 visibleCount 0으로 초기화 → 새 메시지가 다시 staged reveal
  useEffect(() => {
    if (messages.length === 0) {
      setVisibleCount(0);
      prevMessageCountRef.current = 0;
    } else if (visibleCount > messages.length) {
      // 메시지가 줄어든 경우 (reanalyze cleanup) — 보이는 카운트도 동기화
      setVisibleCount(messages.length);
      prevMessageCountRef.current = messages.length;
    }
    // 의도적으로 visibleCount 의존성에서 제외 — 위 staged-reveal 이펙트와 충돌 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const jumpToBottom = useCallback(() => {
    const el = messagesEndRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "end" });
    setUnseenCount(0);
  }, []);

  const cleanup = useCallback(() => {
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  /* ── debates/latest 호출 (부분 결과 포함) ── */
  const fetchDebateResult = useCallback(async (sessionId: string, isFinal = false) => {
    try {
      const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/debates/latest`);
      if (!res.ok) return;
      const result = await res.json();

      const mapped: Message[] = (result.messages || []).map((m: {
        agentId?: string; agentName?: string; content?: string;
        type?: string; round?: number; stance?: string; evidenceSummary?: string;
      }) => ({
        agentId:         m.agentId || "legal",
        agentName:       m.agentName || "",
        content:         m.content || "",
        type:            m.type || "analysis",
        round:           m.round || 1,
        stance:          m.stance || "",
        evidenceSummary: m.evidenceSummary || "",
      }));

      // 새 메시지만 누적 + Phase 10.23 dedup 키 reseed (SSE 와 충돌 방지)
      if (mapped.length > fetchedCountRef.current) {
        fetchedCountRef.current = mapped.length;
        setMessages(mapped);
        // 폴링이 덮어쓴 messages 와 SSE seenKeys 를 동기화 — 다음 SSE message 가 중복 추가되지 않도록.
        const reseed = new Set<string>();
        mapped.forEach((m, i) => {
          const c = (m.content || "").slice(0, 64);
          // id 미상 → fallback 키 사용 (SSE appendIfNew 와 동일 형식)
          reseed.add(`r:${m.round ?? 0}|a:${m.agentId ?? ""}|t:${m.type ?? ""}|c:${c}`);
          // 동시에 SSE 가 id 기준 키를 사용하면 그 키도 등록 (백엔드가 id 를 messages payload 에 넣지 않으므로 best-effort).
          // 백엔드 /debates/latest 는 id 미포함 → SSE 만 id 기준 dedup. 두 경로의 키가 다를 수 있음에 유의.
          void i;
        });
        seenMessageKeysRef.current = reseed;
      }

      if (result.finalDecision) {
        sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
      } else if (
        WAITING_STATUS_TO_STAGE[result.status]
      ) {
        sessionStorage.removeItem("finalDecision");
      }
      sessionStorage.setItem("evidences", JSON.stringify(result.evidences || []));
      if (Array.isArray(result.attachments) && result.attachments.length > 0) {
        try {
          const raw = sessionStorage.getItem("reviewData");
          const current = raw ? JSON.parse(raw) : {};
          sessionStorage.setItem("reviewData", JSON.stringify({ ...current, attachments: result.attachments }));
        } catch { /* ignore */ }
      }

      // Phase 10.4 — 지원사업 컨텍스트 표시 (백엔드 응답 우선, 없으면 reviewData fallback)
      if (result.startupContext) {
        setStartupContext(result.startupContext);
        try {
          sessionStorage.setItem("lexrex.startupContext", JSON.stringify(result.startupContext));
        } catch { /* ignore */ }
      }

      // Phase 10.44 — followUp 의 reanalyzeStatus 를 backend 응답에서 hydrate.
      // backend 가 source of truth — sessionStorage 는 빠른 first-paint fallback 용도로만 유지.
      if (Array.isArray(result.followUpQuestions)) {
        const fromBackend = (result.followUpQuestions as FollowUpQuestion[])
          .filter((q) => q?.targetAgent !== "system" && q?.message)
          .map((q) => ({
            id: q.id,
            targetAgent: q.targetAgent,
            message: q.message as string,
            createdAt: q.createdAt,
            updatedAt: q.updatedAt,
            reanalyzeStatus: (q.reanalyzeStatus as FollowUpStatus | undefined) ?? "pending",
            appliedRound: q.appliedRound,
            sourceRound: q.sourceRound,
            afterRound: q.afterRound,
            round: q.round,
            roundNumber: q.roundNumber,
            nextRound: q.nextRound,
            sequence: q.sequence,
            questionOrder: q.questionOrder,
            sender: q.sender,
          }));
        if (fromBackend.length > 0) {
          setUserFollowUps(fromBackend);
          try { sessionStorage.setItem("userFollowUps", JSON.stringify(fromBackend)); } catch { /* */ }
        }
      }

      if (isFinal) {
        // Phase 10.50 — 안내성 system error 1건만으로 전체 실패처럼 보이지 않게 정리.
        //   기준: 핵심 agent(risk/legal/business/judge) 의 healthy 메시지 ≥ 4 이면 정상 완료로 간주.
        const errPat = /분석 중 오류 발생|Ollama HTTP|판정 생성 실패|설정\/요청 오류/;
        const healthyCore = mapped.filter((m) => {
          const aid = m.agentId || "";
          if (!(aid === "risk" || aid === "business" || aid === "legal" || aid === "judge")) return false;
          if (m.type === "error") return false;
          return !errPat.test(m.content || "");
        }).length;
        const trueFailure = !result.finalDecision && healthyCore < 4 && mapped.some((m) => m.type === "error" || errPat.test(m.content || ""));
        if (trueFailure) setError("일부 AI 응답이 지연되어 기존 검토 결과를 기준으로 이어서 표시합니다. 잠시 후 다시 시도하거나 기존 결과로 최종 리포트를 확인할 수 있습니다.");
        else setError("");
        setIsComplete(true);
        isCompleteRef.current = true;
        setCurrentPhase({ label: "검토 완료", description: "AI 검토팀의 논의가 완료되어 최종 리포트가 준비되었습니다.", progress: 100, humourLabel: "최종 리포트를 확인할 준비가 되었습니다." });
        setIsAnalyzing(false);
      }
    } catch (e) {
      if (isFinal) {
        console.error(e);
        setError("토론 결과를 불러오는 중 문제가 발생했습니다.");
        setIsAnalyzing(false);
      }
    }
  }, []);

  /* ── 상태 폴링 ── */
  const pollSessionStatus = useCallback((sessionId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/status`);
        if (!res.ok) return;
        const status = await res.json();

        // Phase 10.10/10.19 — 실제 단계 반영 + 단계 정보 없을 때 messageCount 기반 fallback.
        // 단계별 라벨이 5%/12% 에 멈춘 것처럼 보이지 않도록 구체적 메시지 매핑.
        if (status.analysisPhase && phaseMap[status.analysisPhase]) {
          setCurrentPhase(phaseMap[status.analysisPhase]);
        } else if (WAITING_STATUS_TO_STAGE[status.status]) {
          cleanup();
          const nextWaitingStage = WAITING_STATUS_TO_STAGE[status.status];
          isCompleteRef.current = false;
          setIsComplete(false);
          setIsAnalyzing(false);
          setIsWaitingForUserInput(true);
          setWaitingStage(nextWaitingStage);
          await fetchDebateResult(sessionId, false);
          setCurrentPhase({
            label: waitingStatusLabel(nextWaitingStage),
            description: waitingStatusDescription(nextWaitingStage),
            progress: waitingProgress(nextWaitingStage),
            humourLabel: "AI 검토팀이 사용자 의견을 기다리고 있습니다.",
          });
        } else if (typeof status.messageCount === "number" && status.messageCount > 0) {
          // 메시지 수별 명시적 라벨 (Phase 10.19 — 사용자가 단계를 직관적으로 인지)
          const count = status.messageCount;
          const stage = (() => {
            if (count >= 5) return { p: 88, l: "최종 판정 정리 중", d: "양측 토론을 종합하여 최종 판정문을 작성하고 있습니다." };
            if (count >= 4) return { p: 80, l: "쟁점 조율 및 반박 검토 중", d: "라운드 2 — 양측이 상대 측 지적에 대해 재반박/수용을 검토하고 있습니다." };
            if (count >= 3) return { p: 65, l: "법률 전문가 1차 검토 완료 — 비즈니스 측 반박 준비", d: "법적 위험에 대한 비즈니스 측 대응 방향을 정리 중입니다." };
            if (count >= 2) return { p: 45, l: "법률 전문가 1차 검토 중", d: "관련 법령·판례를 검색하고 법적 위험을 식별하고 있습니다." };
            return { p: 25, l: "비즈니스 전략가 1차 검토 중", d: "사업 기회·실행 리스크를 분석하고 있습니다." };
          })();
          setCurrentPhase((prev) => ({
            ...prev,
            label: `${stage.l} (${count}개 메시지 수신)`,
            description: stage.d,
            progress: Math.max(prev.progress, stage.p),
          }));
        } else if (status.status === "ANALYZING") {
          // 메시지 아직 없지만 분석 시작됨 → 단계 라벨 명시
          setCurrentPhase((prev) =>
            prev.progress < 15
              ? {
                  ...prev,
                  progress: 15,
                  // Phase 10.30 — 사용자용 친화 문구 (내부 구현 용어 제거)
                  label: "검토 준비 중",
                  description: "입력하신 내용, 공고 정보, 첨부자료, 추가 질문을 함께 정리하고 있습니다.",
                }
              : prev,
          );
        } else if (status.status === "REANALYZING") {
          const mode = continuationModeRef.current;
          const phaseLabel =
            mode === "completed" || mode === "reanalysis"
              ? "추가 재검토 진행 중"
              : mode === "round5"
                ? "종합 라운드 진행 중"
                : "다음 라운드 진행 중";
          const phaseDescription =
            mode === "completed" || mode === "reanalysis"
              ? "완료된 검토에 새 질문을 더해 추가 재검토를 진행하고 있습니다."
              : mode === "round5"
                ? "에이전트들이 앞선 토론과 추가 질문을 종합해 최종 리포트를 준비하고 있습니다."
                : "사용자 추가 질문과 조건을 포함해 다음 라운드 토론을 진행하고 있습니다.";
          setCurrentPhase((prev) => ({
            ...prev,
            label: phaseLabel,
            description: phaseDescription,
            progress: Math.max(prev.progress, 30),
          }));
          isCompleteRef.current = false;
          setIsComplete(false);
          setIsAnalyzing(true);
          setWaitingStage(null);
          wasReanalyzingRef.current = true;  // Phase 10.20 — 완료 시 배너 노출 트리거
          // Phase 10.38 — REANALYZING 전이 시 모든 pending 질문을 "in-progress" 로 표시
          setUserFollowUps((prev) =>
            prev.map((q) =>
              q.targetAgent === "system" || (q.reanalyzeStatus && q.reanalyzeStatus !== "pending" && q.reanalyzeStatus !== "failed")
                ? q
                : { ...q, reanalyzeStatus: "in-progress" as const },
            ),
          );
          // messageCount 가 0으로 떨어진 뒤 다시 증가 → ref도 낮춰서 신규 메시지 감지 가능하게
          if (status.messageCount < fetchedCountRef.current) {
            fetchedCountRef.current = status.messageCount;
          }
        }

        // 새 메시지가 생겼으면 부분 조회 (분석 중에도 실시간 갱신)
        if (status.messageCount > fetchedCountRef.current && !isCompleteRef.current) {
          await fetchDebateResult(sessionId, false);
        }

        if (status.status === "COMPLETED") {
          cleanup();
          setIsWaitingForUserInput(false);
          setWaitingStage(null);
          await fetchDebateResult(sessionId, true);
          // Phase 10.20 — REANALYZING → COMPLETED 전이 시 1회성 배너 표시
          if (wasReanalyzingRef.current) {
            wasReanalyzingRef.current = false;
            const completedMode = continuationModeRef.current;
            if (completedMode === "reanalysis") {
              setReanalyzeBadge({
                count: userFollowUps.filter((q) => q.targetAgent !== "system" && q.reanalyzeStatus !== "deleted").length || 1,
                at: new Date().toISOString(),
              });
            } else {
              setReanalyzeBadge(null);
            }
            continuationModeRef.current = null;
            // Phase 10.38 — 성공 시 in-progress 질문 → "reflected"
            // Phase 10.45 — 토론 타임라인에 완료 divider 시스템 메시지 추가
            const completionMsg = {
              targetAgent: "system",
              message: "추가 토론 완료 — 사용자 질문이 반영된 새 결과가 준비되었습니다.",
              createdAt: new Date().toISOString(),
            };
            setUserFollowUps((prev) => {
              const updated = prev.map((q) =>
                q.targetAgent === "system" || q.reanalyzeStatus === "reflected"
                  ? q
                  : { ...q, reanalyzeStatus: "reflected" as const },
              );
              // 이미 동일한 완료 divider 가 없으면 추가
              const hasDone = updated.some(
                (q) => q.targetAgent === "system" && /추가 토론 완료|재검토 완료/.test(q.message || ""),
              );
              const next = hasDone ? updated : [...updated, completionMsg];
              try { sessionStorage.setItem("userFollowUps", JSON.stringify(next)); } catch { /* */ }
              try { sessionStorage.setItem("verdictResultSource", "latest-reanalyze"); } catch { /* */ }
              return next;
            });
          } else {
            // 최초 분석 완료 — persist (for verdict)
            try { sessionStorage.setItem("userFollowUps", JSON.stringify(userFollowUps)); } catch { /* */ }
            try { sessionStorage.setItem("verdictResultSource", "initial"); } catch { /* */ }
          }
        } else if (status.status === "FAILED") {
          cleanup();
          setIsWaitingForUserInput(false);
          setWaitingStage(null);
          // Phase 10.27 — 실패 시 기존 결과 보존 안내 추가
          setError("분석에 실패했습니다. 기존 결과는 유지됩니다. 잠시 후 다시 시도하거나 서버 상태를 확인하세요.");
          setIsAnalyzing(false);
          // Phase 10.38 — 재검토 실패 시 in-progress → "failed" + /verdict 안내용 persist
          if (wasReanalyzingRef.current) {
            wasReanalyzingRef.current = false;
            // Phase 10.45 — 실패 divider
            const failMsg = {
              targetAgent: "system",
              message: "추가 검토 실패 — 기존 결과를 기준으로 표시합니다.",
              createdAt: new Date().toISOString(),
            };
            setUserFollowUps((prev) => {
              const updated = prev.map((q) =>
                q.targetAgent === "system" || q.reanalyzeStatus === "reflected"
                  ? q
                  : { ...q, reanalyzeStatus: "failed" as const },
              );
              const hasFail = updated.some(
                (q) => q.targetAgent === "system" && /추가 검토 실패|재검토 실패/.test(q.message || ""),
              );
              const next = hasFail ? updated : [...updated, failMsg];
              try { sessionStorage.setItem("userFollowUps", JSON.stringify(next)); } catch { /* */ }
              try { sessionStorage.setItem("verdictResultSource", "prior-after-reanalyze-fail"); } catch { /* */ }
              return next;
            });
          }
        }
      } catch {
        // 네트워크 오류 → 다음 폴링에서 재시도
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);
  }, [cleanup, fetchDebateResult]);

  /* ── 초기화 ── */
  useEffect(() => {
    const reviewDataRaw = sessionStorage.getItem("reviewData");
    if (!reviewDataRaw) { navigate("/input"); return; }

    // Phase 10.4 — reviewData 안에 startupContext 가 있으면 즉시 표시 (백엔드 응답 도착 전에도)
    try {
      const reviewData = JSON.parse(reviewDataRaw);
      if (reviewData?.startupContext) {
        setStartupContext(reviewData.startupContext);
      }
    } catch { /* ignore */ }

    sessionStorage.removeItem("recheckRequest");
    setRecheckRequest(null);

    const sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) {
      setError("세션 정보를 찾을 수 없습니다.");
      setIsAnalyzing(false);
      return;
    }

    setIsAnalyzing(true);

    // Phase 10.23/10.24 — SSE 우선 연결. polling 은 fallback / safety net 으로 병행 유지.
    setStreamStatus("connecting");
    // Phase 10.24 — content 기준 dedup 키 단일화. polling 응답엔 id 가 없어 id 키와 충돌하므로 통일.
    const keyOf = (m: StreamDebateMessage): string => {
      const c = (m.content || "").slice(0, 64);
      return `r:${m.round ?? 0}|a:${m.agentId ?? ""}|t:${m.type ?? ""}|c:${c}`;
    };
    const appendIfNew = (m: StreamDebateMessage) => {
      const k = keyOf(m);
      if (seenMessageKeysRef.current.has(k)) return;
      setMessages((prev) => {
        if (prev.some((existing) => keyOf(existing) === k)) {
          seenMessageKeysRef.current.add(k);
          return prev;
        }
        seenMessageKeysRef.current.add(k);
        fetchedCountRef.current = Math.max(fetchedCountRef.current, prev.length + 1);
        return [
          ...prev,
          {
          agentId: m.agentId || "legal",
          agentName: m.agentName || "",
          content: m.content || "",
          type: m.type || "analysis",
          round: m.round ?? 1,
          stance: m.stance || "",
          evidenceSummary: m.evidenceSummary || "",
          },
        ];
      });
    };

    const ctrl = connectSessionStream(Number(sessionId), {
      onOpen: () => setStreamStatus("open"),
      onClose: () =>
        setStreamStatus((s) => (s === "fallback" || s === "closed" ? s : "closed")),
      onFatal: () => setStreamStatus("fallback"),
      // Phase 10.24 — 일시적 onerror 시 "error/복구중" 배지로 안내 (자동 재연결에 맡김)
      onTransientError: () => setStreamStatus((s) => (s === "open" ? "error" : s)),
      onHeartbeat: () =>
        // heartbeat 수신 = 연결 복구 신호 → error/connecting 에서 open 으로 회복
        setStreamStatus((s) => (s === "error" || s === "connecting" ? "open" : s)),
      onSnapshot: (snap) => {
        // snapshot — 기존 메시지 전체 dedup 후 반영. polling fetch 와 충돌 없음.
        if (Array.isArray(snap.messages)) {
          snap.messages.forEach(appendIfNew);
        }
        if (snap.status === "COMPLETED") {
          isCompleteRef.current = true;
          setIsComplete(true);
          setIsAnalyzing(false);
          setCurrentPhase((prev) => ({ ...prev, progress: 100, label: "분석 완료" }));
          // 완료 시점에 final decision 등은 polling fetchDebateResult 가 채움
          fetchDebateResult(String(sessionId), true);
        }
      },
      onStatus: (e) => {
        if (e.progress != null) {
          setCurrentPhase((prev) => ({
            ...prev,
            progress: Math.max(prev.progress, e.progress!),
            label: e.label || prev.label,
            description: e.label || prev.description,
          }));
        }
        if (e.status === "REANALYZING") {
          isCompleteRef.current = false;
          setIsComplete(false);
          setIsAnalyzing(true);
          setIsWaitingForUserInput(false);
          setWaitingStage(null);
          wasReanalyzingRef.current = true;
        } else if (WAITING_STATUS_TO_STAGE[e.status]) {
          const nextWaitingStage = WAITING_STATUS_TO_STAGE[e.status];
          isCompleteRef.current = false;
          setIsComplete(false);
          setIsAnalyzing(false);
          setIsWaitingForUserInput(true);
          setWaitingStage(nextWaitingStage);
        }
      },
      onMessage: (e) => {
        const m = e.message;
        if (!m) return;
        appendIfNew(m);
      },
      onProgress: (e) => {
        setCurrentPhase((prev) => ({
          ...prev,
          progress: Math.max(prev.progress, e.progress),
          label: e.label || prev.label,
        }));
      },
      onCompleted: () => {
        isCompleteRef.current = true;
        setIsComplete(true);
        setIsAnalyzing(false);
        setIsWaitingForUserInput(false);
        setWaitingStage(null);
        setCurrentPhase((prev) => ({
          ...prev,
          progress: 100,
          label: "토론이 완료되어 최종 판정을 확인할 수 있습니다.",
          description: "AI 검토팀의 논의가 완료되어 최종 리포트가 준비되었습니다.",
        }));
        // 최종 결과 (finalDecision/evidences) 는 기존 fetch 로 받아 채움
        fetchDebateResult(String(sessionId), true);
        // Phase 10.24 — 완료 시 EventSource 정리 + 배지 closed 로 전환 (heartbeat 노이즈 차단)
        streamRef.current?.close();
        streamRef.current = null;
        setStreamStatus("closed");
      },
      onError: (e) => {
        // SSE error event 는 분석 단계 오류 → fallback 결과 표시 안내. polling 은 그대로 진행.
        setError(e.message || "분석 중 오류가 발생했습니다.");
      },
    });
    streamRef.current = ctrl;

    // polling 도 함께 시작 — SSE 가 성공해도 messageCount / status 변경 안전망 + final fetch 트리거
    pollSessionStatus(sessionId);

    return () => {
      cleanup();
      streamRef.current?.close();
      streamRef.current = null;
      seenMessageKeysRef.current = new Set();
    };
  }, [navigate, cleanup, pollSessionStatus, fetchDebateResult]);

  /* ── 경과 시간 타이머 + Phase 10.26 시간 기반 progress 점진 bump + Phase 10.27 장시간 안내 ── */
  useEffect(() => {
    if (!isAnalyzing) return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => {
        const next = s + 1;
        // Phase 10.26 — SSE/polling 이벤트가 도착하지 않아 progress 가 15% 등에서 멈춘 경우 시간 기반 nudge.
        if (next % 5 === 0) {
          setCurrentPhase((prev) => {
            if (prev.progress >= 85) return prev;
            const bump = Math.min(85, prev.progress + (prev.progress < 30 ? 2 : 1));
            // Phase 10.30 — 60초 이상 경과 + 메시지가 거의 없을 때 사용자용 대기 안내 (내부 용어 미노출)
            const longWaitHint =
              next >= 60 && fetchedCountRef.current === 0
                ? " · ⏳ 응답이 몰리는 경우 검토에 시간이 조금 더 걸릴 수 있습니다."
                : "";
            return {
              ...prev,
              progress: bump,
              description: longWaitHint && !prev.description.includes("응답이 몰리는")
                ? prev.description + longWaitHint
                : prev.description,
            };
          });
        }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isAnalyzing]);

  /* ── 로딩 중 ticker 애니메이션 ── */
  useEffect(() => {
    if (!isAnalyzing) return;
    const tickerTimer = window.setInterval(() => {
      setTickerIndex((prev) => (prev + 1) % liveTicker.length);
    }, 5600);
    return () => window.clearInterval(tickerTimer);
  }, [isAnalyzing]);

  const ticker     = liveTicker[tickerIndex];
  const groupedRounds = useMemo(() => {
    const rounds: Record<number, Message[]> = {};
    messages.forEach((msg) => {
      if (!rounds[msg.round]) rounds[msg.round] = [];
      rounds[msg.round].push(msg);
    });
    return rounds;
  }, [messages]);

  // Phase 10.20 — 첨부자료 분석 반영 요약 (sessionStorage.reviewData.attachments 기반)
  const attachmentsSummary = useMemo<{
    total: number;
    withBody: number;
    partial: number;
    limited: number;
    metaOnly: number;
    masked: number;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem("reviewData");
      if (!raw) return null;
      const data = JSON.parse(raw);
      const list = Array.isArray(data?.attachments) ? data.attachments : [];
      if (list.length === 0) return null;
      let withBody = 0;
      let partial = 0;
      let limited = 0;
      let metaOnly = 0;
      let masked = 0;
      for (const a of list) {
        const s = a?.extractionStatus;
        // Phase 10.51 — extractionStatus 확장:
        //   ok / extracted / partial (PDF/DOCX 서버 추출 성공) / pending-server-extract → 본문 반영
        //   skipped-unsupported / skipped-too-large / failed / error → 메타만
        if (a?.bodyText || s === "ok" || s === "extracted" || s === "partial" || s === "pending-server-extract") {
          withBody += 1;
          if (s === "partial" || a?.bodyTruncated) partial += 1;
        } else if (s === "failed-image-or-empty" || s === "failed" || s === "error") {
          limited += 1;
        } else {
          metaOnly += 1;
        }
        if (Array.isArray(a?.sensitivityFlags) && a.sensitivityFlags.length > 0) masked += 1;
      }
      return { total: list.length, withBody, partial, limited, metaOnly, masked };
    } catch {
      return null;
    }
  }, [messages.length]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}분 ${sec}초` : `${sec}초`;
  };

  /* ── 활성 에이전트: 실제 phase 우선, phase 없으면 ticker speaker ── */
  const activeAgentId: AgentKey | undefined =
    currentPhase.activeAgent ??
    (isAnalyzing ? ticker.speaker : undefined);

  // Phase 10.21 — 현재 라운드 / 현재 발언 에이전트 / 다음 예정 에이전트 deterministic 추정.
  // 백엔드 analysisPhase 가 없을 때 messages 흐름(biz → legal 순서) 으로 추론.
  const liveStatus = useMemo(() => {
    const visible = messages.slice(0, visibleCount);
    const lastMsg = visible[visible.length - 1];
    const currentRound = lastMsg?.round ?? 1;

    const nextSpeakerOrder: AgentKey[] = ["business", "legal", "risk", "judge"];
    let speakingNow: AgentKey | undefined;
    let nextUp: AgentKey | undefined;

    if (!lastMsg) {
      speakingNow = "business";
      nextUp = "legal";
    } else {
      const lastAg = resolveAgentKey(lastMsg.agentId, lastMsg.agentName, lastMsg.type);
      const idx = nextSpeakerOrder.indexOf(lastAg);
      if (idx < 0) {
        speakingNow = activeAgentId;
        nextUp = undefined;
      } else if (lastAg === "judge") {
        speakingNow = undefined;
        nextUp = undefined;
      } else if (lastAg === "risk" && currentRound < 5) {
        speakingNow = undefined;
        nextUp = undefined;
      } else {
        speakingNow = nextSpeakerOrder[idx + 1];
        nextUp = nextSpeakerOrder[idx + 2];
      }
    }
    // 분석 중이 아니면 speaking 없음
    if (!isAnalyzing) {
      speakingNow = undefined;
      nextUp = undefined;
    }

    const roundLabel = (() => {
      if (!isAnalyzing) return null;
      if (visible.length === 0) return "분석 준비 중";
      if (currentRound >= 1) return `Round ${currentRound} · ${roundTitle(currentRound)}`;
      if (visible.length >= 2) return "Round 1 · 사안 접수 및 초기 쟁점 식별";
      return `Round ${currentRound}`;
    })();

    const roundDescription = (() => {
      if (!isAnalyzing) return "토론이 완료되었습니다.";
      if (!speakingNow) return currentPhase.description;
      const labels: Record<string, string> = {
        business: "비즈니스 전략가가 사업 관점 리스크를 분석 중입니다.",
        legal: "법률 전문가가 관련 법령·판례 근거와 위반 가능성을 점검 중입니다.",
        risk: "리스크 검토자가 운영·정산·계약 위험을 종합 점검 중입니다.",
        judge: "최종 판정관이 권고안을 정리하고 있습니다.",
        ethics: "리스크 검토자가 추가 위험 요소를 점검 중입니다.",
      };
      return labels[speakingNow] || currentPhase.description;
    })();

    return { currentRound, speakingNow, nextUp, roundLabel, roundDescription };
  }, [messages, visibleCount, isAnalyzing, activeAgentId, currentPhase.description]);

  // ── 렌더링 ──
  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900">

      {/* ── 헤더 ── */}
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="min-w-[220px] text-left py-1">
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          {isComplete && !error && (
            <Button
              onClick={() => navigate("/verdict")}
              className="bg-[#1E3A8A] hover:bg-[#1E3A8A]/90 text-white rounded-full"
            >
              최종 판정 보기 <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">

        {/* ── 페이지 타이틀 ── */}
        <div>
          <h2 className="text-3xl font-semibold text-[#1E3A8A]">실시간 멀티 에이전트 토론장</h2>
          <p className="text-slate-600 mt-2">
            대기 시간은 백그라운드 연산의 공백이 아니라, 전문가 토론의 진행 상황을 확인하는 시간입니다.
          </p>
          {/* Phase 10.4 — 지원사업 기반 검토 카드 (있을 때만) */}
          {startupContext && (
            <div className="mt-3 rounded-xl border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#1E3A8A]">
                <span aria-hidden>✦</span>
                지원사업 기반 검토
                {startupContext.source && (
                  <span className="rounded-full border border-[#1E3A8A]/20 bg-white px-1.5 py-0 text-[10px] text-[#1E3A8A]/80">
                    {startupContext.source === "k-startup-service"
                      ? "사업공고 조회서비스"
                      : startupContext.source === "k-startup-news"
                        ? "창업소식"
                        : startupContext.source === "k-startup-mixed"
                          ? "통합 매칭"
                          : startupContext.source}
                  </span>
                )}
              </div>
              <p className="mt-1 break-keep font-semibold text-slate-900 line-clamp-2">
                {startupContext.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {startupContext.organization}
                {startupContext.organization && startupContext.deadline && " · "}
                {startupContext.deadline && `마감 ${startupContext.deadline}`}
                {startupContext.category && ` · ${startupContext.category}`}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                공고 내용과 사용자가 입력한 상황을 함께 참고해 법률 리스크를 분석합니다.
              </p>
              {startupContext.applyUrl && (
                <a
                  href={startupContext.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-[#1E3A8A] hover:underline"
                  aria-label="원본 공고 페이지 새 탭에서 열기"
                >
                  원문 공고 보기 <ArrowRight className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {recheckRequest && (
            <div className="mt-3 rounded-xl border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-3 text-sm">
              추가 질문 반영: {recheckRequest.target} / {recheckRequest.question || "추가 질문 없음"}
            </div>
          )}
          {isAnalyzing && elapsedSeconds > 0 && (
            <p className="text-sm text-slate-400 mt-2">
              경과 시간: {formatElapsed(elapsedSeconds)}
            </p>
          )}
        </div>

        {/* ── 분석 진행 중 ── */}
        {isAnalyzing && (
          <>
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                  현재 토론 진행
                  <Badge variant="outline" className="text-[10px]">
                    {currentPhase.progress}%
                  </Badge>
                  <StreamStatusBadge status={streamStatus} />
                </CardTitle>
                <CardDescription>{currentPhase.label}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-[#1E3A8A]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-medium">
                      {liveStatus.roundLabel || currentPhase.humourLabel}
                    </span>
                    {liveStatus.speakingNow && (
                      <span className="text-slate-600">
                        · 지금 발언 중: {agentMap[liveStatus.speakingNow]?.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">
                    {liveStatus.roundDescription || currentPhase.description}
                  </p>
                </div>
                {(() => {
              type ProvAgent = "business" | "legal" | "risk" | "judge";
              const provisional: Array<{ ag: ProvAgent; text: string; activeAt: number }> = [
                { ag: "business", text: "비즈니스 전략가가 사업 관점 리스크를 검토 중입니다.", activeAt: 10 },
                { ag: "legal", text: "법률 전문가가 협약 조건과 개인정보 처리 가능성을 확인 중입니다.", activeAt: 30 },
                { ag: "risk", text: "리스크 검토자가 정산·환수·중복 수혜 가능성을 점검 중입니다.", activeAt: 60 },
                { ag: "judge", text: "최종 판정관이 검토 의견을 종합하고 있습니다.", activeAt: 85 },
              ];
              return (
                    <div className="grid gap-2 md:grid-cols-4">
                      {provisional.map((p, i) => {
                        const ag = agentMap[p.ag];
                        const Icon = ag.icon;
                        const active = currentPhase.progress >= p.activeAt;
                        const isSpeaking = active && (i === provisional.length - 1 || currentPhase.progress < provisional[i + 1].activeAt);
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border px-3 py-2 ${isSpeaking ? "border-[#1E3A8A]/35 bg-[#1E3A8A]/5" : active ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50 opacity-60"}`}
                          >
                            <div className={`flex items-center gap-1.5 text-xs font-medium ${ag.color}`}>
                              <Icon className="w-3.5 h-3.5" />
                              <span>{ag.name}</span>
                              {isSpeaking ? (
                                <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[#1E3A8A]">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  진행 중
                                </span>
                              ) : active ? (
                                <span className="ml-auto text-[10px] text-emerald-700">완료</span>
                              ) : (
                                <span className="ml-auto text-[10px] text-slate-400">예정</span>
                              )}
                            </div>
                            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-600">{p.text}</p>
                          </div>
                        );
                      })}
                    </div>
                );
                })()}
                <p className="text-[11px] text-slate-500">
                  검토 중에도 아래에서 추가 질문을 남길 수 있습니다. 실제 에이전트 발언은 아래 토론 로그에 순차적으로 표시됩니다.
                </p>
              </CardContent>
            </Card>

            {/* Phase 10.20/10.21 — 실시간 토론 메시지 타임라인 (staged reveal + 채팅 UX) */}
            {messages.length > 0 && (
              <LiveDebateTimeline
                messages={messages}
                visibleCount={visibleCount}
                userFollowUps={userFollowUps}
                isAnalyzing
                messagesEndRef={messagesEndRef}
                attachmentsSummary={attachmentsSummary}
                reanalyzeBadge={reanalyzeBadge}
                liveStatus={liveStatus}
                unseenCount={unseenCount}
                onJumpToBottom={jumpToBottom}
              />
            )}
          </>
        )}

        {isWaitingForUserInput && messages.length > 0 && !error && (
          <>
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-emerald-800 font-medium">
                  <CheckCircle2 className="w-5 h-5" />
                  {waitingStage ? waitingStatusLabel(waitingStage) : "이번 라운드 검토가 끝났습니다."}
                </div>
                <p className="text-sm text-emerald-700 mt-2">
                  {waitingStage ? waitingStatusDescription(waitingStage) : "추가 질문이나 조건을 입력해 검토 방향을 보완해 주세요."}
                </p>
              </CardContent>
            </Card>
            <LiveDebateTimeline
              messages={messages}
              visibleCount={messages.length}
              userFollowUps={userFollowUps}
              isAnalyzing={false}
              messagesEndRef={messagesEndRef}
              attachmentsSummary={attachmentsSummary}
              reanalyzeBadge={reanalyzeBadge}
              liveStatus={liveStatus}
              unseenCount={0}
              onJumpToBottom={jumpToBottom}
            />
          </>
        )}

        {/* ── 에러 (분석 실패) ── */}
        {!isAnalyzing && error && !isComplete && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-red-700 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">분석 실패</span>
              </div>
              <p className="text-red-700 text-sm">{error}</p>
              <div className="flex gap-3 mt-4">
                <Button variant="outline" onClick={() => navigate("/")}>홈으로</Button>
                <Button onClick={() => { sessionStorage.removeItem("sessionId"); navigate("/input"); }}>다시 시도</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Phase 10.33 — AI 검토 일부 실패 경고 (결과는 있지만 에러 포함) — 기존 결과 보기 + 다시 시도 CTA */}
        {isComplete && error && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-amber-800 font-medium">
                <AlertCircle className="w-5 h-5" /> 일부 AI 응답이 지연되어 기존 결과를 그대로 보여드립니다
              </div>
              <p className="text-sm text-amber-700 mt-1">
                지금까지의 검토 결과는 그대로 유지됩니다. 잠시 후 다시 시도하거나, 기존 결과 그대로 최종 리포트를 확인할 수 있습니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="rounded-full border-amber-400 text-amber-800 hover:bg-amber-100"
                  onClick={() => {
                    setError("");
                    const sid = sessionStorage.getItem("sessionId");
                    if (sid) {
                      isCompleteRef.current = false;
                      setIsComplete(false);
                      setIsAnalyzing(true);
                      // POST reanalyze 다시 시도
                      fetch(`http://localhost:8080/api/sessions/${sid}/reanalyze`, { method: "POST" })
                        .then(() => pollSessionStatus(sid))
                        .catch(() => setError("다시 시도가 실패했습니다. 잠시 후 다시 시도해 주세요."));
                    }
                  }}
                >
                  🔁 다시 시도
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => navigate("/verdict")}
                >
                  📄 기존 결과로 최종 리포트 보기 <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 분석 완료 ── */}
        {!isAnalyzing && isComplete && !error && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-emerald-800 font-medium">
                <CheckCircle2 className="w-5 h-5" />
                AI 검토팀의 논의가 완료되었습니다.
              </div>
              <p className="text-sm text-emerald-700 mt-2">
                {/* Phase 10.31/10.76 — 개입 선택지 명시 */}
                {reanalyzeBadge
                  ? "최근 재검토 결과가 최종 리포트에 반영되었습니다. 아래 버튼으로 최종 판정을 확인하세요."
                  : `에이전트별 검토 결과 ${messages.filter((m) => m.type !== "error").length}건이 정리되었습니다. 아래 버튼으로 최종 판정을 확인할 수 있습니다.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="default" className="rounded-full bg-[#1E3A8A] hover:bg-[#1E3A8A]/90" onClick={() => navigate("/verdict")}>
                  {/* Phase 10.76 — 의도가 명확한 라벨 */}
                  최종 판정 보기 <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setShowDetailedLogs((prev) => !prev)}
                >
                  {showDetailedLogs ? "토론 로그 닫기" : "토론 로그 자세히 보기"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Phase 10.20 — 토론 로그 상세 (완료 후 토글) — 동일한 타임라인 컴포넌트로 통합 */}
        {showDetailedLogs && !isAnalyzing && !isWaitingForUserInput && messages.length > 0 && (
          <LiveDebateTimeline
            messages={messages}
            visibleCount={messages.length}
            userFollowUps={userFollowUps}
            isAnalyzing={false}
            messagesEndRef={messagesEndRef}
            attachmentsSummary={attachmentsSummary}
            reanalyzeBadge={reanalyzeBadge}
            liveStatus={liveStatus}
            unseenCount={0}
            onJumpToBottom={jumpToBottom}
          />
        )}

        {/* Phase 10.11 — 사용자 추가 질문 말풍선 영역 */}
        {!isAnalyzing && userFollowUps.some((q) => q.targetAgent !== "system") && (
          <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
              사용자 추가 질문 관리 ({userFollowUps.filter((q) => q.targetAgent !== "system" && q.reanalyzeStatus !== "deleted").length}건)
              <span className="ml-2 text-[11px] font-normal text-slate-500">
                질문 내용은 위 토론 타임라인에 말풍선으로 표시됩니다.
              </span>
            </summary>
            <Card className="border-0 bg-white shadow-none">
              <CardContent className="space-y-2 px-4 pb-4 pt-0">
              {userFollowUps.map((q, originalIdx) => ({ q, originalIdx })).filter(({ q }) => q.targetAgent !== "system").map(({ q, originalIdx }) => {
                // Phase 10.56 — 질문별 상태 chip (반영 완료 / 일부 반영 / 재검토 반영 대기 / 다시 시도 필요 / 재검토 중)
                const rs = q.reanalyzeStatus;
                const chip = (() => {
                  if (rs === "deleted") return { label: "삭제됨", cls: "border-slate-200 bg-slate-50 text-slate-500" };
                  if (rs === "completed" || rs === "reflected") return { label: "반영 완료", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
                  if (rs === "partial") return { label: "일부 반영", cls: "border-sky-200 bg-sky-50 text-sky-700" };
                  if (rs === "failed") return { label: "다시 시도 필요", cls: "border-red-200 bg-red-50 text-red-700" };
                  if (rs === "in-progress") return { label: "반영 중", cls: "border-blue-200 bg-blue-50 text-blue-700" };
                  return { label: q.updatedAt ? "수정됨 · 대기" : "대기", cls: "border-amber-200 bg-amber-50 text-amber-800" };
                })();
                // Phase 10.85 — 수정/삭제는 pending / failed 상태일 때만 가능 (반영 완료/진행 중 변경 차단).
                const isEditable = !isAnalyzing && (!rs || rs === "pending" || rs === "failed");
                return (
                  <div key={originalIdx} className={`space-y-1 ${rs === "deleted" ? "opacity-60" : ""}`}>
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-3 py-2 text-sm text-white shadow-sm">
                        <div className="mb-0.5 text-[10px] opacity-80">
                          대상: {targetAgentLabel(q.targetAgent)} {q.createdAt && `· ${new Date(q.createdAt).toLocaleTimeString("ko-KR")}`}
                        </div>
                        <p className="break-keep whitespace-pre-wrap">{q.message}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${chip.cls}`}>{chip.label}</span>
                      {isEditable && (
                        <>
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] text-slate-600 hover:bg-slate-50"
                            onClick={async () => {
                              const next = window.prompt("질문 내용을 수정하세요", q.message);
                              if (next == null) return;
                              const trimmed = next.trim();
                              if (!trimmed || trimmed === q.message) return;
                              const duplicate = userFollowUps.some((p, j) =>
                                j !== originalIdx
                                && p.targetAgent !== "system"
                                && p.reanalyzeStatus !== "deleted"
                                && p.message.trim() === trimmed,
                              );
                              if (duplicate) {
                                alert("이미 같은 질문이 저장되어 있습니다.");
                                return;
                              }
                              const sessionId = sessionStorage.getItem("sessionId");
                              if (!sessionId) return;
                              try {
                                const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/questions`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ index: originalIdx, message: trimmed }),
                                });
                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                setUserFollowUps((prev) => {
                                  const nextList = prev.map((p, j) => j === originalIdx
                                    ? { ...p, message: trimmed, updatedAt: new Date().toISOString(), reanalyzeStatus: "pending" as const }
                                    : p);
                                  try { sessionStorage.setItem("userFollowUps", JSON.stringify(nextList)); } catch { /* */ }
                                  return nextList;
                                });
                              } catch (e) {
                                console.warn("[questions] edit failed", e);
                                alert("질문 수정에 실패했습니다. 잠시 후 다시 시도해 주세요.");
                              }
                            }}
                            title="질문 수정"
                          >
                            ✏ 수정
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-[10.5px] text-red-600 hover:bg-red-50"
                            onClick={async () => {
                              if (!window.confirm("이 질문을 삭제할까요? 다음 검토에 반영되지 않습니다.")) return;
                              const sessionId = sessionStorage.getItem("sessionId");
                              if (!sessionId) return;
                              try {
                                const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/questions`, {
                                  method: "DELETE",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ index: originalIdx, message: null }),
                                });
                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                setUserFollowUps((prev) => {
                                  const nextList = prev.map((p, j) => j === originalIdx
                                    ? { ...p, reanalyzeStatus: "deleted" as const }
                                    : p);
                                  try { sessionStorage.setItem("userFollowUps", JSON.stringify(nextList)); } catch { /* */ }
                                  return nextList;
                                });
                              } catch (e) {
                                console.warn("[questions] delete failed", e);
                                alert("질문 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
                              }
                            }}
                            title="질문 삭제"
                          >
                            🗑 삭제
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="mt-1 text-[11px] text-slate-500">
                {isComplete ? (
                  <>
                    ※ 완료 후 새 질문은 <strong>추가 재검토 요청</strong>에서 반영할 수 있습니다.
                    기존 Round 1~5 토론과 최종 판단은 유지되고, 새 재검토 결과가 아래에 이어집니다.
                  </>
                ) : waitingStage ? (
                  <>
                    ※ 추가 질문을 남기고 <strong>{waitingStage === "round5" ? "종합 라운드 시작" : "다음 라운드에 반영"}</strong> 버튼을 누르면,
                    Round {stageTargetRound(waitingStage)} {roundTitle(stageTargetRound(waitingStage))}에 반영됩니다.
                    기존 Round 1~{stageTargetRound(waitingStage) - 1} 토론은 그대로 유지됩니다.
                  </>
                ) : (
                  <>
                    ※ 추가 질문을 남기고 <strong>다음 라운드에 반영</strong> 버튼을 누르면, 다음 라운드 토론에 반영됩니다.
                    기존 Round 1 토론은 그대로 유지됩니다.
                  </>
                )}
              </p>
              </CardContent>
            </Card>
          </details>
        )}

        {/* Phase 10.6/10.11/10.31 — 라운드 사이 사용자 개입 영역. 분석 중/완료 상태 전달. */}
        {messages.length > 0 && !error && (isWaitingForUserInput || (!isAnalyzing && isComplete)) && (
          <RoundInterventionBlock
            startupContext={startupContext}
            lastRoundMessages={Object.values(groupedRounds).pop() ?? []}
            isAnalyzing={isAnalyzing}
            existingFollowUps={userFollowUps}
            pendingFollowUpCount={userFollowUps.filter((q) =>
              q.targetAgent !== "system"
              && q.reanalyzeStatus !== "deleted"
              && (!q.reanalyzeStatus || q.reanalyzeStatus === "pending" || q.reanalyzeStatus === "failed")
            ).length}
            allowContinueWithoutQuestions={isWaitingForUserInput}
            mode={isComplete ? "completed" : waitingStage ?? "round2"}
            onQuestionSaved={(q) => setUserFollowUps((prev) => {
              const exists = prev.some((p) =>
                p.targetAgent !== "system"
                && p.reanalyzeStatus !== "deleted"
                && p.message.trim() === q.message.trim()
              );
              const next = exists ? prev : [...prev, q];
              try { sessionStorage.setItem("userFollowUps", JSON.stringify(next)); } catch { /* */ }
              return next;
            })}
            onReanalyzeStarted={(sessionId) => {
              // Phase 10.18 — 부모 스코프의 polling 재시작 (REANALYZING 상태 추적)
              isCompleteRef.current = false;
              setIsComplete(false);
              setIsAnalyzing(true);
              setIsWaitingForUserInput(false);
              const nextStage = waitingStage ?? "round2";
              continuationModeRef.current = isComplete ? "reanalysis" : nextStage;
              const appliedRound: number | string = isComplete ? "reanalysis" : stageTargetRound(nextStage);
              const hasPendingFollowUps = pendingFollowUpCount > 0;
              // Phase 10.22 — 시스템 메시지로 "추가 질문 반영 시작" 즉시 표시.
              // 사용자 질문 버블과 구분되도록 user follow-up 영역에 시스템 항목으로 prepend.
              setUserFollowUps((prev) => {
                const marked = prev.map((q) =>
                  q.targetAgent === "system"
                    ? q
                    : (!q.reanalyzeStatus || q.reanalyzeStatus === "pending" || q.reanalyzeStatus === "failed")
                      ? { ...q, reanalyzeStatus: "in-progress" as const, appliedRound }
                      : q,
                );
                return [
                  ...marked,
                  {
                    targetAgent: "system",
                    message: isWaitingForUserInput
                      ? nextStage === "round5"
                        ? hasPendingFollowUps
                          ? "추가 질문을 반영해 종합 라운드를 시작합니다. 기존 Round 1~4 토론은 유지되고 최종 리포트가 아래에 이어집니다."
                          : "추가 질문 없이 종합 라운드를 시작합니다. 기존 Round 1~4 토론을 바탕으로 최종 리포트를 정리합니다."
                        : hasPendingFollowUps
                          ? `추가 질문을 반영해 Round ${stageTargetRound(nextStage)} ${roundTitle(stageTargetRound(nextStage))}를 시작합니다. 기존 토론은 유지되고 새 라운드가 아래에 이어집니다.`
                          : `추가 질문 없이 Round ${stageTargetRound(nextStage)} ${roundTitle(stageTargetRound(nextStage))}를 시작합니다. 기존 검토 내용을 바탕으로 이어갑니다.`
                      : "추가 재검토를 시작합니다. 기존 토론 기록은 유지되고 새 결과가 아래에 이어집니다.",
                    createdAt: new Date().toISOString(),
                  },
                ];
              });
              setWaitingStage(null);
              // staged reveal 다시 시작 — visibleCount 는 messages 가 0으로 cleanup 될 때 자동 0으로 동기화됨
              pollSessionStatus(sessionId);
            }}
          />
        )}

      </main>
    </div>
  );
}

/* ══════════════════════════════════════════
   Phase 10.6 — 라운드 사이 사용자 개입 + 비서 추천 질문 3개
══════════════════════════════════════════ */
function RoundInterventionBlock({
  startupContext,
  lastRoundMessages,
  isAnalyzing = false,
  existingFollowUps,
  pendingFollowUpCount,
  allowContinueWithoutQuestions,
  mode = "round2",
  onQuestionSaved,
  onReanalyzeStarted,
}: {
  startupContext: {
    title?: string;
    organization?: string;
    deadline?: string;
    category?: string;
    source?: string;
    applyUrl?: string;
  } | null;
  isAnalyzing?: boolean;
  existingFollowUps: FollowUpQuestion[];
  pendingFollowUpCount: number;
  allowContinueWithoutQuestions?: boolean;
  mode?: InterventionMode;
  onQuestionSaved?: (q: FollowUpQuestion) => void;
  onReanalyzeStarted?: (sessionId: string) => void;
  lastRoundMessages: Message[];
}) {
  const [target, setTarget] = useState<string>("all");
  const [question, setQuestion] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  /** Phase 10.18 — 추가 질문 후속 처리 통합 status (5단계 표시). */
  const [followUpStatus, setFollowUpStatus] = useState<
    "idle" | "saving" | "saved" | "reanalyzing" | "reanalyzed" | "failed"
  >("idle");
  const [followUpStatusMsg, setFollowUpStatusMsg] = useState<string>("");
  const isCompletedReview = mode === "completed";
  const isFinalIntervention = mode === "round5";
  const targetRound = mode === "completed" ? null : stageTargetRound(mode);
  const activeUserFollowUps = existingFollowUps.filter((q) =>
    q.targetAgent !== "system" && q.reanalyzeStatus !== "deleted" && q.message.trim(),
  );
  const sourceRoundForNewQuestion = targetRound
    ? Math.min(4, Math.max(1, targetRound - 1))
    : undefined;

  useEffect(() => {
    setSubmitted(false);
    setQuestion("");
    setFollowUpStatus("idle");
    setFollowUpStatusMsg("");
  }, [mode]);

  // Phase 10.17/10.18 — 저장된 followUpQuestions 로 backend 분석 트리거.
  // 단순 alert 대신 inline status 로 표시 + poll 재시작.
  const handleReanalyze = async () => {
    const sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) return;
    if (isAnalyzing) {
      setFollowUpStatus("failed");
      setFollowUpStatusMsg("현재 토론이 진행 중입니다. 이번 라운드가 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    if (pendingFollowUpCount <= 0 && !allowContinueWithoutQuestions) {
      setFollowUpStatus("failed");
      setFollowUpStatusMsg(isCompletedReview
        ? "재검토할 질문이 없습니다. 먼저 질문을 저장해 주세요."
        : "반영할 추가 질문이 없습니다. 먼저 질문을 저장해 주세요.");
      return;
    }
    setFollowUpStatus("reanalyzing");
    setFollowUpStatusMsg(isCompletedReview ? "재검토 요청 중..." : isFinalIntervention ? "종합 라운드 요청 중..." : "다음 라운드 요청 중...");
    try {
      const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFollowUpStatus("reanalyzed");
        setFollowUpStatusMsg(
          (data.followUpCount ?? 0) > 0
            ? isCompletedReview
              ? `추가 재검토를 시작했습니다 (질문 ${data.followUpCount}건 반영). 새 메시지가 도착하면 자동으로 표시됩니다.`
              : `${isFinalIntervention ? "종합 라운드" : `Round ${targetRound} ${roundTitle(targetRound || 0)}`}를 시작했습니다 (질문 ${data.followUpCount}건 반영). 새 메시지가 도착하면 자동으로 표시됩니다.`
            : `질문 없이 ${isFinalIntervention ? "종합 라운드" : `Round ${targetRound} ${roundTitle(targetRound || 0)}`}를 시작했습니다. 새 메시지가 도착하면 자동으로 표시됩니다.`,
        );
        // polling 재시작 — 부모 콜백에 위임 (REANALYZING 상태 추적)
        onReanalyzeStarted?.(sessionId);
      } else {
        setFollowUpStatus("failed");
        setFollowUpStatusMsg(data.error || (isCompletedReview ? "재검토 실행에 실패했습니다." : isFinalIntervention ? "종합 라운드 시작에 실패했습니다." : "다음 라운드 시작에 실패했습니다."));
      }
    } catch (e) {
      console.error("[reanalyze] 실패", e);
      setFollowUpStatus("failed");
      setFollowUpStatusMsg(isCompletedReview ? "재검토 요청 중 네트워크 오류가 발생했습니다." : isFinalIntervention ? "종합 라운드 요청 중 네트워크 오류가 발생했습니다." : "다음 라운드 요청 중 네트워크 오류가 발생했습니다.");
    }
  };

  // Phase 10.30 — 추천 질문 새로고침용 cycle index. + 버튼 클릭 시 +1.
  const [suggestionsCycle, setSuggestionsCycle] = useState(0);

  /**
   * Phase 10.30 — 에이전트(targetAgent)별 + 직전 라운드 메시지 키워드 + startupContext 기반
   * 추천 질문 생성. 각 에이전트마다 6~9개 후보 pool 에서 cycle 에 따라 3개 회전.
   */
  const suggestions = useMemo(() => {
    const isStartup = Boolean(startupContext);
    const hay = lastRoundMessages.map((m) => m.content).join(" ").toLowerCase();
    const hasPrivacy = /개인정보|데이터|동의|제3자/.test(hay);
    const hasLabor = /고용|외주|용역|청년|프리랜서|근로/.test(hay);
    const hasIp = /지식재산|성과물|특허|상표|저작권/.test(hay);
    const hasFunding = /환수|정산|사업비|보조금|협약/.test(hay);
    const hasMarketing = /광고|홍보|100%|무료|보장|이벤트/.test(hay);

    // 대상별 pool — startup 우선, 그 외엔 일반 카테고리 fallback
    const poolByTarget: Record<string, string[]> = {
      business: isStartup
        ? [
            "이 지원사업에서 사업비를 외주 용역비로 사용할 때 실무적으로 주의할 점을 더 구체적으로 알려주세요.",
            "성과 지표나 KPI를 어떻게 작성해야 환수 리스크를 줄일 수 있을까요?",
            "우리 회사가 이 공고에 지원할 때 사업계획서에서 강조해야 할 부분은 무엇인가요?",
            "협약 체결 전 비즈니스 관점에서 가장 먼저 검토할 조건을 알려주세요.",
            "이 지원사업 수행 중 매출/고객/홍보 측면에서 발생할 수 있는 부수 효과를 정리해 주세요.",
            "지원사업 종료 후에도 우리 회사가 성과물을 자유롭게 활용할 수 있는지 사업적 관점에서 점검해 주세요.",
          ]
        : [
            "이 거래 구조에서 협상 전에 가장 먼저 확인해야 할 사업상 리스크는 무엇인가요?",
            "상대방에게 불리하게 보이지 않으면서도 우리 회사의 책임을 줄이는 방법은 무엇인가요?",
            "사업 관점에서 이 결정이 미치는 단기/장기 영향을 비교해 주세요.",
            "이 사안을 진행할 때 매출/고객/평판 측면 리스크를 우선순위대로 정리해 주세요.",
            "투자 유치나 향후 거래에 영향을 줄 수 있는 비즈니스 리스크가 있다면 알려 주세요.",
            "이 조건을 그대로 수용했을 때 대체 가능한 비즈니스 옵션이 있는지 알려 주세요.",
          ],
      legal: isStartup
        ? [
            "협약서에서 환수나 제재로 이어질 수 있는 조항을 구체적으로 알려주세요.",
            "성과물의 지식재산권이 우리 회사에 귀속되려면 어떤 조항을 확인해야 하나요?",
            "개인정보를 수집하거나 외주업체에 공유할 때 어떤 동의·위탁 조항이 필요한가요?",
            "사업비 집행/정산 시 적용되는 법적 기준과 위반 시 책임을 알려주세요.",
            "협약 해지·정산·환수 사유와 절차에 대해 법적으로 확인해야 할 사항을 알려주세요.",
            "참여인력 인정 범위와 외주 사용 조건에 대해 법령상 주의할 부분을 알려주세요.",
            "공고문에 있는 '100% 지원' 같은 표현을 홍보 문구로 사용할 때 표시광고법 리스크가 있나요?",
          ]
        : [
            "이 조항이 약관규제법이나 전자상거래법상 문제가 될 가능성이 있나요?",
            "개인정보 제3자 제공과 처리위탁을 구분해서 어떤 문구가 필요한지 알려주세요.",
            "이 거래에서 법적으로 가장 위험한 조항과 그 근거 법령을 정리해 주세요.",
            "법무 관점에서 추가로 확인이 필요한 조항이 있다면 어떤 것인가요?",
            "관련 판례나 법령 기준으로 가장 유리한 협상 카드를 알려주세요.",
            "이 사안에 적용되는 핵심 법령과 위반 시 행정·형사 책임을 정리해 주세요.",
          ],
      judge: [
        "현재까지의 논의를 기준으로 가장 우선순위가 높은 리스크 3가지를 정리해주세요.",
        "최종 신청/서명 전에 반드시 확인해야 할 체크리스트를 우선순위대로 알려주세요.",
        "지금 상태에서 진행 가능/보류/수정 필요 중 어느 쪽에 가까운지 판단해주세요.",
        "비즈니스 측과 법률 측 의견 중 합의된 부분과 충돌하는 부분을 정리해 주세요.",
        "지금까지 논의된 위험을 모두 줄이려면 어떤 조치가 먼저 필요한지 순서대로 알려주세요.",
        "현재 입력 정보와 첨부 자료만으로 결론을 내리기에 부족한 부분이 있다면 알려주세요.",
      ],
      risk: [
        "현재까지 토론에서 합의된 부분과 합의되지 않은 부분을 짧게 정리해 주세요.",
        "비즈니스 측과 법률 측 주장 중 어느 쪽이 더 설득력 있는지 근거와 함께 알려주세요.",
        "최종 결정 시 양보할 수 없는 핵심 원칙과 양보 가능한 부분을 구분해 주세요.",
      ],
      ethics: [
        "현재까지 토론에서 합의된 부분과 합의되지 않은 부분을 짧게 정리해 주세요.",
        "비즈니스 측과 법률 측 주장 중 어느 쪽이 더 설득력 있는지 근거와 함께 알려주세요.",
        "최종 결정 시 양보할 수 없는 핵심 원칙과 양보 가능한 부분을 구분해 주세요.",
      ],
      all: [
        "사업비 정산, IP 귀속, 개인정보 처리 중 가장 위험한 부분을 비교해서 알려주세요.",
        "현재 입력 정보에서 빠진 자료가 무엇인지 에이전트별로 정리해주세요.",
        "이 사안을 진행하기 전에 반드시 수정해야 할 부분과 선택적으로 보완할 부분을 나눠주세요.",
        "방금 토론 내용에서 가장 중요한 리스크 3가지를 우선순위대로 정리해주세요.",
        "에이전트별로 가장 우려하는 지점을 한 문장씩 요약해 주세요.",
        "지금까지 논의를 토대로 추가로 어떤 자료를 첨부하면 진단 품질이 높아질지 알려주세요.",
      ],
    };

    // 직전 라운드 키워드 가중치 — 매칭되는 prompt 를 pool 의 앞쪽으로 끌어올림
    const keywordBoosters: Array<{ on: boolean; text: string }> = [
      {
        on: hasPrivacy,
        text: "참가자/고객/근로자 개인정보를 수집할 때 동의·보관·제3자 제공 측면에서 확인해야 할 사항을 알려주세요.",
      },
      {
        on: hasLabor,
        text: "사업비로 인력을 고용하거나 외주를 줄 때 근로계약·도급 구분 측면에서 점검할 사항을 알려주세요.",
      },
      {
        on: hasIp,
        text: "성과물의 지식재산권 귀속과 사용권 범위를 어디서 확인해야 하는지 알려주세요.",
      },
      {
        on: hasFunding,
        text: "사업비 정산·환수 가능성과 협약 조건을 함께 검토해 주세요.",
      },
      {
        on: hasMarketing,
        text: "'100% 지원/무료/보장' 표현이 표시광고법상 문제가 없는지 확인해 주세요.",
      },
    ];
    const boosted = keywordBoosters.filter((b) => b.on).map((b) => b.text);

    const pool = poolByTarget[target] || poolByTarget.all;
    const merged = [...boosted, ...pool.filter((p) => !boosted.includes(p))];

    // cycle 기반 회전 — suggestionsCycle 만큼 시작 인덱스 이동
    const start = (suggestionsCycle * 3) % Math.max(1, merged.length);
    const rotated = [...merged.slice(start), ...merged.slice(0, start)];
    return rotated.slice(0, 3);
  }, [target, startupContext, lastRoundMessages, suggestionsCycle]);

  const refreshSuggestions = () => setSuggestionsCycle((c) => c + 1);

  // Phase 10.33 — 사용자 친화 라벨로 통일. value 는 backend/Python schema 호환 코드 유지.
  const targetOptions = [
    { value: "all", label: "전체 에이전트" },
    { value: "business", label: "비즈니스 전략가" },
    { value: "legal", label: "법률 전문가" },
    { value: "risk", label: "리스크 검토자" },
    { value: "judge", label: "최종 판정관" },
  ];

  const handleSubmit = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const duplicate = existingFollowUps.some((q) =>
      q.targetAgent !== "system"
      && q.reanalyzeStatus !== "deleted"
      && q.message.trim() === trimmed
    );
    if (duplicate) {
      setFollowUpStatus("failed");
      setFollowUpStatusMsg("이미 같은 질문이 저장되어 있습니다.");
      return;
    }
    setFollowUpStatus("saving");
    setFollowUpStatusMsg("질문 저장 중...");
    // Phase 10.9 — 백엔드에 영구 저장 시도 (sessionId 가 있을 때만)
    const createdAt = new Date().toISOString();
    const questionOrder = activeUserFollowUps.length + 1;
    const sessionId = sessionStorage.getItem("sessionId");
    let saveOk = true;
    if (sessionId) {
      try {
        const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetAgent: target,
            message: trimmed,
            createdAt,
            sourceRound: sourceRoundForNewQuestion,
            questionOrder,
            sequence: questionOrder,
            sender: "user",
          }),
        });
        saveOk = res.ok;
      } catch {
        /* 네트워크 실패 시 sessionStorage 만 의존 */
        saveOk = false;
      }
    }
    if (saveOk) {
      setFollowUpStatus("saved");
      // Phase 10.21 — 자동 실행 제거. 사용자가 직접 다음 단계를 시작하도록 분리.
      setFollowUpStatusMsg(
        isCompletedReview
          ? "✓ 질문이 저장되었습니다. '추가 재검토 시작' 버튼을 누르면 새 검토에 반영됩니다."
          : isFinalIntervention
            ? "✓ 질문이 저장되었습니다. '종합 라운드 시작' 버튼을 누르면 Round 5에 반영됩니다."
          : isAnalyzing
          ? "✓ 질문이 저장되었습니다. 현재 토론이 끝난 뒤 '다음 라운드에 반영' 버튼을 눌러주세요."
          : "✓ 질문이 저장되었습니다. '다음 라운드에 반영' 버튼을 누르면 추가 질문을 반영해 다음 라운드를 시작합니다.",
      );
    } else {
      setFollowUpStatus("failed");
      setFollowUpStatusMsg("질문 저장에 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
    // Phase 10.11 — 부모 컴포넌트에 알림 → 채팅 로그 말풍선으로 즉시 렌더
    if (onQuestionSaved) {
      onQuestionSaved({
        targetAgent: target,
        message: trimmed,
        createdAt,
        reanalyzeStatus: "pending",
        sourceRound: sourceRoundForNewQuestion,
        questionOrder,
        sequence: questionOrder,
        sender: "user",
      });
    }
    setSubmitted(true);
    // 전송 후 textarea 비우기 (다음 질문 입력 가능)
    setQuestion("");
  };

  const handleClear = () => {
    setSubmitted(false);
    setQuestion("");
    setFollowUpStatus("idle");
    setFollowUpStatusMsg("");
    try {
      sessionStorage.removeItem("recheckRequest");
    } catch {
      /* ignore */
    }
  };

  return (
    <Card className="border-[#1E3A8A]/20 bg-white">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1E3A8A]">
          <MessageSquare className="h-4 w-4" />
          {isCompletedReview
            ? "추가 재검토 요청"
            : isFinalIntervention
              ? "종합 라운드 전에 추가로 확인할 마지막 질문이나 조건이 있나요?"
              : `Round ${targetRound} ${roundTitle(targetRound || 0)}에 반영할 질문이나 추가 조건이 있나요?`}
        </div>
        <p className="text-xs text-slate-600">
          {isCompletedReview ? (
            <>
              전체 토론이 끝난 뒤 새로 확인하고 싶은 점이 있으면 재검토 요청으로 남길 수 있습니다.
              기존 토론과 최종 판단은 유지되고, 새 재검토 결과가 아래에 이어집니다.
            </>
          ) : isFinalIntervention ? (
            <>
              Round 4 답변을 본 뒤 최종 리포트 전에 더 확인할 질문이나 조건을 남길 수 있습니다.
              질문을 남기지 않아도 종합 라운드로 바로 진행할 수 있고, 남긴 질문은 Round 5 에이전트 의견과 최종 판정에 반영됩니다.
            </>
          ) : (
            <>
              질문을 남기지 않아도 다음 라운드로 바로 진행할 수 있습니다. 추가 질문을 남기면 그 내용이
              <strong> 다음 라운드 에이전트 검토에 직접 반영</strong>됩니다. 추천 질문을 클릭하거나 직접 작성한 뒤 전송하세요.
              {isAnalyzing
                ? " 검토가 진행되는 동안 질문을 저장하면 현재 라운드가 끝난 뒤 다음 라운드에 반영할 수 있습니다."
                : " 질문을 저장한 뒤 '다음 라운드에 반영' 버튼을 누르면 기존 토론 아래에 새 라운드가 이어집니다."}
            </>
          )}
        </p>

        {/* Phase 10.30 — 비서 추천 질문 chips + 새로고침 버튼 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {suggestions.map((s, i) => (
            <button
              key={`${suggestionsCycle}-${i}`}
              type="button"
              onClick={() => setQuestion(s)}
              className="rounded-full border border-[#1E3A8A]/25 bg-[#1E3A8A]/5 px-3 py-1 text-[12px] text-[#1E3A8A] hover:bg-[#1E3A8A] hover:text-white"
              aria-label={`추천 질문 ${i + 1} 입력창에 채우기`}
              title={s}
            >
              {s.length > 50 ? s.slice(0, 50) + "..." : s}
            </button>
          ))}
          <button
            type="button"
            onClick={refreshSuggestions}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            aria-label="추천 질문을 다른 후보로 새로고침"
            title="선택한 에이전트와 현재 쟁점을 기준으로 다른 추천 질문을 표시합니다"
          >
            ↻ 다른 질문 보기
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="질문 대상 선택"
            className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-[#1E3A8A] focus:outline-none"
          >
            {targetOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={isCompletedReview
              ? "재검토할 질문을 입력하세요. (예: 정산 자료가 부족한 경우 환수 가능성이 있나요?)"
              : isFinalIntervention
                ? "종합 라운드 전에 반영할 마지막 질문이나 조건을 입력하세요. (예: IP 귀속 조항을 더 강하게 요구해야 하나요?)"
              : `Round ${targetRound}에 반영할 질문이나 추가 조건을 입력하세요. (예: 개인정보를 이름과 연락처만 수집하는 경우도 위험한가요?)`}
            rows={2}
            aria-label="추가 질문 입력"
            className="min-h-[64px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#1E3A8A] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {submitted && (
            <span className="mr-auto text-xs text-emerald-700">
              ✓ 질문이 저장되었습니다 · 대상: {targetOptions.find((o) => o.value === target)?.label}
              <br />
              <span className="text-[10.5px] text-slate-500">
                현재 저장 상태입니다. {isCompletedReview
                  ? "'추가 재검토 시작' 버튼을 누르면 이 질문이 새 검토에 포함됩니다."
                  : isFinalIntervention
                    ? "'종합 라운드 시작' 버튼을 누르면 이 질문이 Round 5 AI 검토에 포함됩니다."
                  : "'다음 라운드에 반영' 버튼을 누르면 이 질문이 다음 라운드 AI 검토에 포함됩니다."}
              </span>
            </span>
          )}
          {(submitted || question.trim()) && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              지우기
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!question.trim() || followUpStatus === "reanalyzing"}
            className="rounded-md bg-[#1E3A8A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16306f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitted ? "💾 질문 수정 저장" : "💾 질문 저장"}
          </button>
          {/* Phase 10.21 — 질문 저장과 재검토를 명확히 분리. 저장 후에만 노출. */}
          {(submitted || pendingFollowUpCount > 0 || allowContinueWithoutQuestions) && (
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={isAnalyzing || followUpStatus === "reanalyzing" || (pendingFollowUpCount <= 0 && !allowContinueWithoutQuestions)}
              className="rounded-md border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16306f] disabled:opacity-50"
              title={isCompletedReview ? "저장된 질문을 추가 재검토에 포함합니다." : isFinalIntervention ? "저장된 질문을 종합 라운드 AI 분석에 포함합니다." : "저장된 질문을 다음 라운드 AI 분석에 포함합니다."}
            >
              {followUpStatus === "reanalyzing"
                ? (isCompletedReview ? "재검토 시작 중..." : isFinalIntervention ? "종합 라운드 시작 중..." : "다음 라운드 시작 중...")
                : followUpStatus === "reanalyzed"
                ? (isCompletedReview ? "✓ 재검토 진행 중 (자동 갱신)" : isFinalIntervention ? "✓ 종합 라운드 진행 중 (자동 갱신)" : "✓ 다음 라운드 진행 중 (자동 갱신)")
                : isCompletedReview
                  ? "추가 재검토 시작"
                  : isFinalIntervention
                    ? pendingFollowUpCount > 0
                    ? "종합 라운드 시작"
                    : "질문 없이 종합 라운드 진행"
                  : pendingFollowUpCount > 0
                    ? "다음 라운드에 반영"
                    : "질문 없이 다음 라운드 진행"}
            </button>
          )}
        </div>

        {/* Phase 10.18 — 5단계 followUpStatus 인라인 표시 */}
        {followUpStatus !== "idle" && followUpStatusMsg && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-2 rounded-md border px-3 py-2 text-[11px] ${
              followUpStatus === "failed"
                ? "border-red-200 bg-red-50 text-red-700"
                : followUpStatus === "reanalyzed" || followUpStatus === "saved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {followUpStatus === "saving" && "💾 "}
            {followUpStatus === "saved" && "✓ "}
            {followUpStatus === "reanalyzing" && "⏳ "}
            {followUpStatus === "reanalyzed" && (isCompletedReview ? "🔁 " : "✓ ")}
            {followUpStatus === "failed" && "⚠ "}
            {followUpStatusMsg}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════
   Phase 10.20 — 실시간 토론 메시지 타임라인 (카카오톡식 버블)
   - 라운드 헤더 + agent 별 색상/아이콘
   - 사용자 추가 질문 말풍선 (오른쪽 정렬)
   - 분석 중일 때는 "다음 에이전트 응답 대기 중" placeholder 표시
   - 새 메시지가 도착하면 messagesEndRef 로 스크롤 (부모가 하단 근처 판단)
══════════════════════════════════════════ */
function LiveDebateTimeline({
  messages,
  visibleCount,
  userFollowUps,
  isAnalyzing,
  messagesEndRef,
  attachmentsSummary,
  reanalyzeBadge,
  liveStatus,
  unseenCount,
  onJumpToBottom,
}: {
  messages: Message[];
  visibleCount: number;
  userFollowUps: FollowUpQuestion[];
  isAnalyzing: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  attachmentsSummary: { total: number; withBody: number; metaOnly: number; masked: number } | null;
  reanalyzeBadge: { count: number; at: string } | null;
  liveStatus: {
    currentRound: number;
    speakingNow?: AgentKey;
    nextUp?: AgentKey;
    roundLabel: string | null;
    roundDescription: string;
  };
  unseenCount: number;
  onJumpToBottom: () => void;
}) {
  // 라운드 + 시간순으로 메시지/유저질문을 통합한 타임라인 항목 만들기
  type TimelineQuestion = FollowUpQuestion & { questionOrder: number; sourceRound: number };
  type Item =
    | { kind: "agent"; msg: Message; idx: number }
    | { kind: "user"; q: FollowUpQuestion; idx: number }
    | { kind: "userGroup"; questions: TimelineQuestion[]; idx: number; afterRound: number; label: string };
  type TimelineStage = number | "intervention" | "reanalysis" | "general";
  const stageLabel = (stage: TimelineStage) => {
    if (typeof stage === "number") return `Round ${stage} · ${roundTitle(stage)}`;
    switch (stage) {
      case "intervention": return "사용자 추가 질문";
      case "reanalysis": return "추가 재검토 결과";
      default: return "검토 의견";
    }
  };
  const activeFollowUps = userFollowUps.filter((q) =>
    q.targetAgent !== "system" && q.reanalyzeStatus !== "deleted" && q.message.trim(),
  );
  // Phase 10.21 — staged reveal: 부모가 계산한 visibleCount 만큼만 표시.
  // 재검토 세션에서는 이전 최종 판정관의 긴 결론은 타임라인에서 숨기고, 최신 최종 판단만 Round 3에 표시한다.
  const rawVisibleMessages = messages.slice(0, visibleCount);
  const toRoundNumber = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
  };
  const sortedFollowUps: TimelineQuestion[] = activeFollowUps
    .map((q, originalIndex) => ({ q, originalIndex }))
    .sort((a, b) => {
      const ao = Number(a.q.questionOrder ?? a.q.sequence);
      const bo = Number(b.q.questionOrder ?? b.q.sequence);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
      if (Number.isFinite(ao) && !Number.isFinite(bo)) return -1;
      if (!Number.isFinite(ao) && Number.isFinite(bo)) return 1;
      const at = a.q.createdAt ? Date.parse(a.q.createdAt) : Number.NaN;
      const bt = b.q.createdAt ? Date.parse(b.q.createdAt) : Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ q }, orderIndex) => {
      const questionOrder = orderIndex + 1;
      const explicitSourceRound =
        toRoundNumber(q.sourceRound)
        ?? toRoundNumber(q.afterRound)
        ?? toRoundNumber(q.round)
        ?? toRoundNumber(q.roundNumber);
      // Older saved questions did not carry sourceRound. In the 4-step demo flow,
      // question order is the stable source of truth for both label and insertion point.
      const sourceRound = explicitSourceRound ?? Math.min(4, questionOrder);
      return { ...q, questionOrder, sourceRound };
    });
  const followUpsByAfterRound = new Map<number, TimelineQuestion[]>();
  for (const q of sortedFollowUps) {
    const list = followUpsByAfterRound.get(q.sourceRound) || [];
    list.push(q);
    followUpsByAfterRound.set(q.sourceRound, list);
  }
  const judgeIndexes = rawVisibleMessages
    .map((m, idx) => (resolveAgentKey(m.agentId, m.agentName, m.type) === "judge" && m.type === "recommendation") ? idx : -1)
    .filter((idx) => idx >= 0);
  const firstJudgeIndex = judgeIndexes.length > 0 ? judgeIndexes[0] : -1;
  const lastJudgeIndex = judgeIndexes.length > 0 ? judgeIndexes[judgeIndexes.length - 1] : -1;
  const visibleMessageItems = (activeFollowUps.length > 0 && judgeIndexes.length > 1
    ? rawVisibleMessages.map((m, idx) => ({ msg: m, originalIdx: idx })).filter(({ msg: m, originalIdx: idx }) => {
        const isJudge = resolveAgentKey(m.agentId, m.agentName, m.type) === "judge" && m.type === "recommendation";
        return !isJudge || idx === lastJudgeIndex;
      })
    : rawVisibleMessages.map((m, idx) => ({ msg: m, originalIdx: idx })));
  const visibleMessages = visibleMessageItems.map((item) => item.msg);
  const systemFollowUps = userFollowUps
    .filter((q) => q.targetAgent === "system")
    .slice(-1);
  const items: Item[] = [];
  const insertedQuestionBlocks = new Set<number>();
  visibleMessageItems.forEach(({ msg: m, originalIdx }, i) => {
    const agKey = resolveAgentKey(m.agentId, m.agentName, m.type);
    const isSystem = m.agentId === "system" || m.type === "system" || m.type === "error";
    const msgRound = Number(m.round || 0);
    const afterInitialJudge = activeFollowUps.length > 0
      && firstJudgeIndex >= 0
      && originalIdx > firstJudgeIndex
      && !isSystem
      && agKey !== "judge";
    items.push({ kind: "agent", msg: m, idx: i });

    if (!isSystem && msgRound >= 1 && msgRound <= 4 && !insertedQuestionBlocks.has(msgRound)) {
      const nextMessage = visibleMessageItems.slice(i + 1).find(({ msg }) => {
        const nextIsSystem = msg.agentId === "system" || msg.type === "system" || msg.type === "error";
        return !nextIsSystem;
      })?.msg;
      const nextRound = nextMessage ? Number(nextMessage.round || 0) : null;
      const isRoundBoundary = nextRound == null || nextRound > msgRound || nextRound < msgRound || afterInitialJudge;
      const questions = followUpsByAfterRound.get(msgRound) || [];
      if (isRoundBoundary && questions.length > 0) {
        items.push({
          kind: "userGroup",
          questions,
          idx: i,
          afterRound: msgRound,
          label: questions.length === 1
            ? `사용자 추가 질문 ${questions[0].questionOrder}차`
            : `사용자 추가 질문 ${questions[0].questionOrder}~${questions[questions.length - 1].questionOrder}차`,
        });
        insertedQuestionBlocks.add(msgRound);
      }
    }
  });
  for (const afterRound of [1, 2, 3, 4]) {
    const questions = followUpsByAfterRound.get(afterRound) || [];
    if (insertedQuestionBlocks.has(afterRound) || questions.length === 0) continue;
    const hasApplied = questions.some((q) =>
      q.reanalyzeStatus === "in-progress"
      || q.reanalyzeStatus === "completed"
      || q.reanalyzeStatus === "reflected"
      || q.reanalyzeStatus === "partial"
      || q.reanalyzeStatus === "failed"
    );
    if (hasApplied || visibleMessages.some((m) => Number(m.round) >= afterRound)) {
      items.push({
        kind: "userGroup",
        questions,
        idx: visibleMessages.length,
        afterRound,
        label: questions.length === 1
          ? `사용자 추가 질문 ${questions[0].questionOrder}차`
          : `사용자 추가 질문 ${questions[0].questionOrder}~${questions[questions.length - 1].questionOrder}차`,
      });
      insertedQuestionBlocks.add(afterRound);
    }
  }
  systemFollowUps.forEach((q, i) => items.push({ kind: "user", q, idx: visibleMessages.length + i }));

  // Phase 10.27 — 재검토 시점 추적. system 메시지 등장 후의 라운드는 "재검토 · 라운드 N" 로 표시.
  let inReanalyzeSegment = false;
  let lastStage: TimelineStage | null = null;
  const agentLabel = (k?: AgentKey) => (k ? (agentMap[k]?.name ?? "") : "");

  return (
    <Card className="border-slate-200 bg-white relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
          {isAnalyzing ? "실시간 토론 진행 중" : "토론 로그 (실시간)"}
          <Badge variant="outline" className="text-[10px]">
            {visibleMessages.length}/{messages.length} 메시지
          </Badge>
          {isAnalyzing && visibleMessages.length < messages.length && (
            <span className="text-[10px] text-slate-500">
              새 메시지 도착 — 화면에 순차 등장 중
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {isAnalyzing
            ? "에이전트들이 순차적으로 의견을 제출합니다. 위로 스크롤해도 강제로 따라가지 않습니다."
            : "전체 토론 로그입니다. 사용자 질문은 오른쪽, 에이전트 발언은 왼쪽에 표시됩니다."}
        </CardDescription>
        {/* Phase 10.21 — 현재 라운드/발언 중/다음 예정 안내 */}
        {isAnalyzing && (
          <div className="mt-2 rounded-md border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 px-3 py-2 text-[12px] text-[#1E3A8A]">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {liveStatus.roundLabel && (
                <span className="rounded-full border border-[#1E3A8A]/30 bg-white px-2 py-0.5 text-[10.5px]">
                  {liveStatus.roundLabel}
                </span>
              )}
              {liveStatus.speakingNow && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  지금 발언 중: <strong>{agentLabel(liveStatus.speakingNow)}</strong>
                </span>
              )}
              {liveStatus.nextUp && (
                <span className="text-[11px] text-slate-600">
                  · 다음 예정: {agentLabel(liveStatus.nextUp)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-700">
              {liveStatus.roundDescription}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Phase 10.20 — 재분석 반영 안내 배너 */}
        {reanalyzeBadge && (
          <div
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800"
          >
            이번 추가 검토에는 사용자 추가 질문 {reanalyzeBadge.count}건이 반영되었습니다 ·{" "}
            {new Date(reanalyzeBadge.at).toLocaleTimeString("ko-KR")}
          </div>
        )}
        {/* Phase 10.20 — 첨부자료 분석 반영 요약 */}
        {attachmentsSummary && (
          <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[12px] text-sky-900">
            📎 첨부자료 {attachmentsSummary.total}건을 함께 검토합니다 — 본문 반영 {attachmentsSummary.withBody}건, 메타데이터만 {attachmentsSummary.metaOnly}건
            {attachmentsSummary.partial > 0 && ` · 일부 반영 ${attachmentsSummary.partial}건`}
            {attachmentsSummary.limited > 0 && ` · 본문 확인 제한 ${attachmentsSummary.limited}건`}
            {attachmentsSummary.masked > 0 && ` · 민감정보 자동 마스킹 ${attachmentsSummary.masked}건`}
            <span className="ml-1 text-[10.5px] text-slate-600">
              (PDF/DOCX 본문도 가능한 범위에서 추출해 반영하며, 이미지 중심 파일은 제한될 수 있습니다)
            </span>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "userGroup") {
            inReanalyzeSegment = true;
            lastStage = "intervention";
            return (
              <div key={`ug-${i}`} className="space-y-2 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-400">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-emerald-200" />
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11.5px] font-semibold text-emerald-800">
                    {item.label || stageLabel("intervention")}
                  </span>
                  <div className="h-px flex-1 bg-emerald-200" />
                </div>
                <div className="ml-auto max-w-[74%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-4 py-3 text-sm text-white shadow-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] opacity-85">
                    <span>Round {item.afterRound} 이후</span>
                    <span>·</span>
                    <span>{item.label.includes("4차") ? "종합 라운드에 반영합니다" : "다음 라운드에 반영합니다"}</span>
                    <span>· {item.questions.length}건</span>
                    {item.questions[0]?.createdAt && (
                      <span>· {new Date(item.questions[0].createdAt).toLocaleTimeString("ko-KR")}</span>
                    )}
                  </div>
                  <ol className="list-decimal space-y-1 pl-4">
                    {item.questions.map((q, qi) => (
                      <li key={`${q.createdAt || qi}-${q.message}`} className="break-keep whitespace-pre-wrap">
                        <span className="opacity-80">[{targetAgentLabel(q.targetAgent)}에게 질문] </span>
                        {q.message}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            );
          }
          if (item.kind === "user") {
            // Phase 10.22/10.45 — system 메시지는 시각적으로 명확한 divider 로 표시
            if (item.q.targetAgent === "system") {
              const msg = item.q.message || "";
              // 재검토 시작 / 재검토 완료 / 재검토 실패 / 부분 완료 분기
              const isStart = /시작|REANALYZING|다음 라운드|종합 라운드|재검토를 시작/.test(msg);
              const isFail = /실패|FAILED|문제가 발생/.test(msg);
              const isPartial = /일부|부분|partial/i.test(msg);
              const isDone = /완료|COMPLETED|반영되었습니다/.test(msg) && !isPartial;
              if (isStart) {
                inReanalyzeSegment = true;
              }
              const tone = isFail
                ? { line: "bg-red-300", chip: "border-red-300 bg-red-50 text-red-800", icon: "⚠" }
                : isPartial
                  ? { line: "bg-amber-300", chip: "border-amber-300 bg-amber-50 text-amber-800", icon: "🟡" }
                  : isDone
                    ? { line: "bg-emerald-300", chip: "border-emerald-300 bg-emerald-50 text-emerald-800", icon: "✅" }
                    : { line: "bg-[#1E3A8A]/30", chip: "border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]", icon: "🔁" };
              return (
                <div
                  key={`u-${i}`}
                  className="flex items-center gap-2 pt-2 pb-1 animate-in fade-in slide-in-from-bottom-2 duration-400"
                >
                  <div className={`h-px flex-1 ${tone.line}`} />
                  <div
                    className={`rounded-full border px-3 py-1 text-[11.5px] font-medium shadow-sm ${tone.chip}`}
                  >
                    <span className="mr-1">{tone.icon}</span>
                    <span className="break-keep whitespace-pre-wrap">{msg}</span>
                    {item.q.createdAt && (
                      <span className="ml-2 text-[10px] opacity-70">
                        · {new Date(item.q.createdAt).toLocaleTimeString("ko-KR")}
                      </span>
                    )}
                  </div>
                  <div className={`h-px flex-1 ${tone.line}`} />
                </div>
              );
            }
            return (
              <div key={`u-${i}`} className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-400">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-3 py-2 text-sm text-white shadow-sm">
                  <div className="mb-0.5 text-[10px] opacity-80">
                    🙋 사용자 추가 질문 · 대상: {targetAgentLabel(item.q.targetAgent)}
                    {item.q.createdAt && ` · ${new Date(item.q.createdAt).toLocaleTimeString("ko-KR")}`}
                  </div>
                  <p className="break-keep whitespace-pre-wrap">{item.q.message}</p>
                </div>
              </div>
            );
          }
          const msg = item.msg;
          // Phase 10.45 — backend system 메시지(agentId="system") 가 messages 배열로 오는 경우
          //   → user followUp 의 system divider 와 동일한 양식으로 변환해 렌더
          if (msg.agentId === "system" || msg.type === "system" || msg.type === "error") {
            const text = msg.content || "";
            const isFail = msg.type === "error" || /실패|FAILED|문제가 발생|연결에 실패/.test(text);
            const isPartial = /일부|부분|partial/i.test(text);
            const isDone = /완료|COMPLETED|반영되었습니다/.test(text) && !isPartial && !isFail;
            const isStart = /시작|REANALYZING|다음 라운드|종합 라운드|재검토를 시작/.test(text);
            if (isStart) { inReanalyzeSegment = true; }
            const tone = isFail
              ? { line: "bg-red-300", chip: "border-red-300 bg-red-50 text-red-800", icon: "⚠" }
              : isPartial
                ? { line: "bg-amber-300", chip: "border-amber-300 bg-amber-50 text-amber-800", icon: "🟡" }
                : isDone
                  ? { line: "bg-emerald-300", chip: "border-emerald-300 bg-emerald-50 text-emerald-800", icon: "✅" }
                  : { line: "bg-[#1E3A8A]/30", chip: "border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]", icon: "🔁" };
            return (
              <div key={`a-${i}`} className="flex items-center gap-2 pt-2 pb-1 animate-in fade-in slide-in-from-bottom-2 duration-400">
                <div className={`h-px flex-1 ${tone.line}`} />
                <div className={`rounded-full border px-3 py-1 text-[11.5px] font-medium shadow-sm ${tone.chip} max-w-[80%]`}>
                  <span className="mr-1">{tone.icon}</span>
                  <span className="break-keep whitespace-pre-wrap">{text}</span>
                </div>
                <div className={`h-px flex-1 ${tone.line}`} />
              </div>
            );
          }
          const agKey = resolveAgentKey(msg.agentId, msg.agentName, msg.type);
          const agent = agentMap[agKey] ?? agentMap["legal"];
          const Icon = agent.icon;
          const isJudge = agKey === "judge";
          const roundNo = Number(msg.round || 0);
          const stage: TimelineStage = roundNo >= 1 && roundNo <= 5
            ? roundNo
            : inReanalyzeSegment
              ? "reanalysis"
              : "general";
          const showRoundHeader = stage !== lastStage;
          lastStage = stage;

          return (
            <div key={`a-${i}`} className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-400">
              {showRoundHeader && (
                <div className="flex items-center gap-2 pt-1">
                  <div className={`h-px flex-1 ${typeof stage === "number" && stage >= 2 ? "bg-emerald-200" : "bg-slate-200"}`} />
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    typeof stage === "number" && stage >= 2
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}>
                    {stageLabel(stage)}
                  </span>
                  <div className={`h-px flex-1 ${stage === "reanalysis" ? "bg-emerald-200" : "bg-slate-200"}`} />
                </div>
              )}
              <div className="flex justify-start">
                <div className={`max-w-[78%] rounded-2xl rounded-tl-sm border px-3 py-2 ${agent.bg} ${agent.border} shadow-sm`}>
                  <div className={`text-xs font-medium flex flex-wrap items-center gap-1.5 ${agent.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span>{msg.agentName || agent.name}</span>
                    {/* Phase 10.74 — 내부 type (analysis/concern/recommendation/error) 을 사용자 친화 라벨로 변환 */}
                    {(() => {
                      const tLabel = (() => {
                        switch (msg.type) {
                          case "analysis": return "초기 검토";
                          case "concern": return "보완 의견";
                          case "recommendation": return "최종 판정";
                          case "system": return "시스템 안내";
                          case "error": return "응답 지연";
                          default: return msg.type || "";
                        }
                      })();
                      return tLabel ? (
                        <Badge variant="outline" className="text-[9px] py-0">{tLabel}</Badge>
                      ) : null;
                    })()}
                    <Badge variant="outline" className="text-[9px] py-0">
                      {msg.type === "error" ? "오류 안내" : "완료"}
                    </Badge>
                    <span className="ml-auto text-[10px] text-slate-400">#{i + 1}</span>
                  </div>
                  <div className="mt-1.5">
                    <BubbleContent content={msg.content} isJudge={isJudge} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* 분석 중에만 "다음 에이전트 응답 대기 중" placeholder — 발언자 정보 포함.
            Phase 10.76 — 재검토 segment 일 때는 "사용자 질문 반영" 컨텍스트 명시. */}
        {isAnalyzing && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
              <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />
              {liveStatus.speakingNow
                ? inReanalyzeSegment
                  ? `${agentLabel(liveStatus.speakingNow)}이(가) 사용자 질문을 반영해 검토 중입니다...`
                  : `${agentLabel(liveStatus.speakingNow)}이(가) 앞선 의견을 검토 중입니다...`
                : inReanalyzeSegment
                  ? "다음 에이전트가 사용자 질문을 반영해 응답을 준비 중입니다..."
                  : "다음 에이전트가 응답을 준비 중입니다..."}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} aria-hidden />
      </CardContent>

      {/* Phase 10.21 — 사용자가 위로 스크롤 한 상태에서 새 메시지 도착 시 안내 */}
      {unseenCount > 0 && (
        <button
          type="button"
          onClick={onJumpToBottom}
          className="sticky bottom-4 mx-auto flex items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-[#16306f] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/40"
          aria-label={`새 메시지 ${unseenCount}개로 이동`}
          style={{
            position: "sticky",
            bottom: "16px",
            display: "block",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          ↓ 새 메시지 {unseenCount}개 보기
        </button>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════
   Phase 10.23 — SSE 연결 상태 배지 (작게)
══════════════════════════════════════════ */
function StreamStatusBadge({
  status,
}: {
  status: "connecting" | "open" | "error" | "fallback" | "closed";
}) {
  const cfg = (() => {
    switch (status) {
      case "open":
        return { dot: "bg-emerald-500", text: "실시간 토론 스트림 연결됨", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
      case "connecting":
        return { dot: "bg-amber-400 animate-pulse", text: "실시간 토론 스트림 연결 중", cls: "border-amber-200 bg-amber-50 text-amber-700" };
      case "error":
        return { dot: "bg-orange-400 animate-pulse", text: "실시간 연결 오류 — 자동 복구를 시도합니다", cls: "border-orange-200 bg-orange-50 text-orange-700" };
      case "fallback":
        return { dot: "bg-slate-400", text: "실시간 연결이 불안정하여 주기적으로 상태를 확인합니다", cls: "border-slate-200 bg-slate-50 text-slate-600" };
      case "closed":
        return { dot: "bg-slate-300", text: "토론 스트림 종료 — 결과 화면에서 최종 판정을 확인하세요", cls: "border-slate-200 bg-slate-50 text-slate-500" };
    }
  })();
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] ${cfg.cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      <span>{cfg.text}</span>
    </div>
  );
}
