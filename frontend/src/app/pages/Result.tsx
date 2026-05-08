import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
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
    humourLabel: "법률 검토 비용 500만 원 절약 중...",
  },
  ROUND1_LEGAL: {
    label: "라운드 1 — 법률 전문가 검토 중",
    description: "법적 리스크와 규정 위반 가능성을 검토하고 있습니다.",
    progress: 30,
    activeAgent: "legal",
    humourLabel: "법률 검토 비용 500만 원 절약 중...",
  },
  ROUND2_BIZ: {
    label: "라운드 2 — 비즈니스 전략가 반박 중",
    description: "법률 전문가의 지적에 대해 반박 자료를 준비하고 있습니다.",
    progress: 40,
    activeAgent: "risk",
    humourLabel: "대표님의 멘탈 리스크 방어막 구축 중...",
  },
  ROUND2_LEGAL: {
    label: "라운드 2 — 법률 전문가 재반박 중",
    description: "비즈니스 전략가의 반박에 법적 근거로 재반박하고 있습니다.",
    progress: 55,
    activeAgent: "legal",
    humourLabel: "대표님의 멘탈 리스크 방어막 구축 중...",
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
  label: "AI 에이전트 분석 준비 중",
  description: "잠시만 기다려주세요...",
  progress: 5,
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
function renderAgentContent(content: string) {
  return content.split("\n").map((line, i) => {
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

  const pollRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchedCountRef   = useRef(0);          // 마지막으로 가져온 메시지 수
  const isCompleteRef     = useRef(false);

  /* ── 정리 ── */
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

      // 새 메시지만 누적
      if (mapped.length > fetchedCountRef.current) {
        fetchedCountRef.current = mapped.length;
        setMessages(mapped);
      }

      if (result.finalDecision) {
        sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
      }
      sessionStorage.setItem("evidences", JSON.stringify(result.evidences || []));

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

        // 실제 단계 반영
        if (status.analysisPhase && phaseMap[status.analysisPhase]) {
          setCurrentPhase(phaseMap[status.analysisPhase]);
        }

        // 새 메시지가 생겼으면 부분 조회 (분석 중에도 실시간 갱신)
        if (status.messageCount > fetchedCountRef.current && !isCompleteRef.current) {
          await fetchDebateResult(sessionId, false);
        }

        if (status.status === "COMPLETED") {
          cleanup();
          await fetchDebateResult(sessionId, true);
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
    pollSessionStatus(sessionId);
    return () => cleanup();
  }, [navigate, cleanup, pollSessionStatus]);

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

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}분 ${sec}초` : `${sec}초`;
  };

  /* ── 활성 에이전트: 실제 phase 우선, phase 없으면 ticker speaker ── */
  const activeAgentId: AgentKey | undefined =
    currentPhase.activeAgent ??
    (isAnalyzing ? ticker.speaker : undefined);

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

            {/* 분석 중 부분 메시지 미리보기 (새 메시지 있으면 표시) */}
            {messages.length > 0 && (
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>토론 진행 중 로그 ({messages.length}건)</CardTitle>
                  <CardDescription>분석이 완료되면 전체 로그가 표시됩니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {messages.slice(-3).map((msg, idx) => {
                    const agKey = (msg.agentId === "ethics" || msg.agentId === "judge") ? "judge" : msg.agentId as AgentKey;
                    const agent = agentMap[agKey] ?? agentMap["legal"];
                    const Icon = agent.icon;
                    const isJudge = agKey === "judge";
                    return (
                      <div key={idx} className={`rounded-xl border p-3 ${agent.bg} ${agent.border}`}>
                        <div className={`text-sm font-medium flex items-center gap-2 ${agent.color}`}>
                          <Icon className="w-4 h-4" />
                          {msg.agentName || agent.name}
                          <Badge variant="outline" className="ml-1 text-xs">{msg.type}</Badge>
                          <span className="text-xs text-slate-400 ml-auto">라운드 {msg.round}</span>
                        </div>
                        <div className="mt-2">
                          {isJudge ? renderJudgeContent(msg.content) : renderAgentContent(msg.content)}
                        </div>
                      </div>
                    );
                  })}
                  {messages.length > 3 && (
                    <p className="text-xs text-slate-400 text-center">+{messages.length - 3}개 더 있음 — 완료 후 전체 보기</p>
                  )}
                </CardContent>
              </Card>
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

        {/* ── 토론 로그 상세 ── */}
        {showDetailedLogs && !isAnalyzing && (
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>토론 로그 상세 보기</CardTitle>
              <CardDescription>전체 로그는 판정 결과 창에서도 확인 가능합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {Object.entries(groupedRounds).map(([round, roundMessages]) => (
                <div key={round} className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700">라운드 {round}</p>
                  {roundMessages.map((msg, idx) => {
                    const agKey = (msg.agentId === "ethics" || msg.agentId === "judge") ? "judge" : msg.agentId as AgentKey;
                    const agent = agentMap[agKey] ?? agentMap["legal"];
                    const Icon = agent.icon;
                    const isJudge = agKey === "judge";
                    return (
                      <div key={`${round}-${idx}`} className={`rounded-xl border p-3 ${agent.bg} ${agent.border}`}>
                        <div className={`text-sm font-medium flex items-center gap-2 ${agent.color}`}>
                          <Icon className="w-4 h-4" />
                          {msg.agentName || agent.name}
                          <Badge variant="outline" className="ml-1 text-xs">{msg.type}</Badge>
                        </div>
                        <div className="mt-2">
                          {isJudge ? renderJudgeContent(msg.content) : renderAgentContent(msg.content)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
}
