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
        if (!res.ok) throw new Error("목록 조회 실패");
        return res.json();
      })
      .then((data) => setReviews(data))
      .catch((err) => {
        console.error("검토 기록 조회 실패:", err);
        setError("검토 기록을 불러오는데 실패했습니다.");
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dbeafe_0%,_#f8fafc_45%,_#f8fafc_100%)]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 hover:opacity-70 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="font-semibold text-slate-900">LexRex AI</h1>
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

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </button>
          <h2 className="text-3xl font-semibold text-slate-900 tracking-tight mb-2">
            검토 기록
          </h2>
          <p className="text-slate-600">
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
                  className="border-slate-200/80 bg-white/95 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => handleReviewClick(review.sessionId)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-slate-900 truncate">
                            {review.companyName}
                          </h3>
                          <Badge variant="outline" className="shrink-0">
                            {reviewTypeLabels[review.reviewType] ||
                              review.reviewType}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                          {review.situation}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
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
