import { useMemo, useState } from "react";
import { Loader2, Send, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import type { AnalysisPhase } from "../../hooks/useDebatePolling";
import { submitMockDebateFeedback } from "../../utils/mockDebateSession";

interface UserInterventionProps {
  sessionId: string;
  analysisPhase: AnalysisPhase;
  onSubmitted?: () => void;
}

const API_BASE = "http://localhost:8080/api";

export function UserIntervention({ sessionId, analysisPhase, onSubmitted }: UserInterventionProps) {
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usingMockData = sessionStorage.getItem("usingMockData") === "true";

  const title = useMemo(() => {
    if (analysisPhase === "WAITING_FOR_USER_R1") return "Round 1 종료 — 사용자 의견 입력";
    return "Round 2 종료 — 최종 라운드 전 사용자 의견 입력";
  }, [analysisPhase]);

  const helper = useMemo(() => {
    if (analysisPhase === "WAITING_FOR_USER_R1") {
      return "팩트 정정, 제약 조건, 추가 전제를 입력하거나 패스할 수 있습니다.";
    }
    return "추가 보정 의견이 없다면 패스를 눌러 Round 3으로 진행하세요.";
  }, [analysisPhase]);

  const placeholder = useMemo(() => {
    if (analysisPhase === "WAITING_FOR_USER_R1") {
      return "예: 저희는 B2C가 아니라 B2B 타겟입니다. / 아직 정식 출시 전인 베타 테스트 단계입니다.";
    }
    return "예: 개발 리소스가 부족하여 복잡한 시스템 추가는 어렵습니다. / 예산이 0원인 상태에서 해결할 방법을 찾아주세요.";
  }, [analysisPhase]);

  const quickReplyChips = useMemo(() => {
    if (analysisPhase === "WAITING_FOR_USER_R1") {
      return [
        "저희는 B2B 서비스라 해당 법령 적용 대상이 아닙니다.",
        "아직 매출이 발생하지 않는 극초기 단계입니다.",
        "해당 리스크는 감수할 테니 다음 단계로 넘어가 주세요.",
      ];
    }
    return [
      "개발 비용과 시간이 너무 많이 듭니다. 다른 방법을 알려주세요.",
      "고객 이탈이 우려됩니다. UX를 해치지 않는 선에서 대안을 주세요.",
      "제시해주신 대안을 적용할 수 있게 실제 수정 문구를 작성해 주세요.",
    ];
  }, [analysisPhase]);

  const submitFeedback = async (isPass: boolean) => {
    if (isSubmitting) return;
    const content = feedback.trim();
    if (!isPass && !content) {
      toast.error("피드백 내용을 입력하거나 패스를 선택해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (usingMockData) {
        submitMockDebateFeedback(sessionId, {
          content: isPass ? "" : content,
          isPass,
        });
        setFeedback("");
        toast.success(isPass ? "패스가 제출되었습니다. 다음 라운드를 시작합니다." : "피드백이 제출되었습니다.");
        onSubmitted?.();
        return;
      }

      const res = await fetch(`${API_BASE}/sessions/${sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: isPass ? "" : content,
          isPass,
        }),
      });

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { message?: string };
          if (err?.message) message = String(err.message);
        } catch {
          // no-op
        }
        throw new Error(message);
      }

      setFeedback("");
      toast.success(isPass ? "패스가 제출되었습니다. 다음 라운드를 시작합니다." : "피드백이 제출되었습니다.");
      onSubmitted?.();
    } catch (error) {
      console.error(error);
      toast.error("피드백 전송에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyQuickReply = (chip: string) => {
    if (isSubmitting) return;
    setFeedback((prev) => (prev.trim() ? `${prev}\n${chip}` : chip));
  };

  return (
    <Card className="border-[#1E3A8A]/25 bg-white shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-[#1E3A8A]">{title}</CardTitle>
        <CardDescription>{helper}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">원클릭 추천 (텍스트만 채움 · 제출은 별도)</p>
          <ScrollArea className="w-full whitespace-nowrap pb-1">
            <div className="flex w-max gap-2 pb-1">
              {quickReplyChips.map((chip) => (
                <Badge
                  key={chip}
                  variant="outline"
                  className="max-w-[min(100vw-3rem,420px)] cursor-pointer whitespace-normal rounded-full px-3 py-2 text-left text-xs font-normal leading-snug hover:bg-slate-50"
                  role="button"
                  tabIndex={0}
                  onClick={() => applyQuickReply(chip)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      applyQuickReply(chip);
                    }
                  }}
                >
                  {chip}
                </Badge>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={placeholder}
          className="min-h-24 bg-white"
          disabled={isSubmitting}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void submitFeedback(false)}
            className="bg-[#1E3A8A] hover:bg-[#1E3A8A]/90"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            제출
          </Button>
          <Button type="button" variant="outline" onClick={() => void submitFeedback(true)} disabled={isSubmitting}>
            <SkipForward className="mr-2 h-4 w-4" />
            패스(Pass)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
