import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Textarea } from "../components/ui/textarea";
import {
  Scale,
  ArrowRight,
  Scale as LegalIcon,
  Shield,
  FileCheck,
  Loader2,
  CheckCircle,
  User,
  Send,
  MessageSquare,
  BookOpen,
  AlertCircle,
} from "lucide-react";

/* ── 타입 ── */
interface Agent {
  id: string;
  name: string;
  role: string;
  icon: typeof LegalIcon;
  color: string;
  bgColor: string;
  borderColor: string;
}

interface Message {
  agentId: string | "user";
  timestamp: number;
  content: string;
  type: "analysis" | "concern" | "recommendation" | "user-input";
  round?: number;
}

type AnalysisPhase =
  | "creating"
  | "session-created"  // 세션 생성 완료, AI 분석 대기
  | "debating"
  | "evidence"
  | "judging"
  | "complete"
  | "error";

/* ── 상수 ── */
const agents: Agent[] = [
  {
    id: "legal",
    name: "법률 전문가",
    role: "Legal Counsel",
    icon: Scale,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    id: "risk",
    name: "리스크 관리자",
    role: "Risk Manager",
    icon: Shield,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  {
    id: "ethics",
    name: "윤리 검토자",
    role: "Ethics Reviewer",
    icon: FileCheck,
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
  },
];

const POLL_INTERVAL = 4000; // 4초마다 상태 확인

const phaseConfig: Record<string, { label: string; description: string; progress: number }> = {
  creating:        { label: "세션 생성 중",             description: "분석 요청을 서버에 전달하고 있습니다...",        progress: 5 },
  "session-created": { label: "세션 생성 완료",         description: "AI 에이전트 분석을 시작합니다...",              progress: 10 },
  debating:        { label: "멀티 에이전트 토론 진행 중", description: "법률·비즈니스 에이전트가 다각도로 검토하고 있습니다", progress: 30 },
  evidence:        { label: "법령·판례 조회 중",         description: "관련 법률과 판례를 검색하고 있습니다",           progress: 60 },
  judging:         { label: "최종 판정 작성 중",         description: "종합 판정 보고서를 생성하고 있습니다",           progress: 85 },
  complete:        { label: "분석 완료",                description: "모든 에이전트의 검토가 완료되었습니다",           progress: 100 },
  error:           { label: "분석 실패",                description: "오류가 발생했습니다",                          progress: 0 },
};

/* ── 단계 정보 ── */
const phaseSteps = [
  { key: "debating", icon: MessageSquare, label: "멀티 에이전트 토론 진행" },
  { key: "evidence", icon: BookOpen, label: "법령·판례 근거 조회" },
  { key: "judging", icon: Scale, label: "최종 판정 작성" },
];

const phaseOrder = ["creating", "session-created", "debating", "evidence", "judging", "complete"];

/* ── 컴포넌트 ── */
export function Result() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [participationMode, setParticipationMode] = useState<"observe" | "participate">("observe");
  const [waitingForUserInput, setWaitingForUserInput] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [allRounds, setAllRounds] = useState<Message[][]>([]);
  const [phase, setPhase] = useState<AnalysisPhase>("creating");
  const [errorMessage, setErrorMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 메시지가 추가되면 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 경과 시간 타이머
  useEffect(() => {
    if (phase === "complete" || phase === "error") return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // 분석 중 단계 시각 애니메이션 (체감 속도 개선용)
  useEffect(() => {
    if (phase !== "session-created" && phase !== "debating") return;

    const visualPhases: AnalysisPhase[] = ["debating", "evidence", "judging"];
    let idx = phase === "debating" ? 0 : -1;

    phaseTimerRef.current = setInterval(() => {
      idx = Math.min(idx + 1, visualPhases.length - 1);
      setPhase((prev) => {
        // 실제 complete면 바꾸지 않음
        if (prev === "complete" || prev === "error") return prev;
        return visualPhases[idx];
      });
    }, 10000); // 10초마다 단계 전환

    return () => { if (phaseTimerRef.current) clearInterval(phaseTimerRef.current); };
  }, [phase]);

  // 정리 함수
  const cleanup = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (phaseTimerRef.current) { clearInterval(phaseTimerRef.current); phaseTimerRef.current = null; }
  }, []);

  // 세션 상태 폴링
  const pollSessionStatus = useCallback((sessionId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}/status`);
        if (!res.ok) return; // 아직 생성 안됨 → 다음 폴링에서 재시도

        const status = await res.json();

        if (status.status === "COMPLETED") {
          // 분석 완료 → 결과 가져오기
          cleanup();
          await fetchDebateResult(sessionId);
        } else if (status.status === "FAILED") {
          cleanup();
          setPhase("error");
          setErrorMessage("분석에 실패했습니다. 다시 시도해주세요.");
        }
        // ANALYZING 상태 → 계속 폴링 (자동으로 다음 interval에서 실행)
      } catch {
        // 네트워크 오류 → 무시하고 다음 폴링에서 재시도
      }
    };

    // 즉시 한 번 + 이후 interval
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);
  }, [cleanup]);

  // 결과 가져오기
  const fetchDebateResult = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(
        `http://localhost:8080/api/sessions/${sessionId}/debates/latest`
      );
      if (!res.ok) throw new Error("결과 조회 실패");
      const result = await res.json();

      // messages를 round 기준으로 그룹핑
      const grouped: Record<number, Message[]> = {};
      result.messages.forEach((msg: any) => {
        const round = msg.round || 1;
        if (!grouped[round]) grouped[round] = [];
        grouped[round].push({
          agentId: msg.agentId,
          timestamp: Date.now() + grouped[round].length,
          content: msg.content,
          type: msg.type || "analysis",
          round,
        });
      });

      const rounds = Object.keys(grouped)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => grouped[Number(key)]);

      setAllRounds(rounds);

      // sessionStorage에 저장
      if (result.finalDecision) {
        sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
      }
      if (result.evidences && result.evidences.length > 0) {
        sessionStorage.setItem("evidences", JSON.stringify(result.evidences));
      }

      setPhase("complete");
    } catch (err) {
      console.error("결과 조회 실패:", err);
      setPhase("error");
      setErrorMessage("분석 결과를 불러오는데 실패했습니다.");
    }
  }, []);

  // 1단계: 페이지 진입 → 세션 생성 + 폴링 시작
  useEffect(() => {
    const reviewData = sessionStorage.getItem("reviewData");
    if (!reviewData) {
      navigate("/input");
      return;
    }

    const data = JSON.parse(reviewData);
    setParticipationMode(data.participationMode || "observe");

    // 이미 완료된 세션이면 결과만 가져오기
    const existingSessionId = sessionStorage.getItem("sessionId");
    if (existingSessionId) {
      setPhase("debating");
      pollSessionStatus(existingSessionId);
      return;
    }

    // 새 세션 생성
    createSession(data);

    return () => cleanup();
  }, [navigate, cleanup, pollSessionStatus]);

  async function createSession(formData: Record<string, string>) {
    try {
      const user = JSON.parse(localStorage.getItem("legalreview_currentUser") || "{}");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user.id) headers["X-User-Id"] = String(user.id);

      setPhase("creating");

      const res = await fetch("http://localhost:8080/api/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);

      const result = await res.json();
      const newSessionId = String(result.sessionId);
      sessionStorage.setItem("sessionId", newSessionId);

      // 세션 생성 완료 → 폴링 시작
      setPhase("debating");
      pollSessionStatus(newSessionId);
    } catch (err) {
      console.error("세션 생성 실패:", err);
      setPhase("error");
      setErrorMessage("분석 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  // 메시지 순차 표시 애니메이션
  useEffect(() => {
    if (waitingForUserInput || isComplete) return;
    if (allRounds.length === 0) return;

    if (currentRound > allRounds.length) {
      setIsComplete(true);
      setProgress(100);
      return;
    }

    const currentRoundMessages = allRounds[currentRound - 1];

    if (currentMessageIndex >= currentRoundMessages.length) {
      if (currentRound >= allRounds.length) {
        setIsComplete(true);
        setProgress(100);
        return;
      }

      if (participationMode === "participate") {
        setWaitingForUserInput(true);
        return;
      }

      const timeout = setTimeout(() => {
        setCurrentRound(currentRound + 1);
        setCurrentMessageIndex(0);
      }, 1500);
      return () => clearTimeout(timeout);
    }

    const timeout = setTimeout(() => {
      const nextMessage = currentRoundMessages[currentMessageIndex];
      setMessages((prev) => [...prev, nextMessage]);
      const totalMessages = allRounds.flat().length;
      setProgress(((messages.length + 1) / totalMessages) * 100);
      setCurrentMessageIndex(currentMessageIndex + 1);
    }, 1200);
    return () => clearTimeout(timeout);
  }, [currentRound, currentMessageIndex, waitingForUserInput, isComplete, participationMode, allRounds, messages.length]);

  const handleUserSubmit = () => {
    if (!userInput.trim()) return;
    const userMessage: Message = {
      agentId: "user",
      timestamp: Date.now(),
      content: userInput,
      type: "user-input",
      round: currentRound,
    };
    setMessages((msgs) => [...msgs, userMessage]);
    setUserInput("");
    setCurrentRound((prev) => prev + 1);
    setCurrentMessageIndex(0);
    setWaitingForUserInput(false);
  };

  const handleSkipInput = () => {
    setCurrentRound((prev) => prev + 1);
    setCurrentMessageIndex(0);
    setWaitingForUserInput(false);
  };

  const getAgent = (agentId: string) => agents.find((a) => a.id === agentId);

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "concern":
        return <Badge variant="destructive" className="text-xs">쟁점</Badge>;
      case "recommendation":
        return <Badge className="bg-green-600 text-xs">권고</Badge>;
      case "user-input":
        return <Badge className="bg-purple-600 text-xs">사용자 의견</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">분석</Badge>;
    }
  };

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  };

  // ── 분석 진행 중 화면 ──
  if (phase !== "complete" && phase !== "error" && allRounds.length === 0) {
    const phaseInfo = phaseConfig[phase] || phaseConfig.debating;
    const currentPhaseIdx = phaseOrder.indexOf(phase);

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <button onClick={() => navigate("/")} className="flex items-center gap-3 hover:opacity-70 transition-opacity">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                <Scale className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <h1 className="font-semibold text-gray-900">LegalReview AI</h1>
                <p className="text-xs text-gray-500">Multi-Agent Legal Compliance System</p>
              </div>
            </button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">{phaseInfo.label}</h2>
            <p className="text-gray-600">{phaseInfo.description}</p>
            <p className="text-sm text-gray-400 mt-2">
              경과 시간: {formatElapsed(elapsedSeconds)}
            </p>
          </div>

          <Card className="border-gray-200 mb-8">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">분석 진행률</span>
                <span className="text-sm font-medium text-blue-600">{phaseInfo.progress}%</span>
              </div>
              <Progress value={phaseInfo.progress} className="h-2 mb-6" />

              <div className="space-y-3">
                {phaseSteps.map((step) => {
                  const Icon = step.icon;
                  const stepIdx = phaseOrder.indexOf(step.key);
                  const isDone = currentPhaseIdx > stepIdx;
                  const isActive = currentPhaseIdx === stepIdx;

                  return (
                    <div key={step.key} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                      isActive ? "bg-blue-50 border border-blue-200" :
                      isDone ? "bg-green-50 border border-green-200" :
                      "bg-gray-50 border border-gray-100"
                    }`}>
                      {isActive ? (
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                      ) : isDone ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      )}
                      <span className={`text-sm font-medium ${
                        isActive ? "text-blue-700" : isDone ? "text-green-700" : "text-gray-500"
                      }`}>
                        {step.label}
                      </span>
                      {isActive && (
                        <span className="text-xs text-blue-500 ml-auto">진행 중...</span>
                      )}
                      {isDone && (
                        <span className="text-xs text-green-500 ml-auto">완료</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-gray-500">
            AI 에이전트가 다각도로 검토 중입니다. 보통 30초~2분 정도 소요됩니다.
          </p>
        </main>
      </div>
    );
  }

  // ── 에러 화면 ──
  if (phase === "error") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">분석 실패</h2>
          <p className="text-gray-600 mb-6">{errorMessage}</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/")}>홈으로</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                sessionStorage.removeItem("sessionId");
                navigate("/input");
              }}
            >
              다시 시도
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── 결과 표시 화면 (토론 로그 + 순차 표시) ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 hover:opacity-70 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="font-semibold text-gray-900">LegalReview AI</h1>
              <p className="text-xs text-gray-500">Multi-Agent Legal Compliance System</p>
            </div>
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/reviews")}>
              <BookOpen className="mr-2 w-4 h-4" />
              검토 이력
            </Button>
            {isComplete && (
              <Button
                onClick={() => navigate("/verdict")}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                최종 판정 보기
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-semibold text-gray-900 mb-2">
                에이전트 토의 {isComplete ? "완료" : "진행중"}
              </h2>
              <p className="text-gray-600">
                {participationMode === "participate"
                  ? "다수의 AI 에이전트가 검토를 진행하고 있습니다. 각 라운드 후 의견을 추가할 수 있습니다."
                  : "다수의 AI 에이전트가 다각도로 검토를 진행하고 있습니다"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-100 text-blue-700">
                라운드 {Math.min(currentRound, allRounds.length)} / {allRounds.length}
              </Badge>
              {elapsedSeconds > 0 && (
                <Badge variant="outline" className="text-gray-500">
                  {formatElapsed(elapsedSeconds)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <Card className="border-gray-200 mb-8">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">검토 진행률</span>
              <span className="text-sm font-medium text-blue-600">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            {!isComplete && !waitingForUserInput && (
              <div className="flex items-center gap-2 mt-4 text-sm text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>에이전트가 분석 중입니다...</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agents Overview */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {agents.map((agent) => {
            const Icon = agent.icon;
            const agentMessages = messages.filter((m) => m.agentId === agent.id);
            const isActive = messages.length > 0 && messages[messages.length - 1].agentId === agent.id;

            return (
              <Card
                key={agent.id}
                className={`border-2 transition-all ${
                  isActive ? `${agent.borderColor} shadow-lg scale-105` : "border-gray-200"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 ${agent.bgColor} rounded-lg flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${agent.color}`} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <p className="text-xs text-gray-500">{agent.role}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{agentMessages.length}</span>개 메시지
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Discussion Timeline */}
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle>토의 로그</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {messages.map((message, index) => {
                if (message.agentId === "user") {
                  return (
                    <div key={index} className="flex gap-4 p-4 rounded-lg border-l-4 border-purple-200 bg-purple-50 animate-in fade-in slide-in-from-bottom-4">
                      <div className="w-10 h-10 bg-purple-100 border border-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-purple-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-purple-700">사용자 의견</span>
                          {getTypeBadge(message.type)}
                          <span className="text-xs text-gray-500">라운드 {message.round} 종료 후</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{message.content}</p>
                      </div>
                    </div>
                  );
                }

                const agent = getAgent(message.agentId);
                if (!agent) return null;
                const Icon = agent.icon;

                return (
                  <div key={index} className={`flex gap-4 p-4 rounded-lg border-l-4 ${agent.borderColor} ${agent.bgColor} animate-in fade-in slide-in-from-bottom-4`}>
                    <div className={`w-10 h-10 ${agent.bgColor} border ${agent.borderColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-5 h-5 ${agent.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`font-medium ${agent.color}`}>{agent.name}</span>
                        {getTypeBadge(message.type)}
                        <span className="text-xs text-gray-500">라운드 {message.round}</span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* User Input Section */}
            {waitingForUserInput && (
              <div className="mt-6 p-6 bg-purple-50 border-2 border-purple-200 rounded-lg animate-in fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare className="w-5 h-5 text-purple-600" />
                  <h4 className="font-semibold text-gray-900">라운드 {currentRound} 종료 - 의견 입력</h4>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  에이전트들의 분석에 대해 질문하거나 반박할 내용이 있으신가요?
                </p>
                <Textarea
                  placeholder="예: '2배 빠른 성능'은 당사의 내부 벤치마크 테스트 결과입니다..."
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  className="min-h-[100px] bg-white mb-4"
                />
                <div className="flex gap-3">
                  <Button onClick={handleUserSubmit} className="bg-purple-600 hover:bg-purple-700 text-white" disabled={!userInput.trim()}>
                    <Send className="mr-2 w-4 h-4" />의견 제출
                  </Button>
                  <Button onClick={handleSkipInput} variant="outline">건너뛰기</Button>
                </div>
              </div>
            )}

            {!isComplete && !waitingForUserInput && messages.length > 0 && (
              <div className="flex items-center gap-2 mt-6 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>다음 에이전트 응답 대기중...</span>
              </div>
            )}

            {isComplete && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">토의가 완료되었습니다</span>
                </div>
                <p className="text-sm text-green-700 mt-1">
                  모든 에이전트의 분석이 완료되었습니다. 최종 판정 보고서를 확인하세요.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
