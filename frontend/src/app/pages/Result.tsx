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

/* ── 에이전트 맵 (judge 추가, ethics 호환) ── */
type AgentKey = "legal" | "risk" | "ethics" | "judge";

const agentMap: Record<
  AgentKey,
  { name: string; icon: typeof Scale; color: string; bg: string; border: string }
> = {
  legal: {
    name: "법률 전문가",
    icon: Scale,
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  risk: {
    name: "비즈니스 전략가",
    icon: Shield,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
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
const dashboardAgents: AgentKey[] = ["risk", "legal", "ethics"];

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
    label: "라운드 1 — 비즈니스 전략가 분석 중",
    description: "사업적 가치와 실행 가능성을 분석하고 있습니다.",
    progress: 15,
    activeAgent: "risk",
    humourLabel: "AI 에이전트가 공고와 입력 자료를 검토하고 있습니다.",
  },
  ROUND1_LEGAL: {
    label: "라운드 1 — 법률 전문가 검토 중",
    description: "법적 리스크와 규정 위반 가능성을 검토하고 있습니다.",
    progress: 30,
    activeAgent: "legal",
    humourLabel: "AI 에이전트가 공고와 입력 자료를 검토하고 있습니다.",
  },
  ROUND2_BIZ: {
    label: "라운드 2 — 비즈니스 전략가 반박 중",
    description: "법률 전문가의 지적에 대해 반박 자료를 준비하고 있습니다.",
    progress: 40,
    activeAgent: "risk",
    humourLabel: "에이전트 간 쟁점이 교차 검증되고 있습니다.",
  },
  ROUND2_LEGAL: {
    label: "라운드 2 — 법률 전문가 재반박 중",
    description: "비즈니스 전략가의 반박에 법적 근거로 재반박하고 있습니다.",
    progress: 55,
    activeAgent: "legal",
    humourLabel: "에이전트 간 쟁점이 교차 검증되고 있습니다.",
  },
  ROUND3_BIZ: {
    label: "라운드 3 — 비즈니스 전략가 최종 입장 정리 중",
    description: "지금까지의 논점을 종합하여 최선의 실행 방안을 도출하고 있습니다.",
    progress: 68,
    activeAgent: "risk",
    humourLabel: "세 번의 논쟁 끝에 합의점에 가까워졌습니다!",
  },
  ROUND3_LEGAL: {
    label: "라운드 3 — 법률 전문가 최종 권고 정리 중",
    description: "법적 리스크를 최소화하는 최종 권고안을 준비하고 있습니다.",
    progress: 80,
    activeAgent: "legal",
    humourLabel: "세 번의 논쟁 끝에 합의점에 가까워졌습니다!",
  },
  JUDGING: {
    label: "최종 판정 생성 중",
    description: "양측 토론을 종합하여 최종 판정문을 작성하고 있습니다.",
    progress: 88,
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
  { speaker: "risk" as AgentKey,   text: "에이전트들이 회의실에 입장하여 서류를 검토하기 시작합니다.",     conflict: false },
  { speaker: "risk" as AgentKey,   text: "사업 에이전트가 법무 에이전트의 보수적 태도에 깊은 한숨을 내쉽니다.", conflict: true },
  { speaker: "ethics" as AgentKey, text: "윤리 에이전트가 기업 평판 리스크를 근거로 제동을 겁니다.",          conflict: true },
  { speaker: "legal" as AgentKey,  text: "법무 에이전트가 판례집을 뒤적거리며 커피를 리필합니다.",              conflict: false },
  { speaker: "risk" as AgentKey,   text: "사업 에이전트가 숫자를 들이밀며 실행 가능성 반박 자료를 제출합니다.", conflict: true },
  { speaker: "ethics" as AgentKey, text: "판정 에이전트가 세 에이전트 의견을 취합해 결론 문안을 정리 중입니다.", conflict: false },
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
    case "business":
    case "risk": return "비즈니스 전략가";
    case "legal": return "법률 전문가";
    case "ethics": return "리스크 검토자";
    case "judge": return "최종 판정관";
    case "system": return "시스템 안내";
    default: return v;
  }
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
    sanitized = sanitized.trim();
    sanitized = (sanitized ? sanitized + "\n\n" : "") +
      "ℹ️ AI 모델 서버가 준비되지 않아 일부 분석이 규칙 기반 검토 초안으로 표시될 수 있습니다.";
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

/* ══════════════════════════════════════════
   Result 컴포넌트
══════════════════════════════════════════ */
export function Result() {
  const navigate = useNavigate();

  const [messages, setMessages]               = useState<Message[]>([]);
  const [isComplete, setIsComplete]           = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
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
  const [userFollowUps, setUserFollowUps] = useState<Array<{
    targetAgent?: string;
    message: string;
    createdAt?: string;
    // Phase 10.38 — 재검토 반영 상태: 저장됨 → 재검토 중 → 반영 완료 / 다시 시도 필요
    reanalyzeStatus?: "pending" | "in-progress" | "completed" | "reflected" | "partial" | "failed";
  }>>([]);

  // Phase 10.20 — 재분석 완료 후 1회성 안내 배너 ("이번 재검토에는 사용자 추가 질문 N건이 반영되었습니다")
  const [reanalyzeBadge, setReanalyzeBadge] = useState<{ count: number; at: string } | null>(null);
  const wasReanalyzingRef = useRef(false);

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

  // Phase 10.21/10.22/10.51 — staged reveal (준토큰 chunk streaming fallback).
  // - 분석 중: 80~280ms 간격으로 1개씩 등장 → 한 chunk 가 늘어나는 카카오톡식 느낌.
  // - 완료(isComplete) 상태에서 페이지 재진입/리로드 시: 즉시 전체 표시.
  // - backlog 누적 시 간격 단축으로 따라잡음.
  useEffect(() => {
    if (visibleCount >= messages.length) return;
    if (isCompleteRef.current) {
      setVisibleCount(messages.length);
      return;
    }
    const backlog = messages.length - visibleCount;
    const interval = backlog >= 5 ? 80 : backlog >= 3 ? 160 : 280;
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
      }
      sessionStorage.setItem("evidences", JSON.stringify(result.evidences || []));

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
        const fromBackend = (result.followUpQuestions as Array<{
          targetAgent?: string; message?: string; createdAt?: string; reanalyzeStatus?: string;
        }>)
          .filter((q) => q?.targetAgent !== "system" && q?.message)
          .map((q) => ({
            targetAgent: q.targetAgent,
            message: q.message as string,
            createdAt: q.createdAt,
            reanalyzeStatus: (q.reanalyzeStatus as
              | "pending" | "in-progress" | "completed" | "reflected" | "partial" | "failed"
              | undefined) ?? "pending",
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
        const trueFailure = healthyCore < 4 && mapped.some((m) => m.type === "error" || errPat.test(m.content || ""));
        if (trueFailure) setError("일부 검토 단계에서 문제가 발생했습니다. 기존 검토 결과는 유지됩니다. 잠시 후 다시 시도하거나 기존 결과로 최종 리포트를 확인할 수 있습니다.");
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
          // Phase 10.18 — 재분석 진행 중. 기존 메시지가 백엔드에서 삭제되므로 fetchedCount 리셋.
          setCurrentPhase((prev) => ({
            ...prev,
            label: "후속 질문 반영 재분석 중",
            description: "사용자 추가 질문을 포함한 새 분석을 진행하고 있습니다. 잠시만 기다려 주세요.",
            progress: Math.max(prev.progress, 30),
          }));
          isCompleteRef.current = false;
          setIsComplete(false);
          setIsAnalyzing(true);
          wasReanalyzingRef.current = true;  // Phase 10.20 — 완료 시 배너 노출 트리거
          // Phase 10.38 — REANALYZING 전이 시 모든 pending 질문을 "in-progress" 로 표시
          setUserFollowUps((prev) =>
            prev.map((q) =>
              q.targetAgent === "system" ? q : { ...q, reanalyzeStatus: "in-progress" as const },
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
          await fetchDebateResult(sessionId, true);
          // Phase 10.20 — REANALYZING → COMPLETED 전이 시 1회성 배너 표시
          if (wasReanalyzingRef.current) {
            wasReanalyzingRef.current = false;
            setReanalyzeBadge({
              count: userFollowUps.length || 1,
              at: new Date().toISOString(),
            });
            // Phase 10.38 — 성공 시 in-progress 질문 → "reflected"
            // Phase 10.45 — 토론 타임라인에 "재검토 완료" divider 시스템 메시지 추가
            const completionMsg = {
              targetAgent: "system",
              message: "✅ 재검토 완료 — 추가 질문이 반영된 새 결과가 준비되었습니다.",
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
                (q) => q.targetAgent === "system" && /재검토 완료/.test(q.message || ""),
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
          // Phase 10.27 — 실패 시 기존 결과 보존 안내 추가
          setError("분석에 실패했습니다. 기존 결과는 유지됩니다. 잠시 후 다시 시도하거나 서버 상태를 확인하세요.");
          setIsAnalyzing(false);
          // Phase 10.38 — 재검토 실패 시 in-progress → "failed" + /verdict 안내용 persist
          if (wasReanalyzingRef.current) {
            wasReanalyzingRef.current = false;
            // Phase 10.45 — 실패 divider
            const failMsg = {
              targetAgent: "system",
              message: "⚠ 재검토 실패 — 기존 결과를 기준으로 표시합니다.",
              createdAt: new Date().toISOString(),
            };
            setUserFollowUps((prev) => {
              const updated = prev.map((q) =>
                q.targetAgent === "system" || q.reanalyzeStatus === "reflected"
                  ? q
                  : { ...q, reanalyzeStatus: "failed" as const },
              );
              const hasFail = updated.some(
                (q) => q.targetAgent === "system" && /재검토 실패/.test(q.message || ""),
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

    const recheckRaw = sessionStorage.getItem("recheckRequest");
    if (recheckRaw) {
      try { setRecheckRequest(JSON.parse(recheckRaw)); } catch { setRecheckRequest(null); }
    }

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
      seenMessageKeysRef.current.add(k);
      setMessages((prev) => [
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
      ]);
      fetchedCountRef.current += 1;
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
          wasReanalyzingRef.current = true;
          // 새 분석 시작 — 메시지 중복 키 캐시 일부 초기화 (system 메시지 제외)
          seenMessageKeysRef.current = new Set();
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
      let metaOnly = 0;
      let masked = 0;
      for (const a of list) {
        const s = a?.extractionStatus;
        // Phase 10.51 — extractionStatus 확장:
        //   ok / extracted / partial (PDF/DOCX 서버 추출 성공) / pending-server-extract → 본문 반영
        //   skipped-unsupported / skipped-too-large / failed / error → 메타만
        if (a?.bodyText || s === "ok" || s === "extracted" || s === "partial" || s === "pending-server-extract") {
          withBody += 1;
        } else {
          metaOnly += 1;
        }
        if (Array.isArray(a?.sensitivityFlags) && a.sensitivityFlags.length > 0) masked += 1;
      }
      return { total: list.length, withBody, metaOnly, masked };
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

    const nextSpeakerOrder: AgentKey[] = ["risk", "legal", "judge"];
    let speakingNow: AgentKey | undefined;
    let nextUp: AgentKey | undefined;

    if (!lastMsg) {
      speakingNow = "risk";
      nextUp = "legal";
    } else {
      const lastAg = (lastMsg.agentId === "ethics" || lastMsg.agentId === "judge")
        ? "judge"
        : (lastMsg.agentId as AgentKey);
      const idx = nextSpeakerOrder.indexOf(lastAg);
      if (idx < 0) {
        speakingNow = activeAgentId;
        nextUp = undefined;
      } else if (lastAg === "judge") {
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
      if (visible.length >= 5) return "Round 3 · 최종 권고 정리";
      if (visible.length >= 4) return "Round 2 · 쟁점 조율";
      if (visible.length >= 2) return "Round 1 · 초기 분석";
      return `Round ${currentRound}`;
    })();

    const roundDescription = (() => {
      if (!isAnalyzing) return "토론이 완료되었습니다.";
      if (!speakingNow) return currentPhase.description;
      const labels: Record<string, string> = {
        risk: "비즈니스 전략가가 사업 관점 리스크를 분석 중입니다.",
        legal: "법률 전문가가 관련 법령·판례 근거와 위반 가능성을 점검 중입니다.",
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
              재검토 요청 반영: {recheckRequest.target} / {recheckRequest.question || "추가 질문 없음"}
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
            {/* 실시간 중계 */}
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#1E3A8A]" />
                  실시간 중계
                </CardTitle>
                <CardDescription>{currentPhase.label}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-4">
                  <p className="text-sm text-slate-700">{currentPhase.description}</p>
                </div>
                <p className="text-xs text-slate-400 mt-2 italic">{ticker.text}</p>
              </CardContent>
            </Card>

            {/* 대시보드 펄스 */}
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>대시보드 펄스</CardTitle>
                <CardDescription>현재 발언 중인 에이전트를 시각적으로 표시합니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center gap-8 py-3">
                  {dashboardAgents.map((agentId) => {
                    const agent = agentMap[agentId];
                    const Icon = agent.icon;
                    const isActive = activeAgentId === agentId
                      || (agentId === "ethics" && activeAgentId === "judge");
                    return (
                      <div key={agentId} className="relative text-center">
                        {isActive && (
                          <span className="absolute -inset-2 rounded-full border-2 border-[#1E3A8A]/35 animate-ping" />
                        )}
                        <div className={`relative w-16 h-16 rounded-full border flex items-center justify-center ${agent.bg} ${agent.border}`}>
                          <Icon className={`w-6 h-6 ${agent.color}`} />
                        </div>
                        <p className="text-xs mt-2 text-slate-600">{agent.name}</p>
                      </div>
                    );
                  })}
                </div>
                {ticker.conflict && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-amber-700 text-sm">
                    <Zap className="w-4 h-4" />
                    에이전트 간 논쟁이 격화되고 있습니다.
                  </div>
                )}
                {/* Phase 10.32 — 현재 발언 중 안내 (사용자 친화 문구) */}
                {liveStatus.speakingNow && (
                  <p className="mt-3 text-center text-[12px] text-[#1E3A8A]">
                    <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />
                    {liveStatus.roundDescription}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* 진행 게이지 — 실제 phase 기반 */}
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>진행 게이지</CardTitle>
                <CardDescription>{currentPhase.humourLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span>토론 진행률</span>
                  <span className="font-medium">{currentPhase.progress}%</span>
                </div>
                <Progress value={currentPhase.progress} className="h-2" />
                <div className="mt-3 text-sm text-slate-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {currentPhase.description}
                </div>
              </CardContent>
            </Card>

            {/* Phase 10.23 — SSE 연결 상태 배지 */}
            <StreamStatusBadge status={streamStatus} />
            {/* Phase 10.35 — 진행 중 provisional agent 말풍선.
                10.33 의 messages.length === 0 조건이 너무 빨리 사라지던 문제 해결:
                실제 서버 메시지가 3개 미만이거나 아직 분석 중일 때는 provisional 도 함께 표시 →
                사용자가 끊김 없이 단계별 에이전트 검토 흐름을 인지 가능. */}
            {(messages.length < 3 || (isAnalyzing && messages.length < 5)) && (() => {
              type ProvAgent = "risk" | "legal" | "ethics" | "judge";
              // Phase 10.46 — 사용자 친화 문구로 정렬. 진행률 구간별로 다른 에이전트가 검토 중인 느낌을 명확히 노출.
              const provisional: Array<{ ag: ProvAgent; text: string; activeAt: number }> = [
                { ag: "risk", text: "비즈니스 전략가가 사업 관점 리스크를 검토 중입니다.", activeAt: 10 },
                { ag: "legal", text: "법률 전문가가 협약 조건과 개인정보 처리 가능성을 확인 중입니다.", activeAt: 30 },
                { ag: "ethics", text: "리스크 검토자가 정산·환수·중복 수혜 가능성을 점검 중입니다.", activeAt: 60 },
                { ag: "judge", text: "최종 판정관이 검토 의견을 종합하고 있습니다.", activeAt: 85 },
              ];
              // Phase 10.35 — 실제 메시지 존재 시 제목 보정 (provisional + 실시간 메시지 병존 안내)
              const hasRealMsgs = messages.length > 0;
              const titleByProgress =
                hasRealMsgs ? "AI 검토팀 진행 단계 (실제 토론은 아래에 표시)" :
                currentPhase.progress >= 80 ? "AI 검토팀이 마무리 검토 중" :
                currentPhase.progress >= 25 ? "AI 검토팀이 순차 검토 중" :
                "AI 검토팀 준비 중";
              return (
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                      {titleByProgress}
                    </CardTitle>
                    <CardDescription>
                      검토 진행 상황이 실시간으로 업데이트됩니다. AI 검토팀의 의견이 순차적으로 표시됩니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2.5">
                      {provisional.map((p, i) => {
                        const ag = agentMap[p.ag];
                        const Icon = ag.icon;
                        const active = currentPhase.progress >= p.activeAt;
                        const isSpeaking = active && (i === provisional.length - 1 || currentPhase.progress < provisional[i + 1].activeAt);
                        return (
                          <div
                            key={i}
                            className={`flex justify-start ${active ? "opacity-100" : "opacity-40"}`}
                          >
                            <div className={`max-w-[88%] rounded-2xl rounded-tl-sm border px-3 py-2 ${ag.bg} ${ag.border} shadow-sm`}>
                              <div className={`text-xs font-medium flex flex-wrap items-center gap-1.5 ${ag.color}`}>
                                <Icon className="w-3.5 h-3.5" />
                                <span>{ag.name}</span>
                                {isSpeaking && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-slate-500">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    검토 중
                                  </span>
                                )}
                                {active && !isSpeaking && (
                                  <span className="text-[10px] text-emerald-700">✓ 1차 정리 완료</span>
                                )}
                              </div>
                              <p className="mt-1 text-[13px] text-slate-700 leading-relaxed">{p.text}</p>
                            </div>
                          </div>
                        );
                      })}
                      <p className="mt-1 text-[11px] text-slate-500">
                        💡 검토 중에도 아래에서 추가 질문을 남길 수 있습니다. 실제 토론 내용은 곧 이 영역에 순차적으로 표시됩니다.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
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
                <AlertCircle className="w-5 h-5" /> 추가 질문 반영 재검토를 완료하지 못했습니다
              </div>
              <p className="text-sm text-amber-700 mt-1">
                기존 검토 결과는 유지됩니다. 잠시 후 다시 시도하거나, 기존 결과로 최종 리포트를 확인할 수 있습니다.
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
                {/* Phase 10.31 — 사용자 친화 문구로 정제 */}
                {reanalyzeBadge
                  ? "최근 재검토 결과가 최종 리포트에 반영되었습니다. 아래 버튼으로 최종 판정을 확인하세요."
                  : `에이전트별 검토 결과 ${messages.filter((m) => m.type !== "error").length}건이 정리되었습니다. 최종 리포트를 확인할 준비가 되었습니다.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full" onClick={() => navigate("/verdict")}>
                  판정 결과 보기 <ArrowRight className="w-4 h-4 ml-2" />
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
        {showDetailedLogs && !isAnalyzing && messages.length > 0 && (
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
        {userFollowUps.length > 0 && (
          <Card className="border-slate-200 bg-white">
            <CardContent className="space-y-2 py-4">
              <div className="mb-1 text-sm font-semibold text-slate-700">
                사용자 추가 질문 ({userFollowUps.length}건)
              </div>
              {userFollowUps.filter((q) => q.targetAgent !== "system").map((q, i) => {
                // Phase 10.56 — 질문별 상태 chip (반영 완료 / 일부 반영 / 재검토 반영 대기 / 다시 시도 필요 / 재검토 중)
                const rs = q.reanalyzeStatus;
                const chip = (() => {
                  if (rs === "completed" || rs === "reflected") return { label: "반영 완료", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
                  if (rs === "partial") return { label: "일부 반영", cls: "border-sky-200 bg-sky-50 text-sky-700" };
                  if (rs === "failed") return { label: "다시 시도 필요", cls: "border-red-200 bg-red-50 text-red-700" };
                  if (rs === "in-progress") return { label: "재검토 중", cls: "border-blue-200 bg-blue-50 text-blue-700" };
                  return { label: "다음 재검토 반영 대기", cls: "border-amber-200 bg-amber-50 text-amber-800" };
                })();
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-3 py-2 text-sm text-white shadow-sm">
                        <div className="mb-0.5 text-[10px] opacity-80">
                          대상: {targetAgentLabel(q.targetAgent)} {q.createdAt && `· ${new Date(q.createdAt).toLocaleTimeString("ko-KR")}`}
                        </div>
                        <p className="break-keep">{q.message}</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${chip.cls}`}>{chip.label}</span>
                    </div>
                  </div>
                );
              })}
              <p className="mt-1 text-[11px] text-slate-500">
                ※ 추가 질문을 남기고 <strong>질문 반영해 재검토</strong> 버튼을 누르면, 다음 라운드 토론과 최종 리포트에 반영됩니다.
                기존 라운드 1 토론은 그대로 유지되고, 새 라운드가 아래에 이어집니다.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Phase 10.6/10.11/10.31 — 라운드 사이 사용자 개입 영역. 분석 중/완료 상태 전달. */}
        {messages.length > 0 && !error && (
          <RoundInterventionBlock
            startupContext={startupContext}
            lastRoundMessages={Object.values(groupedRounds).pop() ?? []}
            isAnalyzing={isAnalyzing}
            onQuestionSaved={(q) => setUserFollowUps((prev) => [...prev, q])}
            onReanalyzeStarted={(sessionId) => {
              // Phase 10.18 — 부모 스코프의 polling 재시작 (REANALYZING 상태 추적)
              isCompleteRef.current = false;
              setIsComplete(false);
              setIsAnalyzing(true);
              // Phase 10.22 — 시스템 메시지로 "추가 질문 반영 재검토 시작" 즉시 표시.
              // 사용자 질문 버블과 구분되도록 user follow-up 영역에 시스템 항목으로 prepend.
              setUserFollowUps((prev) => [
                ...prev,
                {
                  targetAgent: "system",
                  message: "🔁 추가 질문을 반영해 재검토를 시작합니다. 기존 토론 기록은 새 결과로 갱신됩니다.",
                  createdAt: new Date().toISOString(),
                },
              ]);
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
  onQuestionSaved?: (q: { targetAgent: string; message: string; createdAt: string }) => void;
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

  // Phase 10.17/10.18 — "재검토 실행" — 저장된 followUpQuestions 로 backend 재분석 트리거.
  // 단순 alert 대신 inline status 로 표시 + poll 재시작.
  const handleReanalyze = async () => {
    const sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) return;
    setFollowUpStatus("reanalyzing");
    setFollowUpStatusMsg("재분석 요청 중...");
    try {
      const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFollowUpStatus("reanalyzed");
        setFollowUpStatusMsg(
          `재분석을 시작했습니다 (질문 ${data.followUpCount ?? "여러"}건 반영). 새 메시지가 도착하면 자동으로 표시됩니다.`,
        );
        // polling 재시작 — 부모 콜백에 위임 (REANALYZING 상태 추적)
        onReanalyzeStarted?.(sessionId);
      } else {
        setFollowUpStatus("failed");
        setFollowUpStatusMsg(data.error || "재검토 실행에 실패했습니다.");
      }
    } catch (e) {
      console.error("[reanalyze] 실패", e);
      setFollowUpStatus("failed");
      setFollowUpStatusMsg("재검토 요청 중 네트워크 오류가 발생했습니다.");
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
    { value: "ethics", label: "리스크 검토자" },
    { value: "judge", label: "최종 판정관" },
  ];

  const handleSubmit = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setFollowUpStatus("saving");
    setFollowUpStatusMsg("질문 저장 중...");
    // sessionStorage (즉시 표시용)
    try {
      sessionStorage.setItem(
        "recheckRequest",
        JSON.stringify({ target, question: trimmed }),
      );
    } catch {
      /* ignore */
    }
    // Phase 10.9 — 백엔드에 영구 저장 시도 (sessionId 가 있을 때만)
    const createdAt = new Date().toISOString();
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
      // Phase 10.21 — 자동 reanalyze 제거. 사용자가 "질문 반영해 재검토" 를 직접 누르도록 분리.
      setFollowUpStatusMsg(
        isAnalyzing
          ? "질문이 저장되었습니다. 현재 검토가 끝난 뒤 재검토에 반영할 수 있습니다."
          : "질문이 저장되었습니다. '질문 반영해 재검토'를 누르면 새 검토가 기존 토론 아래에 이어집니다.",
      );
    } else {
      setFollowUpStatus("failed");
      setFollowUpStatusMsg("백엔드 저장 실패 (로컬에만 저장됨). 재분석에 반영되지 않을 수 있습니다.");
    }
    // Phase 10.11 — 부모 컴포넌트에 알림 → 채팅 로그 말풍선으로 즉시 렌더
    if (onQuestionSaved) {
      onQuestionSaved({ targetAgent: target, message: trimmed, createdAt });
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
          추가로 물어볼 내용이 있나요?
        </div>
        <p className="text-xs text-slate-600">
          {/* Phase 10.30/10.31 — 사용자 친화 + 분석 진행/완료 상태별 안내 */}
          비서가 제안하는 질문을 클릭해 입력하거나 직접 작성한 뒤 전송할 수 있습니다.{" "}
          선택한 에이전트의 발언과 현재 쟁점을 바탕으로 추천 질문을 제안합니다.
          {isAnalyzing
            ? " 검토가 진행되는 동안 질문을 저장하면 현재 검토가 끝난 뒤 재검토에 반영할 수 있습니다."
            : " 질문을 저장한 뒤 '질문 반영해 재검토'를 누르면 기존 토론 아래에 새 검토가 이어집니다."}
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
            placeholder="추가 질문을 입력하세요 (예: 사업비 정산 시 우리가 놓치기 쉬운 부분은?)"
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
                현재는 저장 상태입니다. '질문 반영해 재검토' 를 누르면 이 질문이 AI 분석에 포함됩니다.
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
          {submitted && (
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={followUpStatus === "reanalyzing"}
              className="rounded-md border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16306f] disabled:opacity-50"
              title="저장된 질문을 즉시 AI 분석에 포함해 재검토를 시작합니다."
            >
              {followUpStatus === "reanalyzing"
                ? "재검토 시작 중..."
                : followUpStatus === "reanalyzed"
                ? "✓ 재검토 진행 중 (자동 갱신)"
                : "🔁 질문 반영해 재검토"}
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
            {followUpStatus === "reanalyzed" && "🔁 "}
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
  userFollowUps: Array<{ targetAgent?: string; message: string; createdAt?: string }>;
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
  // Phase 10.21 — staged reveal: 부모가 계산한 visibleCount 만큼만 표시.
  const visibleMessages = messages.slice(0, visibleCount);
  // 라운드 + 시간순으로 메시지/유저질문을 통합한 타임라인 항목 만들기
  type Item =
    | { kind: "agent"; msg: Message; idx: number }
    | { kind: "user"; q: { targetAgent?: string; message: string; createdAt?: string }; idx: number };
  const items: Item[] = [
    ...visibleMessages.map((m, i) => ({ kind: "agent" as const, msg: m, idx: i })),
    ...userFollowUps.map((q, i) => ({ kind: "user" as const, q, idx: i })),
  ];
  // 사용자 질문은 createdAt 이 있는 경우만 정렬에 사용; 없으면 끝에 배치.
  items.sort((a, b) => {
    const ta = a.kind === "user" ? (a.q.createdAt ? Date.parse(a.q.createdAt) : Infinity) : a.idx;
    const tb = b.kind === "user" ? (b.q.createdAt ? Date.parse(b.q.createdAt) : Infinity) : b.idx;
    // agent 메시지는 항상 순서대로, user 질문은 시간 기준으로 끼워넣기
    if (a.kind === "agent" && b.kind === "agent") return a.idx - b.idx;
    return ta < tb ? -1 : 1;
  });

  let lastRound = -1;
  // Phase 10.27 — 재검토 시점 추적. system 메시지 등장 후의 라운드는 "재검토 · 라운드 N" 로 표시.
  let inReanalyzeSegment = false;
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
            🔁 이번 재검토에는 사용자 추가 질문 {reanalyzeBadge.count}건이 반영되었습니다 ·{" "}
            {new Date(reanalyzeBadge.at).toLocaleTimeString("ko-KR")}
          </div>
        )}
        {/* Phase 10.20 — 첨부자료 분석 반영 요약 */}
        {attachmentsSummary && (
          <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[12px] text-sky-900">
            📎 첨부자료 {attachmentsSummary.total}건을 함께 검토합니다 — 본문 반영 {attachmentsSummary.withBody}건, 메타데이터만 {attachmentsSummary.metaOnly}건
            {attachmentsSummary.masked > 0 && ` · 민감정보 자동 마스킹 ${attachmentsSummary.masked}건`}
            <span className="ml-1 text-[10.5px] text-slate-600">
              (PDF/DOCX 본문 일부도 추출해 검토에 반영합니다 — 본문 분석이 어려운 항목은 파일명·유형만 참고)
            </span>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "user") {
            // Phase 10.22/10.45 — system 메시지는 시각적으로 명확한 divider 로 표시
            if (item.q.targetAgent === "system") {
              const msg = item.q.message || "";
              // 재검토 시작 / 재검토 완료 / 재검토 실패 / 부분 완료 분기
              const isStart = /시작|REANALYZING|재검토를 시작/.test(msg);
              const isFail = /실패|FAILED|문제가 발생/.test(msg);
              const isPartial = /일부|부분|partial/i.test(msg);
              const isDone = /완료|COMPLETED|반영되었습니다/.test(msg) && !isPartial;
              if (isStart) {
                inReanalyzeSegment = true;
                lastRound = -1;
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
            const isStart = /시작|REANALYZING|재검토를 시작/.test(text);
            if (isStart) { inReanalyzeSegment = true; lastRound = -1; }
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
          const agKey = (msg.agentId === "ethics" || msg.agentId === "judge") ? "judge" : (msg.agentId as AgentKey);
          const agent = agentMap[agKey] ?? agentMap["legal"];
          const Icon = agent.icon;
          const isJudge = agKey === "judge";
          const showRoundHeader = msg.round !== lastRound;
          lastRound = msg.round;

          return (
            <div key={`a-${i}`} className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-400">
              {showRoundHeader && (
                <div className="flex items-center gap-2 pt-1">
                  <div className={`h-px flex-1 ${inReanalyzeSegment ? "bg-emerald-200" : "bg-slate-200"}`} />
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    inReanalyzeSegment
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}>
                    {isJudge
                      ? (inReanalyzeSegment ? "재검토 · 최종 판정" : "최종 판정")
                      : (inReanalyzeSegment ? `재검토 · 라운드 ${msg.round}` : `라운드 ${msg.round}`)}
                  </span>
                  <div className={`h-px flex-1 ${inReanalyzeSegment ? "bg-emerald-200" : "bg-slate-200"}`} />
                </div>
              )}
              <div className="flex justify-start">
                <div className={`max-w-[88%] rounded-2xl rounded-tl-sm border px-3 py-2 ${agent.bg} ${agent.border} shadow-sm`}>
                  <div className={`text-xs font-medium flex flex-wrap items-center gap-1.5 ${agent.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span>{msg.agentName || agent.name}</span>
                    <Badge variant="outline" className="text-[9px] py-0">{msg.type}</Badge>
                    <span className="ml-auto text-[10px] text-slate-400">#{i + 1}</span>
                  </div>
                  <div className="mt-1.5 text-sm text-slate-800">
                    {isJudge ? renderJudgeContent(msg.content) : renderAgentContent(msg.content)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* 분석 중에만 "다음 에이전트 응답 대기 중" placeholder — 발언자 정보 포함 */}
        {isAnalyzing && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-2xl rounded-tl-sm border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
              <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />
              {liveStatus.speakingNow
                ? `${agentLabel(liveStatus.speakingNow)}이(가) 입력 중입니다...`
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

