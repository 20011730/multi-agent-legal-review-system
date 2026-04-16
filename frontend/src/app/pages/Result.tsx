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
  Loader2,
  Scale,
  Shield,
  Zap,
  AlertCircle,
} from "lucide-react";

/* ── 타입 ── */
interface Message {
  agentId: "legal" | "risk" | "ethics";
  content: string;
  type: "analysis" | "concern" | "recommendation" | "user-input" | "error";
  round: number;
}

type AgentId = "legal" | "risk" | "ethics";

const agentMap: Record<
  AgentId,
  {
    name: string;
    icon: typeof Scale;
    color: string;
    bg: string;
    border: string;
  }
> = {
  legal: {
    name: "법무 에이전트",
    icon: Scale,
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  risk: {
    name: "사업 에이전트",
    icon: Shield,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  ethics: {
    name: "윤리 에이전트",
    icon: FileCheck,
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
};

const liveTicker = [
  {
    speaker: "legal" as AgentId,
    text: "에이전트들이 회의실에 입장하여 서류를 검토하기 시작합니다.",
    conflict: false,
  },
  {
    speaker: "risk" as AgentId,
    text: "사업 에이전트가 법무 에이전트의 보수적 태도에 깊은 한숨을 내쉽니다.",
    conflict: true,
  },
  {
    speaker: "ethics" as AgentId,
    text: "윤리 에이전트가 기업 평판 리스크를 근거로 제동을 겁니다.",
    conflict: true,
  },
  {
    speaker: "legal" as AgentId,
    text: "법무 에이전트가 판례집을 뒤적거리며 커피를 리필합니다.",
    conflict: false,
  },
  {
    speaker: "risk" as AgentId,
    text: "사업 에이전트가 숫자를 들이밀며 실행 가능성 반박 자료를 제출합니다.",
    conflict: true,
  },
  {
    speaker: "ethics" as AgentId,
    text: "판정 에이전트가 세 에이전트 의견을 취합해 결론 문안을 정리 중입니다.",
    conflict: false,
  },
];

const getHumorLabel = (progress: number) => {
  if (progress < 30) return "법률 검토 비용 500만 원 절약 중...";
  if (progress < 70) return "대표님의 멘탈 리스크 방어막 구축 중...";
  return "세 명의 전문가를 설득하는 데 성공했습니다!";
};

const POLL_INTERVAL = 4000; // 4초마다 상태 확인

/* ── 컴포넌트 ── */
export function Result() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [error, setError] = useState("");
  const [recheckRequest, setRecheckRequest] = useState<{ target: string; question: string } | null>(null);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [simulatedProgress, setSimulatedProgress] = useState(4);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 정리 함수
  const cleanup = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // 결과 가져오기
  const fetchDebateResult = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(
        `http://localhost:8080/api/sessions/${sessionId}/debates/latest`
      );
      if (!res.ok) throw new Error("토론 결과 조회 실패");
      const result = await res.json();

      // 에러 타입 메시지 체크 (AI 분석 실패 시)
      const hasError = (result.messages || []).some((m: any) => m.type === "error");

      const mapped: Message[] = (result.messages || []).map((m: any) => ({
        agentId: (m.agentId as AgentId) || "legal",
        content: m.content || "",
        type: m.type || "analysis",
        round: m.round || 1,
      }));
      setMessages(mapped);

      if (result.finalDecision) {
        sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
      }
      // 항상 evidences 저장 (빈 배열이라도)
      sessionStorage.setItem("evidences", JSON.stringify(result.evidences || []));

      if (hasError) {
        setError("AI 분석에 실패했습니다. 결과가 제한적일 수 있습니다.");
      }

      setIsComplete(true);
      setSimulatedProgress(100);
      setIsAnalyzing(false);
    } catch (fetchError) {
      console.error(fetchError);
      setError("토론 결과를 불러오는 중 문제가 발생했습니다.");
      setIsAnalyzing(false);
    }
  }, []);

  // 세션 상태 폴링
  const pollSessionStatus = useCallback((sessionId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/status`);
        if (!res.ok) return; // 아직 준비 안됨 → 다음 폴링에서 재시도

        const status = await res.json();

        if (status.status === "COMPLETED") {
          cleanup();
          await fetchDebateResult(sessionId);
        } else if (status.status === "FAILED") {
          cleanup();
          setError("분석에 실패했습니다. 다시 시도해주세요.");
          setIsAnalyzing(false);
        }
        // ANALYZING → 계속 폴링
      } catch {
        // 네트워크 오류 → 다음 폴링에서 재시도
      }
    };

    poll(); // 즉시 한 번
    pollRef.current = setInterval(poll, POLL_INTERVAL);
  }, [cleanup, fetchDebateResult]);

  // 메인 useEffect: 세션 상태 확인 + 폴링 시작
  useEffect(() => {
    const reviewDataRaw = sessionStorage.getItem("reviewData");
    if (!reviewDataRaw) {
      navigate("/input");
      return;
    }

    const recheckRaw = sessionStorage.getItem("recheckRequest");
    if (recheckRaw) {
      try {
        setRecheckRequest(JSON.parse(recheckRaw));
      } catch {
        setRecheckRequest(null);
      }
    }

    const sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) {
      setError("세션 정보를 찾을 수 없습니다.");
      setIsAnalyzing(false);
      return;
    }

    // 폴링 시작 (ANALYZING이면 계속 폴링, COMPLETED면 즉시 결과 가져옴)
    setIsAnalyzing(true);
    pollSessionStatus(sessionId);

    return () => cleanup();
  }, [navigate, cleanup, pollSessionStatus]);

  // 경과 시간 타이머
  useEffect(() => {
    if (!isAnalyzing) return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isAnalyzing]);

  // 로딩 애니메이션 (티커 + 진행률)
  useEffect(() => {
    if (!isAnalyzing) return;

    const tickerTimer = window.setInterval(() => {
      setTickerIndex((prev) => (prev + 1) % liveTicker.length);
    }, 5600);

    const progressTimer = window.setInterval(() => {
      setSimulatedProgress((prev) => {
        if (prev >= 97) return prev;
        if (prev < 30) return Math.min(prev + (2 + Math.floor(Math.random() * 4)), 97);
        if (prev < 70) return Math.min(prev + Math.floor(Math.random() * 3), 97);
        return Math.min(prev + Math.floor(Math.random() * 2), 97);
      });
    }, 1500);

    return () => {
      window.clearInterval(tickerTimer);
      window.clearInterval(progressTimer);
    };
  }, [isAnalyzing]);

  const ticker = liveTicker[tickerIndex];
  const humorLabel = useMemo(() => getHumorLabel(simulatedProgress), [simulatedProgress]);
  const groupedRounds = useMemo(() => {
    const rounds: Record<number, Message[]> = {};
    messages.forEach((msg) => {
      if (!rounds[msg.round]) rounds[msg.round] = [];
      rounds[msg.round].push(msg);
    });
    return rounds;
  }, [messages]);

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  };

  // ── 렌더링 ──
  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900">
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
              최종 판정 보기
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">
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
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#1E3A8A]" />
                  실시간 중계
                </CardTitle>
                <CardDescription>지금 에이전트들이 어떤 논점을 다투고 있는지 보여드립니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-4">
                  <p className="text-sm text-slate-700">{ticker.text}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>대시보드 펄스</CardTitle>
                <CardDescription>현재 발언 중인 에이전트를 시각적으로 표시합니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center gap-8 py-3">
                  {(Object.keys(agentMap) as AgentId[]).map((agentId) => {
                    const agent = agentMap[agentId];
                    const Icon = agent.icon;
                    const isActive = ticker.speaker === agentId;
                    return (
                      <div key={agentId} className="relative text-center">
                        {isActive && <span className="absolute -inset-2 rounded-full border-2 border-[#1E3A8A]/35 animate-ping" />}
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

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>진행 게이지</CardTitle>
                <CardDescription>{humorLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span>토론 진행률</span>
                  <span className="font-medium">{simulatedProgress}%</span>
                </div>
                <Progress value={simulatedProgress} className="h-2" />
                <div className="mt-3 text-sm text-slate-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  서버에서 멀티 에이전트 토론을 수행 중입니다...
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── 에러 표시 ── */}
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
                <Button onClick={() => {
                  sessionStorage.removeItem("sessionId");
                  navigate("/input");
                }}>다시 시도</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── AI 분석 실패 경고 (결과는 있지만 에러 메시지 포함) ── */}
        {isComplete && error && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-amber-800 font-medium">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
              <p className="text-sm text-amber-700 mt-1">
                판정 결과 페이지에서 상세 내용을 확인해 주세요.
              </p>
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
                에이전트들이 나눈 {messages.length}개의 논쟁 로그가 준비되었습니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full" onClick={() => navigate("/verdict")}>
                  판정 결과 보기
                  <ArrowRight className="w-4 h-4 ml-2" />
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
                    const agent = agentMap[msg.agentId];
                    if (!agent) return null;
                    const Icon = agent.icon;
                    return (
                      <div key={`${round}-${idx}`} className={`rounded-xl border p-3 ${agent.bg} ${agent.border}`}>
                        <div className={`text-sm font-medium flex items-center gap-2 ${agent.color}`}>
                          <Icon className="w-4 h-4" />
                          {agent.name}
                          <Badge variant="outline" className="ml-1 text-xs">{msg.type}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!isAnalyzing && isComplete && (
          <div className="text-center text-sm text-slate-500">

          </div>
        )}

      </main>
    </div>
  );
}
