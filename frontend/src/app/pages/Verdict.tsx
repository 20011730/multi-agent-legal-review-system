import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import {
  Scale,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  Download,
  Loader2,
  RotateCcw,
  BookOpen,
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

type VerdictLevel = "approved" | "conditional" | "rejected";

interface RiskItem {
  category: string;
  level: "high" | "medium" | "low";
  description: string;
}

interface FinalDecision {
  verdict: VerdictLevel;
  riskLevel: string;
  risks: RiskItem[];
  summary: string;
  recommendation: string;
  revisedContent: string;
}

// EvidenceItem 타입은 EvidenceCard에서 import

export function Verdict() {
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);

  useEffect(() => {
    const data = sessionStorage.getItem("reviewData");
    if (!data) {
      navigate("/input");
      return;
    }
    setReviewData(JSON.parse(data));

    const fdData = sessionStorage.getItem("finalDecision");
    if (fdData) {
      setFinalDecision(JSON.parse(fdData));
    }

    const evData = sessionStorage.getItem("evidences");
    if (evData) {
      try { setEvidences(JSON.parse(evData)); } catch { /* ignore */ }
    }
  }, [navigate]);

  if (!reviewData) {
    return null;
  }

  const verdict: VerdictLevel = finalDecision?.verdict || "conditional";

  const risks: RiskItem[] = finalDecision?.risks || [
    {
      category: "법률 리스크",
      level: "high",
      description: "표시광고법 위반 가능성 (거짓·과장 광고)",
    },
    {
      category: "평판 리스크",
      level: "medium",
      description: "경쟁사 비하 표현으로 인한 브랜드 이미지 손상",
    },
    {
      category: "소비자 신뢰",
      level: "medium",
      description: "과도한 압박 마케팅으로 인한 반발 가능성",
    },
    {
      category: "윤리 리스크",
      level: "low",
      description: "소비자 자율성 침해 우려",
    },
  ];

  const getVerdictConfig = (level: VerdictLevel) => {
    switch (level) {
      case "approved":
        return {
          label: "승인",
          icon: CheckCircle2,
          color: "text-green-700",
          bgColor: "bg-green-50",
          borderColor: "border-green-200",
          description: "법적·윤리적 검토 결과 승인되었습니다",
        };
      case "conditional":
        return {
          label: "조건부 승인",
          icon: AlertTriangle,
          color: "text-amber-700",
          bgColor: "bg-amber-50",
          borderColor: "border-amber-200",
          description: "제시된 수정사항 반영 후 사용 가능합니다",
        };
      case "rejected":
        return {
          label: "재검토 필요",
          icon: XCircle,
          color: "text-red-700",
          bgColor: "bg-red-50",
          borderColor: "border-red-200",
          description: "중대한 법적·윤리적 문제가 발견되었습니다",
        };
    }
  };

  const getRiskIcon = (level: string) => {
    switch (level) {
      case "high":
        return <TrendingUp className="w-4 h-4 text-red-600" />;
      case "medium":
        return <Minus className="w-4 h-4 text-amber-600" />;
      case "low":
        return <TrendingDown className="w-4 h-4 text-green-600" />;
    }
  };

  const getRiskBadge = (level: string) => {
    switch (level) {
      case "high":
        return <Badge variant="destructive" className="text-xs">높음</Badge>;
      case "medium":
        return <Badge className="bg-amber-500 text-xs">보통</Badge>;
      case "low":
        return <Badge className="bg-green-600 text-xs">낮음</Badge>;
    }
  };

  const verdictConfig = getVerdictConfig(verdict);
  const VerdictIcon = verdictConfig.icon;

  const handlePdfDownload = async () => {
    const el = reportRef.current;
    if (!el) {
      toast.error("보고서 영역을 찾을 수 없습니다.");
      return;
    }
    setIsPdfExporting(true);
    el.scrollIntoView({ block: "start" });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
      await document.fonts?.ready;
    } catch {
      /* ignore */
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    try {
      await exportElementToPdf(el, `LegalReview_report_${stamp}.pdf`);
      toast.success("PDF를 저장했습니다.");
    } catch (e) {
      console.error(e);
      toast.error("PDF 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsPdfExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 hover:opacity-70 transition-opacity"
          >
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
            <Button
              variant="outline"
              size="sm"
              disabled={isPdfExporting}
              onClick={() => void handlePdfDownload()}
            >
              {isPdfExporting ? (
                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
              ) : (
                <Download className="mr-2 w-4 h-4" />
              )}
              {isPdfExporting ? "PDF 생성 중…" : "PDF 다운로드"}
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                sessionStorage.removeItem("reviewData");
                sessionStorage.removeItem("sessionId");
                sessionStorage.removeItem("finalDecision");
                sessionStorage.removeItem("evidences");
                navigate("/input");
              }}
            >
              <RotateCcw className="mr-2 w-4 h-4" />
              새 검토
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-4">
          <button
            onClick={() => navigate("/result")}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            토의 로그로 돌아가기
          </button>
        </div>

        <div
          ref={reportRef}
          className="verdict-pdf-root rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-10"
          style={{ printColorAdjust: "exact" } as React.CSSProperties}
        >
          <div className="mb-8">
            <h2 className="text-3xl font-semibold text-gray-900 mb-2">최종 검토 보고서</h2>
            <p className="text-gray-600">멀티 에이전트 분석 결과 및 종합 권고사항</p>
          </div>

        {/* Review Info Summary */}
        <Card className="border-gray-200 mb-6 pdf-section">
          <CardContent className="pt-6">
            <div className="grid md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500 mb-1">기업명</p>
                <p className="font-medium text-gray-900">{reviewData.companyName}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">산업 분야</p>
                <p className="font-medium text-gray-900">
                  {reviewData.industry === "tech" ? "IT·소프트웨어" : reviewData.industry}
                </p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">검토 유형</p>
                <p className="font-medium text-gray-900">
                  {reviewData.reviewType === "marketing" ? "마케팅·광고 문구" : reviewData.reviewType}
                </p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">검토 완료 일시</p>
                <p className="font-medium text-gray-900">
                  {new Date().toLocaleDateString("ko-KR")} {new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Verdict */}
        <Card className={`border-2 ${verdictConfig.borderColor} ${verdictConfig.bgColor} mb-6 pdf-section`}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-white rounded-lg flex items-center justify-center`}>
                <VerdictIcon className={`w-7 h-7 ${verdictConfig.color}`} />
              </div>
              <div>
                <CardTitle className={verdictConfig.color}>{verdictConfig.label}</CardTitle>
                <CardDescription className="text-gray-700">{verdictConfig.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 leading-relaxed">
              {finalDecision?.summary ||
                "제출된 마케팅 문구에 대한 법률·리스크·윤리 검토 결과, 여러 개선사항이 확인되었습니다. 하단의 수정안을 반영한 후 사용할 것을 권고드립니다. 특히 법률 리스크가 높게 평가된 부분은 반드시 수정이 필요하며, 법무팀의 최종 검토를 거쳐 주시기 바랍니다."}
            </p>
          </CardContent>
        </Card>

        {/* Risk Summary */}
        <Card className="border-gray-200 mb-6 pdf-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              리스크 요약
            </CardTitle>
            <CardDescription>검토 과정에서 식별된 주요 리스크 항목</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {risks.map((risk, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="mt-0.5">{getRiskIcon(risk.level)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-gray-900">{risk.category}</span>
                      {getRiskBadge(risk.level)}
                    </div>
                    <p className="text-sm text-gray-600">{risk.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Legal Evidences — 공통 컴포넌트 사용 */}
        <EvidenceCardList evidences={evidences} className="mb-6" />

        {/* Key Issues — 리스크 항목에서 동적 생성 */}
        {risks.length > 0 && (
          <Card className="border-gray-200 mb-6">
            <CardHeader>
              <CardTitle>주요 쟁점 사항</CardTitle>
              <CardDescription>에이전트 토의에서 도출된 핵심 문제점</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {risks.map((risk, idx) => {
                  const colors = ["border-blue-500", "border-emerald-500", "border-violet-500", "border-amber-500", "border-rose-500"];
                  return (
                    <div key={idx}>
                      {idx > 0 && <Separator className="mb-4" />}
                      <div className={`border-l-4 ${colors[idx % colors.length]} pl-4`}>
                        <h4 className="font-medium text-gray-900 mb-2">
                          {idx + 1}. {risk.category}
                        </h4>
                        <p className="text-sm text-gray-600 mb-2">{risk.description}</p>
                        {getRiskBadge(risk.level)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Original vs Revised */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                원본 (검토 전)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-white rounded-lg border border-red-200">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-mono">
                  {reviewData.content}
                </p>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-red-700">
                  <AlertTriangle className="w-3 h-3" />
                  <span>법적 리스크: 높음</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-red-700">
                  <AlertTriangle className="w-3 h-3" />
                  <span>객관성 부족, 비하 표현 포함</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                수정안 (권고)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-white rounded-lg border border-green-200">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-mono">
                  {finalDecision?.revisedContent ||
                    "자사 테스트 결과 기존 대비 2배 향상된 성능을 확인했습니다. 혁신적인 기술로 더 나은 사용 경험을 제공합니다.\n\n지금 구매 시 특별 할인 50% 및 추가 사은품을 드립니다. (재고 소진 시까지, 상세 조건은 페이지 하단 참조)"}
                </p>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>법적 리스크: 낮음</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>객관성 확보, 긍정적 표현 사용</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recommendations — AI 응답 기반 */}
        {finalDecision?.recommendation && (
          <Card className="border-gray-200 mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                최종 권고사항
              </CardTitle>
              <CardDescription>실무 적용을 위한 구체적 가이드라인</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {finalDecision.recommendation}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Next Steps */}
        <Card className="border-blue-200 bg-blue-50/50 pdf-section">
          <CardHeader>
            <CardTitle className="text-base">다음 단계</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-gray-700">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                  1
                </span>
                <span>제시된 수정안을 기반으로 최종 문구 작성</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                  2
                </span>
                <span>법무팀 또는 외부 법률 자문을 통한 최종 검토</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                  3
                </span>
                <span>성능 비교 데이터의 객관적 근거 자료 확보 및 보관</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                  4
                </span>
                <span>마케팅 캠페인 론칭 후 소비자 피드백 모니터링</span>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Footer Note */}
        <div className="mt-8 p-6 bg-gray-100 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-700 leading-relaxed">
            <strong>유의사항:</strong> 본 보고서는 AI 기반 멀티 에이전트 시스템에 의한 분석 결과이며, 
            참고 자료로 활용하시기 바랍니다. 최종 의사결정은 법무팀, 컴플라이언스팀 등 
            사내 전문가의 검토를 거쳐 진행하시고, 필요시 외부 법률 자문을 받으시기 바랍니다. 
            본 시스템은 법률 자문을 제공하지 않으며, 실제 법적 판단에 대한 책임을 지지 않습니다.
          </p>
        </div>
        </div>
      </main>
    </div>
  );
}
