import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Download,
  Loader2,
  MessageSquare,
  RotateCcw,
  Share2,
  AlertTriangle,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { exportElementToPdf } from "../utils/exportVerdictPdf";
import { EvidenceCardList, type EvidenceItem } from "../components/EvidenceCard";

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
  verdict: "approved" | "conditional" | "rejected";
  riskLevel: string;
  risks: RiskItem[];
  summary: string;
  recommendation: string;
  revisedContent: string;
}

export function Verdict() {
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [recheckTarget, setRecheckTarget] = useState<"legal" | "business" | "ethics">("legal");
  const [recheckQuestion, setRecheckQuestion] = useState("");

  useEffect(() => {
    const data = sessionStorage.getItem("reviewData");
    if (!data) {
      navigate("/input");
      return;
    }
    setReviewData(JSON.parse(data));

    const fdData = sessionStorage.getItem("finalDecision");
    if (fdData) setFinalDecision(JSON.parse(fdData));

    const evData = sessionStorage.getItem("evidences");
    if (evData) {
      try { setEvidences(JSON.parse(evData)); } catch { setEvidences([]); }
    }
  }, [navigate]);

  if (!reviewData) return null;

  const risks: RiskItem[] =
    finalDecision?.risks || [
      { category: "Legal", level: "high", description: "Claim evidence may be insufficient." },
      { category: "Business", level: "medium", description: "Brand trust may drop due to aggressive tone." },
      { category: "Ethics", level: "medium", description: "Consumer autonomy can be undermined." },
    ];

  const riskScore =
    finalDecision?.riskLevel === "HIGH" ? 82 : finalDecision?.riskLevel === "LOW" ? 31 : 58;

  const handlePdfDownload = async () => {
    const el = reportRef.current;
    if (!el) return;
    setIsPdfExporting(true);
    try {
      await exportElementToPdf(el, `LexRex_report_${new Date().toISOString().slice(0, 19)}.pdf`);
      toast.success("PDF saved.");
    } catch (error) {
      console.error(error);
      toast.error("PDF export failed.");
    } finally {
      setIsPdfExporting(false);
    }
  };

  const handleRecheck = () => {
    sessionStorage.setItem(
      "recheckRequest",
      JSON.stringify({ target: recheckTarget, question: recheckQuestion, requestedAt: new Date().toISOString() }),
    );
    navigate("/result");
  };

  const handleShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("Link copy failed.");
    }
  };

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void handlePdfDownload()} disabled={isPdfExporting}>
              {isPdfExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}PDF
            </Button>
            <Button className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white" onClick={() => {
              sessionStorage.removeItem("reviewData");
              sessionStorage.removeItem("sessionId");
              sessionStorage.removeItem("finalDecision");
              sessionStorage.removeItem("evidences");
              navigate("/input");
            }}>
              <RotateCcw className="w-4 h-4 mr-2" />새 검토
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div ref={reportRef} className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-[#1E3A8A]">최종 법률 리스크 리포트</h2>
            <p className="text-sm text-slate-600 mt-1">토론 결과를 구조화한 최종 보고서입니다.</p>
          </div>

          {/* 리스크 스코어 */}
          <Card className="border-[#1E3A8A]/20 bg-[#1E3A8A]/5">
            <CardHeader>
              <CardTitle>리스크 스코어</CardTitle>
              <CardDescription>0~100 종합 지표</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-6">
                <p className="text-4xl font-semibold text-[#1E3A8A]">{riskScore}</p>
                <div className="w-full max-w-[360px]">
                  <div className="h-3 rounded-full border border-slate-300 overflow-hidden">
                    <div
                      className={`h-full ${riskScore >= 70 ? "bg-red-500" : riskScore >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${riskScore}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 종합 요약 */}
          {finalDecision?.summary && (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#1E3A8A]" />
                  종합 요약
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {finalDecision.summary}
                </p>
              </CardContent>
            </Card>
          )}

          {/* 에이전트별 요약 제언 */}
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>에이전트별 요약 제언</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="rounded-xl border p-4 bg-slate-50">
                  <p className="font-semibold mb-2">법무</p>
                  <p>주장 근거를 명확히 제시하고 법령 위반 소지가 있는 표현을 제거하세요.</p>
                </div>
                <div className="rounded-xl border p-4 bg-slate-50">
                  <p className="font-semibold mb-2">사업</p>
                  <p>전환율을 유지하되 과도한 공격형 문구 대신 신뢰 중심 문구를 사용하세요.</p>
                </div>
                <div className="rounded-xl border p-4 bg-slate-50">
                  <p className="font-semibold mb-2">윤리</p>
                  <p>소비자 선택권을 존중하는 정보형 커뮤니케이션으로 전환하세요.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 리스크 항목 */}
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                리스크 항목
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {risks.map((risk, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 bg-slate-50">
                    <div>
                      <p className="font-medium text-sm">{risk.category}</p>
                      <p className="text-sm text-slate-600">{risk.description}</p>
                    </div>
                    <Badge className={risk.level === "high" ? "bg-red-100 text-red-700" : risk.level === "medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
                      {risk.level.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 수정안 (원문 vs 권고) */}
          {finalDecision?.revisedContent && (
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-red-200 bg-red-50/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    원문
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {reviewData.content}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-green-200 bg-green-50/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    수정안 (권고)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {finalDecision.revisedContent}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 최종 권고사항 */}
          {finalDecision?.recommendation && (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#1E3A8A]" />
                  최종 권고사항
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {finalDecision.recommendation}
                </p>
              </CardContent>
            </Card>
          )}

          {/* 법령·판례 근거 */}
          <EvidenceCardList evidences={evidences} />

          {/* 재검토 */}
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>재검토(Recheck)</CardTitle>
              <CardDescription>특정 에이전트 대상으로 추가 질문을 보내 다시 토론합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button variant={recheckTarget === "legal" ? "default" : "outline"} className={recheckTarget === "legal" ? "bg-[#1E3A8A] text-white" : ""} onClick={() => setRecheckTarget("legal")}>법무</Button>
                <Button variant={recheckTarget === "business" ? "default" : "outline"} className={recheckTarget === "business" ? "bg-[#1E3A8A] text-white" : ""} onClick={() => setRecheckTarget("business")}>사업</Button>
                <Button variant={recheckTarget === "ethics" ? "default" : "outline"} className={recheckTarget === "ethics" ? "bg-[#1E3A8A] text-white" : ""} onClick={() => setRecheckTarget("ethics")}>윤리</Button>
              </div>
              <textarea
                value={recheckQuestion}
                onChange={(e) => setRecheckQuestion(e.target.value)}
                placeholder="추가 질문 또는 변경 조건을 입력하세요"
                className="w-full min-h-[90px] rounded-xl border border-slate-300 p-3 text-sm"
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleRecheck} className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white"><MessageSquare className="w-4 h-4 mr-2" />재검토 시작</Button>
                <Button variant="outline" onClick={() => void handlePdfDownload()}><Download className="w-4 h-4 mr-2" />PDF 저장</Button>
                <Button variant="outline" onClick={() => void handleShareLink()}><Share2 className="w-4 h-4 mr-2" />링크 공유</Button>
              </div>
            </CardContent>
          </Card>

          {/* 유의사항 */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 leading-relaxed">
            <strong>유의사항:</strong> 본 보고서는 AI 기반 멀티 에이전트 시스템에 의한 분석 결과이며,
            참고 자료로 활용하시기 바랍니다. 최종 의사결정은 법무팀, 컴플라이언스팀 등
            사내 전문가의 검토를 거쳐 진행하시고, 필요시 외부 법률 자문을 받으시기 바랍니다.
          </div>
        </div>
      </main>
    </div>
  );
}
