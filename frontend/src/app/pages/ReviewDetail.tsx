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
  Gavel,
} from "lucide-react";
import { EvidenceCardList } from "../components/EvidenceCard";
import { normalizeEvidences } from "../utils/normalizeEvidence";

/* ── 메시지 렌더링 유틸 (Result.tsx와 동일한 로직) ── */
function renderAgentContent(content: string) {
  return content.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return <h4 key={i} className="font-semibold text-slate-800 mt-3 mb-1 text-sm">{trimmed.replace(/^##\s*/, "")}</h4>;
    }
    if (trimmed === "") return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm text-slate-700 leading-relaxed">{line}</p>;
  });
}

function renderJudgeContent(content: string) {
  if (content.includes("## ")) {
    return (
      <div className="space-y-1">
        {content.split("\n").map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("## "))
            return <h4 key={i} className="font-semibold text-violet-800 mt-2 mb-1 text-sm">{trimmed.replace(/^##\s*/, "")}</h4>;
          if (trimmed === "") return <div key={i} className="h-1" />;
          return <p key={i} className="text-sm text-slate-700 leading-relaxed">{line}</p>;
        })}
      </div>
    );
  }
  try {
    let json = content.trim();
    if (json.includes("```json")) {
      json = json.substring(json.indexOf("```json") + 7, json.indexOf("```", json.indexOf("```json") + 7)).trim();
    }
    if (json.startsWith("{")) {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const recommendation = typeof parsed.recommendation === "string" ? parsed.recommendation : "";
      const revisedContent = typeof parsed.revisedContent === "string" ? parsed.revisedContent : "";
      return (
        <div className="space-y-2 text-sm text-slate-700">
          {summary && <p className="leading-relaxed">📋 {summary}</p>}
          {recommendation && <p className="leading-relaxed mt-1">💡 {recommendation}</p>}
          {revisedContent && (
            <div className="mt-2 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="text-xs font-semibold text-violet-700 mb-1">수정 문안 제안</p>
              <p className="text-violet-800">{revisedContent}</p>
            </div>
          )}
        </div>
      );
    }
  } catch { /* fallback */ }
  return <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{content}</p>;
}

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

interface EvidenceItem {
  sourceType: string;
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  url?: string;
  relevanceReason?: string;
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
  evidences?: EvidenceItem[];
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
  legal:  { icon: Scale,  color: "text-blue-700",   bg: "bg-blue-50 border-blue-200" },
  risk:   { icon: Shield, color: "text-amber-700",  bg: "bg-amber-50 border-amber-200" },
  ethics: { icon: Gavel,  color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
  judge:  { icon: Gavel,  color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
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
      <div className="min-h-screen bg-[#ffffffff] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1E3A8A] animate-spin" />
        <span className="ml-3 text-slate-500">불러오는 중...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-[#ffffffff] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "데이터를 찾을 수 없습니다"}</p>
          <Button
            onClick={() => navigate("/reviews")}
            className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
          >
            목록으로
          </Button>
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
    <div className="min-h-screen bg-[#ffffffff] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#ffffffff]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-5 md:px-7 flex items-center justify-between h-[74px]">
          <button
            onClick={() => navigate("/")}
            className="min-w-[220px] text-left py-1"
          >
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
            onClick={() => navigate("/reviews")}
          >
            히스토리
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-[1240px] w-full mx-auto px-5 md:px-6 py-12 md:py-14">
        {/* Back + title */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/reviews")}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            검토 기록으로 돌아가기
          </button>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">
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

        <Card className="border-slate-200 bg-white shadow-sm rounded-3xl mb-6 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              검토 요청 정보
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-slate-500">기업명</p>
                <p className="font-medium text-slate-900">{detail.companyName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">검토 유형</p>
                <p className="font-medium text-slate-900">
                  {reviewTypeLabels[detail.reviewType] || detail.reviewType}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">요청 일시</p>
                <p className="font-medium text-slate-900">
                  {new Date(detail.createdAt).toLocaleDateString("ko-KR", {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1">상황 설명</p>
              <p className="text-sm text-slate-700">{detail.situation}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">검토 원문</p>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{detail.content}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "debate" ? "default" : "outline"}
            onClick={() => setActiveTab("debate")}
            className={
              activeTab === "debate"
                ? "rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                : "rounded-full border-[#64748B]/35 text-slate-700 hover:bg-white"
            }
          >
            토론 내용
          </Button>
          <Button
            variant={activeTab === "verdict" ? "default" : "outline"}
            onClick={() => setActiveTab("verdict")}
            className={
              activeTab === "verdict"
                ? "rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                : "rounded-full border-[#64748B]/35 text-slate-700 hover:bg-white"
            }
          >
            최종 판정
          </Button>
        </div>

        {activeTab === "debate" && (
          <div className="space-y-6">
            {Object.entries(rounds).map(([roundNum, msgs]) => (
              <Card key={roundNum} className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-lg">
                    라운드 {roundNum}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {msgs.map((msg, idx) => {
                    // ethics → judge 호환 처리
                    const resolvedId = msg.agentId === "ethics" ? "judge" : msg.agentId;
                    const ac = agentConfig[resolvedId] || agentConfig.legal;
                    const AgentIcon = ac.icon;
                    const isJudge = resolvedId === "judge";
                    return (
                      <div key={idx} className={`p-4 rounded-xl border ${ac.bg}`}>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <AgentIcon className={`w-4 h-4 ${ac.color}`} />
                          <span className={`font-medium text-sm ${ac.color}`}>
                            {msg.agentName}
                          </span>
                          {msg.stance && (
                            <Badge variant="outline" className="text-xs">
                              {msg.stance}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {msg.type}
                          </Badge>
                        </div>
                        <div className="mt-1">
                          {isJudge ? renderJudgeContent(msg.content) : renderAgentContent(msg.content)}
                        </div>
                        {msg.evidenceSummary && (
                          <p className="text-xs text-slate-500 mt-2">
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

        {activeTab === "verdict" && !fd && (
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <p className="text-slate-700 font-medium mb-1">최종 판정 정보가 아직 없습니다.</p>
                <p className="text-sm text-slate-500">
                  {detail.status === "COMPLETED"
                    ? "분석이 완료되었지만 판정 데이터가 저장되지 않았습니다. 새로 검토를 시작해 주세요."
                    : "분석이 진행 중이거나 미완료 상태입니다. 분석이 끝난 뒤 다시 확인해 주세요."}
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <Button variant="outline" onClick={() => navigate("/reviews")}>목록으로</Button>
                  <Button
                    onClick={() => navigate("/input")}
                    className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                  >
                    새 검토 시작
                  </Button>
                </div>
              </CardContent>
            </Card>
            {/* 판정이 없어도 evidence가 있으면 일관되게 표시 */}
            <EvidenceCardList evidences={normalizeEvidences(detail)} />
          </div>
        )}

        {activeTab === "verdict" && fd && (
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
              <CardHeader>
                <CardTitle>판정 요약</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {vc && VerdictIcon ? (
                    <div className="flex items-center gap-2">
                      <VerdictIcon className={`w-6 h-6 ${vc.color}`} />
                      <span className={`text-lg font-semibold ${vc.color}`}>
                        {vc.label}
                      </span>
                    </div>
                  ) : fd.verdict ? (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-slate-500" />
                      <span className="text-lg font-semibold text-slate-700">{fd.verdict}</span>
                    </div>
                  ) : null}
                  {fd.riskLevel && (
                    <Badge className={
                      fd.riskLevel === "HIGH" ? "bg-red-100 text-red-700" :
                      fd.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" :
                      "bg-green-100 text-green-700"
                    }>
                      위험도: {fd.riskLevel}
                    </Badge>
                  )}
                </div>
                {fd.summary
                  ? <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{fd.summary}</p>
                  : <p className="text-sm text-slate-400">요약이 제공되지 않았습니다.</p>}
              </CardContent>
            </Card>

            {Array.isArray(fd.risks) && fd.risks.length > 0 && (
              <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle>위험 요소</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {fd.risks.map((risk, idx) => {
                      const lvl = (risk.level || "").toLowerCase();
                      const RiskIcon = riskLevelIcon[(risk.level || "").toUpperCase()] || Minus;
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                          <RiskIcon className={`w-5 h-5 mt-0.5 ${
                            lvl === "high" ? "text-red-600" :
                            lvl === "medium" ? "text-amber-600" :
                            "text-green-600"
                          }`} />
                          <div>
                            <p className="font-medium text-sm text-slate-900">{risk.category}</p>
                            <p className="text-sm text-slate-600">{risk.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {(fd.recommendation || fd.revisedContent) && (
              <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle>권고사항</CardTitle>
                </CardHeader>
                <CardContent>
                  {fd.recommendation && (
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed mb-4">{fd.recommendation}</p>
                  )}
                  {fd.revisedContent && (
                    <>
                      {fd.recommendation && <Separator className="my-4" />}
                      <div>
                        <p className="text-sm font-medium text-slate-900 mb-2">수정 제안 문구</p>
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                          <p className="text-sm text-green-900 whitespace-pre-wrap">{fd.revisedContent}</p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Legal Evidences — 공통 컴포넌트 사용 */}
            <EvidenceCardList evidences={normalizeEvidences(detail)} />

            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/reviews")}
              >
                목록으로
              </Button>
              <Button
                onClick={() => navigate("/input")}
                className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
              >
                새 검토 시작
              </Button>
            </div>
          </div>
        )}
      </main>
      <footer className="border-t border-[#64748B]/25 bg-[#ffffffff] mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
