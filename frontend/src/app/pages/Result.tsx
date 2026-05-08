import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Textarea } from "../components/ui/textarea";
import { Activity, ArrowRight, CheckCircle2, FileCheck, Loader2, MessageSquare, Scale, Shield, UserCircle2, Zap } from "lucide-react";
import {
  buildMockDebatePayload,
  createMockSessionId,
  getMockReviewDetail,
  type MockReviewData,
  type RecheckRequest,
  saveMockReviewDetail,
} from "../utils/mockReviewData";

interface Message {
  agentId: "legal" | "risk" | "ethics";
  content: string;
  type: string;
  round: number;
}

type AgentId = "legal" | "risk" | "ethics";

interface LiveDebateEntry {
  id: number;
  speaker: AgentId | "user";
  content: string;
  createdAt: string;
  kind: "agent" | "user";
}

interface DebateResultPayload {
  messages: Message[];
  finalDecision: unknown;
  evidences: unknown;
  usingMockData: boolean;
}

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

export function Result() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isFetchingDebate, setIsFetchingDebate] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [error, setError] = useState("");
  const [recheckRequest, setRecheckRequest] = useState<{ target: string; question: string } | null>(null);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [simulatedProgress, setSimulatedProgress] = useState(4);
  const [userTurnState, setUserTurnState] = useState<"waiting" | "open" | "done">("waiting");
  const [interventionInput, setInterventionInput] = useState("");
  const [liveDebateEntries, setLiveDebateEntries] = useState<LiveDebateEntry[]>([]);
  const [interventionEntries, setInterventionEntries] = useState<LiveDebateEntry[]>([]);
  const [resolvedPayload, setResolvedPayload] = useState<DebateResultPayload | null>(null);
  const [isServerResolved, setIsServerResolved] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const reviewDataRaw = sessionStorage.getItem("reviewData");
    if (!reviewDataRaw) {
      navigate("/input");
      return;
    }

    let reviewData: MockReviewData;
    try {
      reviewData = JSON.parse(reviewDataRaw) as MockReviewData;
    } catch {
      navigate("/input");
      return;
    }

    const recheckRaw = sessionStorage.getItem("recheckRequest");
    let parsedRecheck: RecheckRequest | null = null;
    if (recheckRaw) {
      try {
        parsedRecheck = JSON.parse(recheckRaw) as RecheckRequest;
        setRecheckRequest(parsedRecheck);
      } catch {
        setRecheckRequest(null);
      }
    }

    const rawSessionId = sessionStorage.getItem("sessionId");
    const numericSessionId = Number(rawSessionId) || createMockSessionId();
    if (!rawSessionId) {
      sessionStorage.setItem("sessionId", String(numericSessionId));
      sessionStorage.setItem("usingMockData", "true");
    }

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const minInteractiveMs = 9000;

    const run = async () => {
      setIsFetchingDebate(true);
      setIsServerResolved(false);
      setResolvedPayload(null);
      const startedAt = Date.now();
      try {
        const res = await fetch(`http://localhost:8080/api/sessions/${numericSessionId}/debates/latest`);
        if (!res.ok) throw new Error("토론 결과 조회 실패");
        const result = await res.json();

        const elapsed = Date.now() - startedAt;
        if (elapsed < minInteractiveMs) {
          await wait(minInteractiveMs - elapsed);
        }
        if (!isMounted) return;

        const mapped: Message[] = (result.messages || []).map((m: any) => ({
          agentId: (m.agentId as AgentId) || "legal",
          content: m.content || "",
          type: m.type || "analysis",
          round: m.round || 1,
        }));
        setResolvedPayload({
          messages: mapped,
          finalDecision: result.finalDecision,
          evidences: result.evidences,
          usingMockData: false,
        });
        setIsServerResolved(true);
      } catch (fetchError) {
        console.error(fetchError);
        const elapsed = Date.now() - startedAt;
        if (elapsed < minInteractiveMs) {
          await wait(minInteractiveMs - elapsed);
        }
        if (!isMounted) return;

        const existingDetail = getMockReviewDetail(numericSessionId);
        const mockPayload = existingDetail
          ? {
              messages: existingDetail.messages,
              finalDecision: existingDetail.finalDecision,
              evidences: existingDetail.evidences,
            }
          : buildMockDebatePayload(reviewData, parsedRecheck);

        setResolvedPayload({
          messages: mockPayload.messages,
          finalDecision: mockPayload.finalDecision,
          evidences: mockPayload.evidences,
          usingMockData: true,
        });
        setIsServerResolved(true);

        if (!existingDetail) {
          saveMockReviewDetail({
            sessionId: numericSessionId,
            companyName: reviewData.companyName || "데모 기업",
            industry: reviewData.industry || "etc",
            reviewType: reviewData.reviewType || "contract",
            situation: reviewData.situation || "서버 연결 없이 결과 확인용 데모 요청",
            content: reviewData.content || "",
            participationMode: "observe",
            status: "COMPLETED",
            createdAt: new Date().toISOString(),
            messages: mockPayload.messages,
            finalDecision: mockPayload.finalDecision,
            evidences: mockPayload.evidences,
          });
        }
      } finally {
        if (!isMounted) return;
        setSimulatedProgress((prev) => Math.min(prev, 96));
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!isFetchingDebate) return;

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
  }, [isFetchingDebate]);

  useEffect(() => {
    if (!isFetchingDebate) return;

    setLiveDebateEntries([
      {
        id: Date.now(),
        speaker: "legal",
        content: "에이전트 토론이 시작되었습니다. 모든 에이전트가 1회씩 발언하면 사용자 질문 차례가 열립니다.",
        createdAt: new Date().toISOString(),
        kind: "agent",
      },
    ]);
    setInterventionEntries([]);
    setInterventionInput("");
    setUserTurnState("waiting");
  }, [isFetchingDebate]);

  useEffect(() => {
    if (!isFetchingDebate) return;

    const scripted: AgentId[] = ["risk", "ethics"];
    let scriptedIdx = 0;
    const streamTimer = window.setInterval(() => {
      const scriptedSpeaker = scripted[scriptedIdx];
      if (scriptedSpeaker) scriptedIdx += 1;
      const item = scriptedSpeaker
        ? liveTicker.find((entry) => entry.speaker === scriptedSpeaker) || liveTicker[0]
        : liveTicker[Math.floor(Math.random() * liveTicker.length)];
      const nextEntry: LiveDebateEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        speaker: item.speaker,
        content: item.text,
        createdAt: new Date().toISOString(),
        kind: "agent",
      };
      setLiveDebateEntries((prev) => [...prev, nextEntry].slice(-12));
    }, 3600);

    return () => {
      window.clearInterval(streamTimer);
    };
  }, [isFetchingDebate]);

  const hasAllAgentsSpokenOnce = useMemo(
    () => (["legal", "risk", "ethics"] as AgentId[]).every((agentId) => liveDebateEntries.some((entry) => entry.kind === "agent" && entry.speaker === agentId)),
    [liveDebateEntries],
  );

  useEffect(() => {
    if (userTurnState === "waiting" && hasAllAgentsSpokenOnce) {
      setUserTurnState("open");
    }
  }, [hasAllAgentsSpokenOnce, userTurnState]);

  useEffect(() => {
    if (!isFetchingDebate || !isServerResolved || userTurnState !== "done" || !resolvedPayload) return;

    setMessages(resolvedPayload.messages);
    if (resolvedPayload.finalDecision) {
      sessionStorage.setItem("finalDecision", JSON.stringify(resolvedPayload.finalDecision));
    }
    if (resolvedPayload.evidences) {
      sessionStorage.setItem("evidences", JSON.stringify(resolvedPayload.evidences));
    }
    if (resolvedPayload.usingMockData) {
      sessionStorage.setItem("usingMockData", "true");
    } else {
      sessionStorage.removeItem("usingMockData");
    }
    setError("");
    setIsComplete(true);
    setSimulatedProgress(100);
    setIsFetchingDebate(false);
  }, [isFetchingDebate, isServerResolved, resolvedPayload, userTurnState]);

  const handleInterventionSubmit = () => {
    if (!isFetchingDebate || userTurnState !== "open") return;
    const trimmed = interventionInput.trim();
    if (!trimmed) return;

    const userEntry: LiveDebateEntry = {
      id: Date.now(),
      speaker: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      kind: "user",
    };

    setInterventionEntries((prev) => [...prev, userEntry]);
    setLiveDebateEntries((prev) => [...prev, userEntry].slice(-12));
    setInterventionInput("");
    setUserTurnState("done");
  };

  const handlePassTurn = () => {
    if (!isFetchingDebate || userTurnState !== "open") return;
    const passEntry: LiveDebateEntry = {
      id: Date.now(),
      speaker: "user",
      content: "사용자가 이번 턴의 발언권을 패스했습니다.",
      createdAt: new Date().toISOString(),
      kind: "user",
    };
    setInterventionEntries((prev) => [...prev, passEntry]);
    setLiveDebateEntries((prev) => [...prev, passEntry].slice(-12));
    setUserTurnState("done");
  };

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

  return (
    <div className="min-h-screen bg-[#ffffffff] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#ffffffff]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="min-w-[220px] text-left py-1">
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
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
        </div>

        {isFetchingDebate && (
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

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                  실시간 토론 스트림
                </CardTitle>
                <CardDescription>
                  모든 에이전트가 1회씩 발언하면 사용자 질문 턴이 열립니다. 질문이 없으면 발언권을 패스할 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 max-h-[280px] overflow-auto">
                  {liveDebateEntries.map((entry) => (
                    <div key={entry.id} className="text-sm rounded-lg border border-slate-200 bg-white p-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {entry.speaker === "user" ? (
                          <>
                            <UserCircle2 className="w-3.5 h-3.5" />
                            사용자
                          </>
                        ) : (
                          <>
                            <span>{agentMap[entry.speaker as AgentId].name}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              실시간
                            </Badge>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-slate-700 whitespace-pre-wrap">{entry.content}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <Textarea
                    value={interventionInput}
                    onChange={(e) => setInterventionInput(e.target.value)}
                    placeholder={
                      userTurnState === "open"
                        ? "모르는 점을 질문하거나 조건을 추가해 주세요"
                        : "모든 에이전트가 1회 발언하면 질문 입력이 활성화됩니다"
                    }
                    className="min-h-[90px]"
                    disabled={userTurnState !== "open"}
                  />
                  <div className="flex justify-between items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {userTurnState === "open"
                        ? "지금은 사용자 질문 턴입니다"
                        : userTurnState === "done"
                          ? "사용자 턴이 종료되었습니다"
                          : "에이전트 발언 진행 중"}
                    </Badge>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePassTurn}
                        disabled={userTurnState !== "open"}
                      >
                        발언권 패스
                      </Button>
                      <Button
                        type="button"
                        onClick={handleInterventionSubmit}
                        className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                        disabled={userTurnState !== "open" || !interventionInput.trim()}
                      >
                        질문 보내기
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!isFetchingDebate && error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-700 text-sm">{error}</p>
              <Button className="mt-3" onClick={() => window.location.reload()}>다시 시도</Button>
            </CardContent>
          </Card>
        )}

        {!isFetchingDebate && isComplete && !error && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-emerald-800 font-medium">
                <CheckCircle2 className="w-5 h-5" />
                치열한 토론 끝에 결론이 도출되었습니다.
              </div>
              <p className="text-sm text-emerald-700 mt-2">
                에이전트들이 나눈 {messages.length}개의 논쟁 로그가 준비되었습니다.
              </p>
              {interventionEntries.length > 0 && (
                <p className="text-sm text-emerald-700 mt-1">
                  사용자 개입 메시지 {interventionEntries.length}건이 토론 과정에 반영되었습니다.
                </p>
              )}
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

        {showDetailedLogs && !isFetchingDebate && !error && (
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>토론 로그 상세 보기</CardTitle>
              <CardDescription>전체 로그는 판정 결과 창에서도 확인 가능합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {interventionEntries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">사용자 개입 로그</p>
                  {interventionEntries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border p-3 bg-violet-50 border-violet-200">
                      <div className="text-sm font-medium flex items-center gap-2 text-violet-700">
                        <UserCircle2 className="w-4 h-4" />
                        사용자
                        <Badge variant="outline" className="ml-1 text-xs">
                          intervention
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{entry.content}</p>
                    </div>
                  ))}
                </div>
              )}
              {Object.entries(groupedRounds).map(([round, roundMessages]) => (
                <div key={round} className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700">라운드 {round}</p>
                  {roundMessages.map((msg, idx) => {
                    const agent = agentMap[msg.agentId];
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

        {!isFetchingDebate && isComplete && (
          <div className="text-center text-sm text-slate-500">
            
          </div>
        )}

      </main>
    </div>
  );
}
