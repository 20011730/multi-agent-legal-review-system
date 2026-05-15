import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { AgentMessageBlock } from "../components/debate/AgentMessageBlock";
import { DebatePixelStage } from "../components/debate/DebatePixelStage";
import { UserIntervention } from "../components/debate/UserIntervention";
import { SessionResultReport } from "./Result";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { useDebatePolling, type DebateMessage } from "../hooks/useDebatePolling";

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function DebateRoundBlocks({ round, messages }: { round: number; messages: DebateMessage[] }) {
  return (
    <section className="space-y-3">
      <p className="text-sm font-semibold text-slate-700">라운드 {round}</p>
      <div className="space-y-3">
        {messages.map((msg, idx) => (
          <AgentMessageBlock key={`${round}-${idx}-${msg.type}`} message={msg} />
        ))}
      </div>
    </section>
  );
}

export function Debate() {
  const navigate = useNavigate();
  const sessionId = sessionStorage.getItem("sessionId");
  const {
    messages,
    analysisPhase,
    uiState,
    screenMode,
    phaseInfo,
    elapsedSeconds,
    error,
    isWaitingForUser,
    refreshNow,
  } = useDebatePolling(sessionId);

  useEffect(() => {
    if (!sessionId || sessionId === "undefined" || sessionId === "null") {
      navigate("/input");
    }
  }, [navigate, sessionId]);

  const groupedRounds = useMemo(() => {
    const grouped: Record<number, DebateMessage[]> = {};
    for (const msg of messages) {
      const key = msg.round || 1;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(msg);
    }
    return grouped;
  }, [messages]);

  const isFailed = screenMode === "FAILED";
  const isCompleted = screenMode === "COMPLETED";
  const isActiveOrWaiting = screenMode === "ACTIVE_DEBATE" || screenMode === "WAITING_FOR_USER";
  const showPixelStage = screenMode === "ACTIVE_DEBATE" || screenMode === "WAITING_FOR_USER";
  const showElapsed = isActiveOrWaiting && !isFailed && elapsedSeconds > 0 && uiState !== "WAITING_FOR_USER";

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button type="button" onClick={() => navigate("/")} className="min-w-[220px] py-1 text-left">
            <h1 className="font-menu text-[25px] leading-[1.02] text-[#1E3A8A]">LexRex AI</h1>
            <p className="mt-[3px] max-h-5 text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B]">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          {isCompleted && !isFailed && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/verdict")} className="rounded-full">
                근거·상세 리포트
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10 pb-28">
        <div>
          <h2 className="text-3xl font-semibold text-[#1E3A8A]">멀티 에이전트 토론 · 결과</h2>
          <p className="mt-2 text-slate-600">
            5인 체제 라운드 토론과 사용자 개입(WAITING_FOR_USER_R1/R2)을 반영합니다.
          </p>
          {showElapsed && <p className="mt-2 text-sm text-slate-400">진행 경과: {formatElapsed(elapsedSeconds)}</p>}
        </div>

        {isFailed && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="mb-2 flex items-center gap-2 text-red-700">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">분석 실패</span>
              </div>
              <p className="text-sm text-red-700">{error || "분석에 실패했습니다. 다시 시도해주세요."}</p>
              <div className="mt-4 flex gap-3">
                <Button variant="outline" onClick={() => navigate("/")}>
                  홈으로
                </Button>
                <Button
                  onClick={() => {
                    sessionStorage.removeItem("sessionId");
                    navigate("/input");
                  }}
                >
                  다시 시도
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isCompleted && !isFailed && <SessionResultReport />}

        {isActiveOrWaiting && !isFailed && (
          <>
            {showPixelStage && (
              <DebatePixelStage
                label={
                  uiState === "LOADING"
                    ? "에이전트가 검토 공간을 준비하고 있습니다."
                    : phaseInfo.label
                }
              />
            )}

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>현재 진행 상태</CardTitle>
                <CardDescription>{phaseInfo.label}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={phaseInfo.progress} className="h-2" />
                <p className="text-sm text-slate-700">{phaseInfo.description}</p>
                {analysisPhase && <Badge variant="secondary">{analysisPhase}</Badge>}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>토론 로그 ({messages.length}건)</CardTitle>
                <CardDescription>에이전트별 발언은 수신 완료 시 블록 단위로 표시됩니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {Object.keys(groupedRounds).length === 0 && (
                  <p className="text-sm text-slate-500">아직 수집된 토론 메시지가 없습니다.</p>
                )}
                {Object.entries(groupedRounds).map(([round, roundMessages]) => (
                  <DebateRoundBlocks key={round} round={Number(round)} messages={roundMessages} />
                ))}
              </CardContent>
            </Card>

            {isWaitingForUser && (
              <Card className="border-emerald-200 bg-emerald-50/80">
                <CardContent className="flex items-start gap-3 pt-6">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="font-medium text-emerald-900">에이전트 라운드가 일시 정지되었습니다.</p>
                    <p className="mt-1 text-sm text-emerald-800">
                      하단 패널에서 의견을 제출하거나 패스하면 다음 라운드가 재개됩니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      {isWaitingForUser && sessionId && analysisPhase && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 pt-2">
          <div className="pointer-events-auto w-full max-w-6xl">
            <UserIntervention sessionId={sessionId} analysisPhase={analysisPhase} onSubmitted={refreshNow} />
          </div>
        </div>
      )}
    </div>
  );
}
