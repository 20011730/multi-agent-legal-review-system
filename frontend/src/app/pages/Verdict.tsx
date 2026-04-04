import { useEffect, useState } from "react";
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
  RotateCcw,
  BookOpen,
  ExternalLink,
} from "lucide-react";

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

interface EvidenceItem {
  sourceType: string;
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  url?: string;
  relevanceReason?: string;
}

export function Verdict() {
  const navigate = useNavigate();
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">LegalReview AI</h1>
              <p className="text-xs text-gray-500">Multi-Agent Legal Compliance System</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="mr-2 w-4 h-4" />
              PDF 다운로드
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
        <div className="mb-8">
          <button
            onClick={() => navigate("/result")}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            토의 로그로 돌아가기
          </button>
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">최종 검토 보고서</h2>
          <p className="text-gray-600">멀티 에이전트 분석 결과 및 종합 권고사항</p>
        </div>

        {/* Review Info Summary */}
        <Card className="border-gray-200 mb-6">
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
        <Card className={`border-2 ${verdictConfig.borderColor} ${verdictConfig.bgColor} mb-6`}>
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
        <Card className="border-gray-200 mb-6">
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

        {/* Legal Evidences */}
        {evidences.length > 0 && (
          <Card className="border-gray-200 mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                법령·판례 근거
              </CardTitle>
              <CardDescription>분석에 참조된 법령 및 판례 자료</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {evidences.map((ev, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <Badge
                      className={`text-xs flex-shrink-0 mt-0.5 ${
                        ev.sourceType === "LAW"
                          ? "bg-blue-600"
                          : "bg-purple-600"
                      }`}
                    >
                      {ev.sourceType === "LAW" ? "법령" : "판례"}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-gray-900 truncate">
                          {ev.title}
                        </span>
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      {ev.articleOrCourt && (
                        <p className="text-xs text-gray-500 mb-1">
                          {ev.sourceType === "LAW" ? "소관: " : "법원: "}
                          {ev.articleOrCourt}
                          {ev.referenceId ? ` | ${ev.referenceId}` : ""}
                        </p>
                      )}
                      {ev.summary && (
                        <p className="text-xs text-gray-600">{ev.summary}</p>
                      )}
                      {ev.relevanceReason && (
                        <p className="text-xs text-indigo-600 mt-1">
                          {ev.relevanceReason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Key Issues */}
        <Card className="border-gray-200 mb-6">
          <CardHeader>
            <CardTitle>주요 쟁점 사항</CardTitle>
            <CardDescription>에이전트 토의에서 도출된 핵심 문제점</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="border-l-4 border-blue-500 pl-4">
                <h4 className="font-medium text-gray-900 mb-2">1. 비교 광고의 객관성 부족</h4>
                <p className="text-sm text-gray-600 mb-2">
                  '업계 1위 제품보다 2배 빠른 성능'이라는 주장에 대한 공인 기관의 시험 결과나 
                  객관적 데이터가 제시되지 않았습니다. 표시광고법상 비교 광고는 객관적이고 
                  입증 가능한 사실에 근거해야 합니다.
                </p>
                <Badge variant="outline" className="text-xs">표시광고법 제3조</Badge>
              </div>

              <Separator />

              <div className="border-l-4 border-emerald-500 pl-4">
                <h4 className="font-medium text-gray-900 mb-2">2. 경쟁사 비하 표현</h4>
                <p className="text-sm text-gray-600 mb-2">
                  '타사 제품은 구시대 유물'이라는 표현은 경쟁사에 대한 직접적 비하에 해당합니다. 
                  이는 부정경쟁방지법상 문제가 될 수 있으며, 기업 이미지에도 부정적 영향을 줄 수 있습니다.
                </p>
                <Badge variant="outline" className="text-xs">부정경쟁방지법</Badge>
              </div>

              <Separator />

              <div className="border-l-4 border-violet-500 pl-4">
                <h4 className="font-medium text-gray-900 mb-2">3. 과도한 긴박감 조성</h4>
                <p className="text-sm text-gray-600 mb-2">
                  '한정 수량', '서둘러', '놓치면 후회' 등의 표현이 실제 재고 현황과 무관하게 
                  사용된다면 소비자를 기만하는 것으로 간주될 수 있습니다. 소비자의 합리적 
                  의사결정을 방해하는 압박 마케팅은 지양해야 합니다.
                </p>
                <Badge variant="outline" className="text-xs">소비자보호</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

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

        {/* Recommendations */}
        <Card className="border-gray-200 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              최종 권고사항
            </CardTitle>
            <CardDescription>실무 적용을 위한 구체적 가이드라인</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-xs font-semibold text-blue-700">
                    1
                  </div>
                  법적 안전성 확보
                </h4>
                <ul className="space-y-2 ml-8 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-1">•</span>
                    <span>성능 비교 데이터는 '자사 테스트', '당사 기준' 등 출처를 명확히 표시</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-1">•</span>
                    <span>제3자 검증 기관의 인증이 있다면 해당 내용을 추가로 명시</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-1">•</span>
                    <span>경쟁사 직접 비하 표현은 전면 삭제하고 자사 강점에 집중</span>
                  </li>
                </ul>
              </div>

              <Separator />

              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center text-xs font-semibold text-emerald-700">
                    2
                  </div>
                  리스크 관리
                </h4>
                <ul className="space-y-2 ml-8 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 mt-1">•</span>
                    <span>할인율 및 사은품 관련 상세 조건을 명시하여 소비자 오해 방지</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 mt-1">•</span>
                    <span>한정 수량은 실제 재고를 기반으로 하며, 소진 시 안내 문구 자동 변경</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 mt-1">•</span>
                    <span>사후 소비자 불만 대응 프로세스 및 환불 정책 사전 수립</span>
                  </li>
                </ul>
              </div>

              <Separator />

              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <div className="w-6 h-6 bg-violet-100 rounded-full flex items-center justify-center text-xs font-semibold text-violet-700">
                    3
                  </div>
                  윤리적 커뮤니케이션
                </h4>
                <ul className="space-y-2 ml-8 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-violet-600 mt-1">•</span>
                    <span>압박적 표현 대신 제품 혜택과 가치를 중심으로 재구성</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-violet-600 mt-1">•</span>
                    <span>소비자 선택권을 존중하는 톤앤매너 유지</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-violet-600 mt-1">•</span>
                    <span>ESG 경영 원칙에 부합하는 투명하고 공정한 마케팅 메시지 구사</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card className="border-blue-200 bg-blue-50/50">
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
      </main>
    </div>
  );
}
