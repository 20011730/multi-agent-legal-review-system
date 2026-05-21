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
    name: "최종 판정관",
    icon: Gavel,
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
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
    description: "법제처 공공 API에서 관련 법령과 판례를 검색하고 있습니다.",
    progress: 95,
    humourLabel: "세 명의 전문가를 설득하는 데 성공했습니다!",
  },
};

const defaultPhase: PhaseInfo = {
  label: "세션 생성 및 입력 분석 중",
  description: "사용자 입력·공고 컨텍스트·첨부 자료를 분석 페이로드에 합치고 있습니다.",
  progress: 10,
  humourLabel: "법률 검토 비용 500만 원 절약 중...",
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
  // Phase 10.11 — 사용자 추가 질문 누적 (sessionStorage + 즉시 표시용)
  const [userFollowUps, setUserFollowUps] = useState<Array<{
    targetAgent?: string;
    message: string;
    createdAt?: string;
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

  // Phase 10.21/10.22 — staged reveal.
  // - 분석 중: ~350ms 간격으로 1개씩 등장.
  // - 완료(isComplete) 상태에서 페이지 재진입/리로드 시: 한꺼번에 즉시 표시 (사용자 답답함 방지).
  // - 5개 이상 한꺼번에 밀려있으면 reveal 간격을 단축해 따라잡기.
  useEffect(() => {
    if (visibleCount >= messages.length) return;
    if (isCompleteRef.current) {
      // 이미 완료 → 즉시 전체 표시
      setVisibleCount(messages.length);
      return;
    }
    const backlog = messages.length - visibleCount;
    const interval = backlog >= 5 ? 120 : backlog >= 3 ? 220 : 350;
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

      if (isFinal) {
        const hasError = mapped.some((m) => m.type === "error");
        if (hasError) setError("AI 분석에 실패했습니다. 결과가 제한적일 수 있습니다.");
        setIsComplete(true);
        isCompleteRef.current = true;
        setCurrentPhase({ label: "분석 완료", description: "모든 에이전트의 검토가 완료되었습니다.", progress: 100, humourLabel: "세 명의 전문가를 설득하는 데 성공했습니다!" });
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
                  label: "세션 생성 및 입력 분석 중",
                  description: "Python AI 서버에 분석 요청을 전송하고 보조 컨텍스트(공고/첨부/추가 질문)를 주입하고 있습니다.",
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
          }
        } else if (status.status === "FAILED") {
          cleanup();
          setError("분석에 실패했습니다. 다시 시도해주세요.");
          setIsAnalyzing(false);
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
          description: "치열한 토론 끝에 결론이 도출되었습니다.",
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

  /* ── 경과 시간 타이머 ── */
  useEffect(() => {
    if (!isAnalyzing) return;
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
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
        if (a?.bodyText || a?.extractionStatus === "ok") withBody += 1;
        else metaOnly += 1;
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

        {/* ── AI 분석 실패 경고 (결과는 있지만 에러 포함) ── */}
        {isComplete && error && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-amber-800 font-medium">
                <AlertCircle className="w-5 h-5" /> {error}
              </div>
              <p className="text-sm text-amber-700 mt-1">판정 결과 페이지에서 상세 내용을 확인해 주세요.</p>
            </CardContent>
          </Card>
        )}

        {/* ── 분석 완료 ── */}
        {!isAnalyzing && isComplete && !error && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-emerald-800 font-medium">
                <CheckCircle2 className="w-5 h-5" />
                치열한 토론 끝에 결론이 도출되었습니다.
              </div>
              <p className="text-sm text-emerald-700 mt-2">
                에이전트들이 나눈 {messages.filter((m) => m.type !== "error").length}개의 논쟁 로그가 준비되었습니다.
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
              {userFollowUps.map((q, i) => (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-3 py-2 text-sm text-white shadow-sm">
                    <div className="mb-0.5 text-[10px] opacity-80">
                      대상: {q.targetAgent ?? "전체"} {q.createdAt && `· ${new Date(q.createdAt).toLocaleTimeString("ko-KR")}`}
                    </div>
                    <p className="break-keep">{q.message}</p>
                  </div>
                </div>
              ))}
              <p className="mt-1 text-[11px] text-slate-500">
                ※ 추가 질문은 저장되어 후속 재검토 / 최종 결과 보완 시 반영됩니다.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Phase 10.6/10.11 — 라운드 사이 사용자 개입 영역 */}
        {messages.length > 0 && !error && (
          <RoundInterventionBlock
            startupContext={startupContext}
            lastRoundMessages={Object.values(groupedRounds).pop() ?? []}
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

  // Phase 10.6 — startupContext 와 직전 라운드 키워드 기반 deterministic 추천 질문 3개
  const suggestions = useMemo(() => {
    if (startupContext) {
      const base = [
        "이 지원사업에서 사업비를 외주 용역비로 사용할 때 주의할 점을 더 구체적으로 검토해주세요.",
        "성과물의 지식재산권이 우리 회사에 귀속되는지 확인하려면 어떤 조항을 봐야 하나요?",
        "협약 해지나 지원금 환수 위험이 발생할 수 있는 조건을 정리해주세요.",
      ];
      // 직전 라운드 본문에 특정 키워드가 있으면 우선 순위 조정
      const hay = lastRoundMessages
        .map((m) => m.content)
        .join(" ")
        .toLowerCase();
      if (hay.includes("개인정보") || hay.includes("데이터")) {
        return [
          "참가자/고객/근로자 개인정보를 수집할 때 동의·보관·제3자 제공 측면에서 확인해야 할 사항을 알려주세요.",
          ...base.slice(0, 2),
        ];
      }
      if (hay.includes("고용") || hay.includes("외주") || hay.includes("청년")) {
        return [
          "사업비로 인력을 고용하거나 외주를 줄 때 근로계약·도급 구분 측면에서 점검할 사항을 알려주세요.",
          ...base.slice(0, 2),
        ];
      }
      return base;
    }
    return [
      "방금 토론 내용에서 가장 중요한 리스크 3가지를 우선순위대로 정리해주세요.",
      "법무 관점에서 추가로 확인이 필요한 조항이 있다면 어떤 것인가요?",
      "사업 관점에서 이 결정이 미치는 단기/장기 영향을 비교해주세요.",
    ];
  }, [startupContext, lastRoundMessages]);

  const targetOptions = [
    { value: "all", label: "전체 에이전트" },
    { value: "legal", label: "법률 전문가" },
    { value: "business", label: "비즈니스 전략가" },
    { value: "ethics", label: "리스크 검토자" },
    { value: "judge", label: "조정자/사회자" },
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
        "질문이 저장되었습니다. 다음 재검토 요청에 반영됩니다. '질문 반영해 재검토' 버튼을 누르면 즉시 AI 분석에 포함됩니다.",
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
          비서가 제안하는 질문을 클릭해 입력하거나 직접 작성한 뒤 전송할 수 있습니다.
          질문은 다음 라운드 또는 재검토 요청에 반영됩니다.
        </p>

        {/* 비서 추천 질문 chips */}
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setQuestion(s)}
              className="rounded-full border border-[#1E3A8A]/25 bg-[#1E3A8A]/5 px-3 py-1 text-[12px] text-[#1E3A8A] hover:bg-[#1E3A8A] hover:text-white"
              aria-label={`추천 질문 ${i + 1} 입력창에 채우기`}
            >
              {s.length > 50 ? s.slice(0, 50) + "..." : s}
            </button>
          ))}
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
            {submitted ? "💾 질문 업데이트" : "💾 질문 저장"}
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
            📎 첨부자료 {attachmentsSummary.total}건이 분석에 반영되었습니다 — 본문 추출 {attachmentsSummary.withBody}건, 메타데이터만 {attachmentsSummary.metaOnly}건
            {attachmentsSummary.masked > 0 && ` · 민감정보 자동 마스킹 ${attachmentsSummary.masked}건`}
            <span className="ml-1 text-[10.5px] text-slate-600">
              (본문 추출은 텍스트 파일만 — PDF/DOCX 는 파일명·유형만 참고됨)
            </span>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "user") {
            // Phase 10.22 — system 메시지는 가운데 정렬 + 회색 톤으로 별도 표시
            if (item.q.targetAgent === "system") {
              return (
                <div key={`u-${i}`} className="flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-400">
                  <div className="max-w-[88%] rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-600">
                    <span className="break-keep whitespace-pre-wrap">{item.q.message}</span>
                    {item.q.createdAt && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        · {new Date(item.q.createdAt).toLocaleTimeString("ko-KR")}
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={`u-${i}`} className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-400">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1E3A8A] px-3 py-2 text-sm text-white shadow-sm">
                  <div className="mb-0.5 text-[10px] opacity-80">
                    🙋 사용자 추가 질문 · 대상: {item.q.targetAgent ?? "전체"}
                    {item.q.createdAt && ` · ${new Date(item.q.createdAt).toLocaleTimeString("ko-KR")}`}
                  </div>
                  <p className="break-keep whitespace-pre-wrap">{item.q.message}</p>
                </div>
              </div>
            );
          }
          const msg = item.msg;
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
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                    {isJudge ? "최종 판정" : `라운드 ${msg.round}`}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
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

