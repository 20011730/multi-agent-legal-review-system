import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
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
  Loader2,
  Shield,
  FileCheck,
} from "lucide-react";

interface AgentMessage {
  agentId: string;
  agentName: string;
  content: string;
  type: string;
  round: number;
  stance: string;
  evidenceSummary: string;
}

interface RiskItem {
  category: string;
  level: string;
  description: string;
}

interface FinalDecision {
  verdict: string;
  riskLevel: string;
  risks: RiskItem[];
  summary: string;
  recommendation: string;
  revisedContent: string;
}

interface ReviewDetail {
  sessionId: number;
  companyName: string;
  industry: string;
  reviewType: string;
  situation: string;
  content: string;
  participationMode: string;
  status: string;
  createdAt: string;
  messages: AgentMessage[];
  finalDecision: FinalDecision | null;
}

const reviewTypeLabels: Record<string, string> = {
  marketing: "마케팅·광고 문구",
  press: "보도자료·공시",
  contract: "계약서·약관",
  policy: "사내 규정·정책",
  communication: "대외 커뮤니케이션",
  decision: "경영 의사결정",
};

const agentConfig: Record<string, { icon: typeof Shield; color: string; bg: string }> = {
  legal: { icon: Scale, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  risk: { icon: Shield, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  ethics: { icon: FileCheck, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
};

const verdictConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "승인", color: "text-green-700", icon: CheckCircle2 },
  conditional: { label: "조건부 수정 권고", color: "text-amber-700", icon: AlertTriangle },
  rejected: { label: "반려", color: "text-red-700", icon: XCircle },
};

const riskLevelIcon: Record<string, typeof TrendingUp> = {
  HIGH: TrendingUp,
  MEDIUM: Minus,
  LOW: TrendingDown,
};

export function ReviewDetailPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"debate" | "verdict">("debate");

  useEffect(() => {
    if (!sessionId) {
      navigate("/reviews");
      return;
    }

    fetch(`http://localhost:8080/api/reviews/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("조회 실패");
        return res.json();
      })
      .then((data) => setDetail(data))
      .catch((err) => {
        console.error("검토 상세 조회 실패:", err);
        setError("검토 내용을 불러오는데 실패했습니다.");
      })
      .finally(() => setIsLoading(false));
  }, [sessionId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <span className="ml-3 text-gray-500">불러오는 중...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "데이터를 찾을 수 없습니다"}</p>
          <Button onClick={() => navigate("/reviews")}>목록으로</Button>
        </div>
      </div>
    );
  }

  const fd = detail.finalDecision;
  const vc = fd ? verdictConfig[fd.verdict] : null;
  const VerdictIcon = vc?.icon;

  // 라운드별 그룹화
  const rounds: Record<number, AgentMessage[]> = {};
  detail.messages.forEach((m) => {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
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
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Back + title */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/reviews")}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            검토 기록으로 돌아가기
          </button>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-semibold text-gray-900">
              검토 상세
            </h2>
            {vc && VerdictIcon && (
              <Badge className={`${vc.color} border`}>
                <VerdictIcon className="w-4 h-4 mr-1" />
                {vc.label}
              </Badge>
            )}
          </div>
        </div>

        {/* Session info */}
        <Card className="border-gray-200 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              검토 요청 정보
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500">기업명</p>
                <p className="font-medium text-gray-900">{detail.companyName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">검토 유형</p>
                <p className="font-medium text-gray-900">
                  {reviewTypeLabels[detail.reviewType] || detail.reviewType}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">요청 일시</p>
                <p className="font-medium text-gray-900">
                  {new Date(detail.createdAt).toLocaleDateString("ko-KR", {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-1">상황 설명</p>
              <p className="text-sm text-gray-700">{detail.situation}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">검토 원문</p>
              <div className="p-3 bg-gray-50 rounded-lg border">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{detail.content}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tab buttons */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "debate" ? "default" : "outline"}
            onClick={() => setActiveTab("debate")}
            className={activeTab === "debate" ? "bg-blue-600 text-white" : ""}
          >
            토론 내용
          </Button>
          <Button
            variant={activeTab === "verdict" ? "default" : "outline"}
            onClick={() => setActiveTab("verdict")}
            className={activeTab === "verdict" ? "bg-blue-600 text-white" : ""}
          >
            최종 판정
          </Button>
        </div>

        {/* Debate tab */}
        {activeTab === "debate" && (
          <div className="space-y-6">
            {Object.entries(rounds).map(([roundNum, msgs]) => (
              <Card key={roundNum} className="border-gray-200">
                <CardHeader>
                  <CardTitle className="text-lg">
                    라운드 {roundNum}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {msgs.map((msg, idx) => {
                    const ac = agentConfig[msg.agentId] || agentConfig.legal;
                    const AgentIcon = ac.icon;
                    return (
                      <div key={idx} className={`p-4 rounded-lg border ${ac.bg}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <AgentIcon className={`w-4 h-4 ${ac.color}`} />
                          <span className={`font-medium text-sm ${ac.color}`}>
                            {msg.agentName}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {msg.stance}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-800 mb-2">{msg.content}</p>
                        {msg.evidenceSummary && (
                          <p className="text-xs text-gray-500">
                            근거: {msg.evidenceSummary}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Verdict tab */}
        {activeTab === "verdict" && fd && (
          <div className="space-y-6">
            {/* Summary */}
            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle>판정 요약</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  {vc && VerdictIcon && (
                    <div className="flex items-center gap-2">
                      <VerdictIcon className={`w-6 h-6 ${vc.color}`} />
                      <span className={`text-lg font-semibold ${vc.color}`}>
                        {vc.label}
                      </span>
                    </div>
                  )}
                  <Badge className={
                    fd.riskLevel === "HIGH" ? "bg-red-100 text-red-700" :
                    fd.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" :
                    "bg-green-100 text-green-700"
                  }>
                    위험도: {fd.riskLevel}
                  </Badge>
                </div>
                <p className="text-gray-700">{fd.summary}</p>
              </CardContent>
            </Card>

            {/* Risks */}
            {fd.risks.length > 0 && (
              <Card className="border-gray-200">
                <CardHeader>
                  <CardTitle>위험 요소</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {fd.risks.map((risk, idx) => {
                      const RiskIcon = riskLevelIcon[risk.level?.toUpperCase()] || Minus;
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <RiskIcon className={`w-5 h-5 mt-0.5 ${
                            risk.level === "high" ? "text-red-600" :
                            risk.level === "medium" ? "text-amber-600" :
                            "text-green-600"
                          }`} />
                          <div>
                            <p className="font-medium text-sm text-gray-900">{risk.category}</p>
                            <p className="text-sm text-gray-600">{risk.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recommendation */}
            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle>권고사항</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 mb-4">{fd.recommendation}</p>
                {fd.revisedContent && (
                  <>
                    <Separator className="my-4" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">수정 제안 문구</p>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-900 whitespace-pre-wrap">{fd.revisedContent}</p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/reviews")}
              >
                목록으로
              </Button>
              <Button
                onClick={() => navigate("/input")}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                새 검토 시작
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
