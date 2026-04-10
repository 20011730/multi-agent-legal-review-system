import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Scale,
  ArrowLeft,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

interface ReviewSummary {
  sessionId: number;
  companyName: string;
  reviewType: string;
  situation: string;
  status: string;
  createdAt: string;
  verdict: string | null;
  riskLevel: string | null;
}

const reviewTypeLabels: Record<string, string> = {
  marketing: "마케팅·광고",
  press: "보도자료·공시",
  contract: "계약서·약관",
  policy: "사내 규정·정책",
  communication: "대외 커뮤니케이션",
  decision: "경영 의사결정",
};

const verdictConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "승인", color: "bg-green-100 text-green-800", icon: CheckCircle2 },
  conditional: { label: "조건부 수정", color: "bg-amber-100 text-amber-800", icon: AlertTriangle },
  rejected: { label: "반려", color: "bg-red-100 text-red-800", icon: XCircle },
};

const riskColors: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-green-100 text-green-700",
};

export function ReviewHistory() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // [DEBUG] 문제 해결 후 제거 가능 — 디버그 상태
  const [debugInfo, setDebugInfo] = useState<{
    userId: string | null;
    fetchStatus: string;
    responseLength: number | null;
  }>({ userId: null, fetchStatus: "pending", responseLength: null });

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    console.log("[ReviewHistory] localStorage raw:", userStr);

    if (!userStr) {
      console.warn("[ReviewHistory] 로그인 정보 없음 → /login 리다이렉트");
      setDebugInfo((prev) => ({ ...prev, userId: "(없음)", fetchStatus: "no-user" }));
      navigate("/login");
      return;
    }

    const user = JSON.parse(userStr);
    const userId = user.id ? String(user.id) : "(id 없음)";
    console.log("[ReviewHistory] parsed user:", user, "→ X-User-Id:", userId);
    setDebugInfo((prev) => ({ ...prev, userId }));

    if (!user.id) {
      console.error("[ReviewHistory] user.id가 없습니다! localStorage 값:", userStr);
      setDebugInfo((prev) => ({ ...prev, fetchStatus: "no-user-id" }));
      setError("로그인 정보에 사용자 ID가 없습니다. 다시 로그인해주세요.");
      setIsLoading(false);
      return;
    }

    fetch("http://localhost:8080/api/reviews", {
      headers: { "X-User-Id": String(user.id) },
    })
      .then((res) => {
        console.log("[ReviewHistory] fetch status:", res.status);
        if (!res.ok) throw new Error(`목록 조회 실패 (status=${res.status})`);
        return res.json();
      })
      .then((data) => {
        console.log("[ReviewHistory] 응답 데이터:", data.length, "건", data);
        setReviews(data);
        setDebugInfo((prev) => ({
          ...prev,
          fetchStatus: `OK (${data.length}건)`,
          responseLength: data.length,
        }));
      })
      .catch((err) => {
        console.error("[ReviewHistory] 검토 기록 조회 실패:", err);
        setError("검토 기록을 불러오는데 실패했습니다.");
        setDebugInfo((prev) => ({ ...prev, fetchStatus: `error: ${err.message}` }));
      })
      .finally(() => setIsLoading(false));
  }, [navigate]);

  const handleReviewClick = (sessionId: number) => {
    navigate(`/reviews/${sessionId}`);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
              <p className="text-xs text-gray-500">
                Multi-Agent Legal Compliance System
              </p>
            </div>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/input")}
          >
            <FileText className="w-4 h-4 mr-2" />새 검토
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* [DEBUG] 문제 해결 후 이 블록 전체를 제거하세요 */}
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-xs font-mono text-yellow-900">
          <p><strong>[DEBUG]</strong> userId: {debugInfo.userId ?? "(로딩중)"} | fetchStatus: {debugInfo.fetchStatus} | reviews: {debugInfo.responseLength ?? "-"}</p>
        </div>
        {/* [/DEBUG] */}

        <div className="mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </button>
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">
            검토 기록
          </h2>
          <p className="text-gray-600">
            지금까지 진행한 법률 검토 기록을 확인하세요
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <span className="ml-3 text-gray-500">불러오는 중...</span>
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {!isLoading && !error && reviews.length === 0 && (
          <div className="text-center py-20">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              아직 검토 기록이 없습니다
            </h3>
            <p className="text-gray-500 mb-6">
              새 검토를 시작하여 첫 번째 법률 검토를 진행하세요
            </p>
            <Button
              onClick={() => navigate("/input")}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              검토 시작하기
            </Button>
          </div>
        )}

        {!isLoading && reviews.length > 0 && (
          <div className="space-y-4">
            {reviews.map((review) => {
              const vc = review.verdict
                ? verdictConfig[review.verdict]
                : null;
              const VerdictIcon = vc?.icon;

              return (
                <Card
                  key={review.sessionId}
                  className="border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => handleReviewClick(review.sessionId)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-gray-900 truncate">
                            {review.companyName}
                          </h3>
                          <Badge variant="outline" className="shrink-0">
                            {reviewTypeLabels[review.reviewType] ||
                              review.reviewType}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                          {review.situation}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDate(review.createdAt)}
                        </div>
                      </div>

                      {/* Right - badges */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {vc && VerdictIcon && (
                          <Badge className={vc.color}>
                            <VerdictIcon className="w-3.5 h-3.5 mr-1" />
                            {vc.label}
                          </Badge>
                        )}
                        {review.riskLevel && (
                          <Badge
                            className={
                              riskColors[review.riskLevel] ||
                              "bg-gray-100 text-gray-700"
                            }
                          >
                            위험도: {review.riskLevel}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
