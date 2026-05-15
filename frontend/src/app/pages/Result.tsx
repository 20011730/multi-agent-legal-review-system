import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { exportElementToPdf } from "../utils/exportVerdictPdf";
import { getMockReviewDetail } from "../utils/mockReviewData";

interface ReviewData {
  companyName: string;
  industry: string;
  reviewType: string;
  situation: string;
  content: string;
}

interface RiskItem {
  category: string;
  level: "high" | "medium" | "low";
  description: string;
}

interface FinalDecision {
  verdict?: "approved" | "conditional" | "rejected";
  riskLevel?: string;
  risks?: RiskItem[];
  summary?: string;
  recommendation?: string;
  revisedContent?: string;
}

function normalizeRiskLevel(level?: string): "HIGH" | "MEDIUM" | "LOW" {
  const u = (level || "MEDIUM").toUpperCase();
  if (u === "HIGH" || u === "LOW") return u;
  return "MEDIUM";
}

function trafficFromLevel(level: "HIGH" | "MEDIUM" | "LOW") {
  if (level === "HIGH") {
    return {
      key: "red" as const,
      icon: "🔴",
      title: "위험",
      hint: "즉각적인 법무·대외 대응이 필요할 수 있습니다.",
    };
  }
  if (level === "MEDIUM") {
    return {
      key: "yellow" as const,
      icon: "🟡",
      title: "주의",
      hint: "조건부 승인 또는 완화 조치 후 재검토를 권장합니다.",
    };
  }
  return {
    key: "green" as const,
    icon: "🟢",
    title: "안전",
    hint: "현재 제시된 범위에서는 상대적으로 통제 가능한 수준입니다.",
  };
}

function riskProbabilityPercent(level: "HIGH" | "MEDIUM" | "LOW"): number {
  if (level === "HIGH") return 78;
  if (level === "MEDIUM") return 48;
  return 22;
}

function damageDescriptor(level: "HIGH" | "MEDIUM" | "LOW"): string {
  if (level === "HIGH") {
    return "과징금·형사 조사·사업 중단 등 중대한 외부 충격 가능성이 상대적으로 높습니다.";
  }
  if (level === "MEDIUM") {
    return "일정 기간 내 시정명령·민사 분쟁·평판 훼손 등 중간 규모의 비용이 예상됩니다.";
  }
  return "통상적인 컴플라이언스 조치로 충분히 관리 가능한 수준의 파급으로 평가됩니다.";
}

function toExecutiveLines(summary: string): string[] {
  const trimmed = summary.trim();
  if (!trimmed) {
    return [
      "요약 텍스트가 아직 없습니다. 상세 리포트 탭에서 전체 판정문을 확인해 주세요.",
      "",
      "",
    ];
  }
  const lines = trimmed
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 3) return lines.slice(0, 3);
  const sentences = trimmed
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [...lines];
  for (const s of sentences) {
    if (out.length >= 3) break;
    if (!out.includes(s)) out.push(s);
  }
  while (out.length < 3) out.push("");
  return out.slice(0, 3);
}

function splitRecommendationToTasks(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean);
}

function buildCategoryPlans(
  final: FinalDecision | null,
  risks: RiskItem[],
): { category: string; items: string[] }[] {
  const fromRisks = risks.map((r) => ({
    category: r.category || "리스크",
    items: [
      r.description,
      r.level === "high"
        ? "우선 검토: 해당 카테고리 관련 내부 통제·계약 조항을 즉시 점검하세요."
        : r.level === "medium"
          ? "일정 내 시정: 완화 문안을 반영한 실행 계획을 수립하세요."
          : "모니터링: 변경 사항 발생 시 재평가하세요.",
    ],
  }));

  const rec = final?.recommendation?.trim();
  if (rec) {
    const bullets = splitRecommendationToTasks(rec);
    if (bullets.length) {
      fromRisks.push({
        category: "종합 실행 과제",
        items: bullets.slice(0, 8),
      });
    }
  }

  if (!fromRisks.length) {
    return [
      {
        category: "기본 점검",
        items: ["검토 데이터를 다시 불러오거나 새 세션으로 진단을 시작해 주세요."],
      },
    ];
  }

  return fromRisks;
}

/**
 * COMPLETED 상태에서 보여주는 최종 판정 결과지(Top-Down).
 */
export function SessionResultReport() {
  const navigate = useNavigate();
  const printableRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("reviewData");
    if (!raw) {
      navigate("/input");
      return;
    }
    try {
      setReviewData(JSON.parse(raw) as ReviewData);
    } catch {
      navigate("/input");
    }

    const fdRaw = sessionStorage.getItem("finalDecision");
    if (fdRaw) {
      try {
        setFinalDecision(JSON.parse(fdRaw) as FinalDecision);
      } catch {
        setFinalDecision(null);
      }
    }

    const sessionId = sessionStorage.getItem("sessionId");
    const usingMock = sessionStorage.getItem("usingMockData") === "true";
    if (usingMock && sessionId) {
      const detail = getMockReviewDetail(sessionId);
      if (detail?.finalDecision) {
        setFinalDecision(detail.finalDecision as FinalDecision);
        sessionStorage.setItem("finalDecision", JSON.stringify(detail.finalDecision));
      }
      return;
    }

    if (!sessionId) return;

    let cancelled = false;
    fetch(`http://localhost:8080/api/sessions/${sessionId}/debates/latest`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        if (cancelled || !result?.finalDecision) return;
        setFinalDecision(result.finalDecision as FinalDecision);
        sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
      })
      .catch(() => {
        /* sessionStorage 값 유지 */
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const level = useMemo(() => normalizeRiskLevel(finalDecision?.riskLevel), [finalDecision?.riskLevel]);
  const traffic = useMemo(() => trafficFromLevel(level), [level]);
  const execLines = useMemo(
    () => toExecutiveLines(finalDecision?.summary || ""),
    [finalDecision?.summary],
  );

  const risks: RiskItem[] = useMemo(
    () =>
      finalDecision?.risks?.length
        ? finalDecision.risks
        : [
            { category: "Legal", level: "high", description: "근거·증빙이 불충분할 수 있습니다." },
            { category: "Business", level: "medium", description: "대외 메시지 톤에 따른 신뢰도 변동이 있습니다." },
          ],
    [finalDecision?.risks],
  );

  const actionPlans = useMemo(() => buildCategoryPlans(finalDecision, risks), [finalDecision, risks]);

  const prob = riskProbabilityPercent(level);

  const handlePdf = async () => {
    const el = pdfRef.current ?? printableRef.current;
    if (!el) {
      toast.error("PDF로 보낼 영역을 찾을 수 없습니다.");
      return;
    }
    setIsPdfExporting(true);
    try {
      await exportElementToPdf(el, `LexRex_result_${new Date().toISOString().slice(0, 19)}.pdf`);
      toast.success("결과지 PDF를 저장했습니다.");
    } catch (e) {
      console.error(e);
      toast.error("PDF 저장에 실패했습니다.");
    } finally {
      setIsPdfExporting(false);
    }
  };

  if (!reviewData) return null;

  return (
    <div className="space-y-6">
      <div ref={printableRef} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#1E3A8A]">최종 판정 결과지</h2>
            <p className="text-sm text-slate-600">
              {reviewData.companyName} · {reviewData.industry}
            </p>
          </div>
          <Button
            type="button"
            className="rounded-full bg-[#1E3A8A] hover:bg-[#1E3A8A]/90"
            onClick={() => void handlePdf()}
            disabled={isPdfExporting}
          >
            {isPdfExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            결과지 PDF
          </Button>
        </div>

        <Card
          className={
            traffic.key === "red"
              ? "border-rose-200 bg-rose-50/60"
              : traffic.key === "yellow"
                ? "border-amber-200 bg-amber-50/60"
                : "border-emerald-200 bg-emerald-50/60"
          }
        >
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3 text-xl">
              <span className="text-3xl" aria-hidden>
                {traffic.icon}
              </span>
              <span>최종 진단: {traffic.title}</span>
              <Badge variant="outline" className="text-xs">
                riskLevel {level}
              </Badge>
            </CardTitle>
            <CardDescription>{traffic.hint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Sparkles className="h-4 w-4 text-[#1E3A8A]" />
              Executive Summary (3줄)
            </div>
            <Separator />
            <ul className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-slate-800">
              {execLines.map((line, i) => (
                <li key={i} className={line ? "" : "text-slate-400"}>
                  {line || "—"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>리스크 발생 확률 (모델 지표)</CardTitle>
              <CardDescription>정성·정량 신호를 종합한 참고치입니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-3xl font-semibold text-[#1E3A8A]">{prob}%</span>
                <span className="text-xs text-slate-500">0–100 스케일</span>
              </div>
              <Progress value={prob} className="h-3" />
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>해석 가이드</AlertTitle>
                <AlertDescription className="text-xs leading-relaxed">
                  수치는 법적 효력이 없는 참고용 지표이며, 실제 규제 대응은 내부 법무 검토를 전제로 해야 합니다.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>예상 피해 규모</CardTitle>
              <CardDescription>카테고리별 리스크 밀도를 바탕으로 한 서술형 평가입니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-slate-700">{damageDescriptor(level)}</p>
              <div className="flex flex-wrap gap-2">
                {risks.slice(0, 4).map((r, idx) => (
                  <Badge
                    key={idx}
                    variant="secondary"
                    className={
                      r.level === "high"
                        ? "bg-rose-100 text-rose-800"
                        : r.level === "medium"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-emerald-100 text-emerald-900"
                    }
                  >
                    {r.category}: {r.level.toUpperCase()}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-[#1E3A8A]" />
              카테고리별 Action Plan
            </CardTitle>
            <CardDescription>실행 가능한 To-Do 형태로 정리했습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {actionPlans.map((block, idx) => (
              <div key={`${block.category}-${idx}`}>
                {idx > 0 && <Separator className="mb-6" />}
                <p className="mb-3 text-sm font-semibold text-slate-900">{block.category}</p>
                <ul className="space-y-2">
                  {block.items.map((item, j) => (
                    <li key={j} className="flex gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="rounded-full" onClick={() => navigate("/verdict")}>
          법령·판례 근거 포함 상세 보기
        </Button>
      </div>

      <div
        aria-hidden
        className="pointer-events-none fixed left-[-12000px] top-0"
        style={{ width: 780, background: "#ffffff" }}
      >
        <div ref={pdfRef} className="verdict-pdf-root space-y-4 p-4 text-slate-900">
          <div style={pdfHeaderBox}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1E3A8A" }}>LexRex AI · 최종 판정 결과지</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
              {reviewData.companyName} / {reviewData.industry} / {new Date().toLocaleString("ko-KR")}
            </div>
          </div>
          <div style={pdfCard}>
            <div style={pdfTitle}>
              {traffic.icon} 진단: {traffic.title} ({level})
            </div>
            {execLines.map((l, i) => (
              <div key={i} style={{ ...pdfBody, marginTop: i === 0 ? 6 : 2 }}>
                {i + 1}. {l || "—"}
              </div>
            ))}
          </div>
          <div style={pdfCard}>
            <div style={pdfTitle}>리스크 확률 지표</div>
            <div style={{ ...pdfBody, marginTop: 4 }}>
              {prob}% — {damageDescriptor(level)}
            </div>
          </div>
          <div style={pdfCard}>
            <div style={pdfTitle}>Action Plan</div>
            {actionPlans.map((b, i) => (
              <div key={i} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{b.category}</div>
                {b.items.map((it, j) => (
                  <div key={j} style={{ ...pdfBody, marginTop: 2 }}>
                    - {it}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const pdfHeaderBox: CSSProperties = {
  borderBottom: "2px solid #1E3A8A",
  paddingBottom: 8,
  marginBottom: 8,
};

const pdfCard: CSSProperties = {
  border: "1px solid #94a3b8",
  borderRadius: 2,
  padding: "12px 14px",
  background: "#ffffff",
};

const pdfTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#1E3A8A",
};

const pdfBody: CSSProperties = {
  fontSize: 11,
  color: "#0f172a",
  lineHeight: 1.6,
};
