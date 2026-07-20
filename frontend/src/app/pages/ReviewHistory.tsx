import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Clock, FileText, Loader2, MessageCircle, Search, ShieldCheck } from "lucide-react";

interface ReviewSummary {
  sessionId: number;
  companyName: string;
  reviewType: string;
  situation: string;
  status: string;
  createdAt: string;
  verdict: string | null;
  riskLevel: string | null;
  riskSummary?: string | null;
  messageCount?: number;
  evidenceCount?: number;
  followUpQuestionCount?: number;
  reanalysisQuestionCount?: number;
  assistantMessageCount?: number;
}

type FilterKey = "all" | "active" | "completed" | "reanalysis" | "assistant";
type SortKey = "newest" | "oldest";

const reviewTypeLabels: Record<string, string> = {
  marketing: "마케팅",
  press: "보도자료",
  contract: "계약",
  policy: "정책",
  communication: "커뮤니케이션",
  decision: "의사결정",
};

const verdictConfig: Record<string, { label: string; color: string }> = {
  approved: { label: "승인", color: "bg-emerald-100 text-emerald-700" },
  conditional: { label: "조건부", color: "bg-amber-100 text-amber-700" },
  rejected: { label: "재검토", color: "bg-red-100 text-red-700" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "최종 판정 완료", color: "bg-emerald-100 text-emerald-700" },
  ANALYZING: { label: "검토 진행 중", color: "bg-blue-100 text-blue-700" },
  REANALYZING: { label: "추가 재검토 진행 중", color: "bg-amber-100 text-amber-700" },
  WAITING_FOR_USER_INPUT: { label: "Round 1 완료 · 사용자 입력 대기", color: "bg-indigo-100 text-indigo-700" },
  WAITING_FOR_ROUND2_INPUT: { label: "Round 1 완료 · 사용자 입력 대기", color: "bg-indigo-100 text-indigo-700" },
  WAITING_FOR_FINAL_INPUT: { label: "Round 2 완료 · 사용자 입력 대기", color: "bg-violet-100 text-violet-700" },
  WAITING_FOR_ROUND3_INPUT: { label: "Round 2 완료 · 사용자 입력 대기", color: "bg-violet-100 text-violet-700" },
  WAITING_FOR_ROUND4_INPUT: { label: "Round 3 완료 · 사용자 입력 대기", color: "bg-sky-100 text-sky-700" },
  WAITING_FOR_ROUND5_INPUT: { label: "Round 4 완료 · 사용자 입력 대기", color: "bg-amber-100 text-amber-700" },
  FAILED: { label: "검토 중단", color: "bg-red-100 text-red-700" },
};

function statusMeta(status: string) {
  return statusConfig[status] || { label: "상태 확인 중", color: "bg-slate-100 text-slate-700" };
}

function riskLabel(level?: string | null) {
  switch ((level || "").toUpperCase()) {
    case "HIGH":
      return "위험도 높음";
    case "MEDIUM":
      return "위험도 보통";
    case "LOW":
      return "위험도 낮음";
    default:
      return "";
  }
}

function safeText(text?: string | null) {
  const value = (text || "").trim();
  if (!value) return "";
  if (/vector|similarity|distance|score|collection|stack trace|endpoint|serviceKey|API key|OLLAMA|파싱 실패|파싱에 실패|기본 판정|판정 생성 실패|AI 판정/i.test(value)) {
    return "핵심 리스크 요약을 불러오지 못했습니다.";
  }
  return value;
}

export function ReviewHistory() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (!userStr) {
      navigate("/login");
      return;
    }

    const user = JSON.parse(userStr);
    fetch("http://localhost:8080/api/reviews", {
      headers: { "X-User-Id": String(user.id) },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load history");
        return res.json();
      })
      .then((data) => setReviews(data))
      .catch((err) => {
        console.error(err);
        setError("히스토리를 불러오지 못했습니다.");
      })
      .finally(() => setIsLoading(false));
  }, [navigate]);

  const visibleReviews = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reviews
      .filter((review) => {
        if (filter === "active") return review.status !== "COMPLETED";
        if (filter === "completed") return review.status === "COMPLETED";
        if (filter === "reanalysis") return (review.reanalysisQuestionCount || 0) > 0;
        if (filter === "assistant") return (review.assistantMessageCount || 0) > 0;
        return true;
      })
      .filter((review) => {
        if (!q) return true;
        return `${review.companyName} ${review.situation} ${review.reviewType}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sort === "oldest" ? diff : -diff;
      });
  }, [filter, query, reviews, sort]);

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
          <Button className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white" onClick={() => navigate("/input")}>새 상담</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle>내 자문 히스토리</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "전체"],
                  ["active", "진행 중"],
                  ["completed", "완료"],
                  ["reanalysis", "추가 재검토 있음"],
                  ["assistant", "비서 상담 있음"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key as FilterKey)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      filter === key
                        ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 lg:w-72">
                  <Search className="h-4 w-4 shrink-0" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="기업명 또는 제목 검색"
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                </label>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none"
                >
                  <option value="newest">최신순</option>
                  <option value="oldest">오래된 순</option>
                </select>
              </div>
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin" />로딩 중...</div>
            )}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {!isLoading && !error && reviews.length === 0 && (
              <div className="text-center py-10 text-slate-600">
                <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                아직 기록이 없습니다.
              </div>
            )}
            {!isLoading && !error && reviews.length > 0 && visibleReviews.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">조건에 맞는 기록이 없습니다.</div>
            )}
            <div className="space-y-3">
              {visibleReviews.map((review) => {
                const status = statusMeta(review.status);
                const isCompleted = review.status === "COMPLETED";
                const risk = isCompleted ? riskLabel(review.riskLevel) : "";
                return (
                  <button
                    key={review.sessionId}
                    className="w-full text-left rounded-xl border border-slate-200 p-4 hover:border-[#1E3A8A]/40 hover:bg-slate-50 transition-colors"
                    onClick={() => navigate(`/reviews/${review.sessionId}`)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{review.companyName}</p>
                        <p className="text-sm text-slate-600 truncate">{review.situation}</p>
                        {isCompleted ? (review.riskSummary || risk) && (
                          <p className="mt-1 text-xs text-slate-500 truncate">
                            {risk && <span className="font-medium text-slate-700">{risk}</span>}
                            {risk && review.riskSummary ? " · " : ""}
                            {safeText(review.riskSummary)}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs font-medium text-blue-700">검토 진행 중</p>
                        )}
                        <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(review.createdAt).toLocaleString()}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(review.followUpQuestionCount || 0) > 0 && (
                            <Badge variant="outline" className="bg-indigo-50 text-indigo-700">추가 질문 반영</Badge>
                          )}
                          {(review.reanalysisQuestionCount || 0) > 0 && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700">추가 재검토 결과 있음</Badge>
                          )}
                          {(review.evidenceCount || 0) > 0 && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                              <ShieldCheck className="mr-1 h-3 w-3" />근거 {review.evidenceCount}건
                            </Badge>
                          )}
                          {(review.assistantMessageCount || 0) > 0 && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">
                              <MessageCircle className="mr-1 h-3 w-3" />비서 상담 있음
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <Badge variant="outline">{reviewTypeLabels[review.reviewType] || review.reviewType}</Badge>
                        {isCompleted && review.verdict && <Badge className={verdictConfig[review.verdict]?.color || "bg-slate-100 text-slate-700"}>{verdictConfig[review.verdict]?.label || review.verdict}</Badge>}
                        <Badge className={status.color}>{status.label}</Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
