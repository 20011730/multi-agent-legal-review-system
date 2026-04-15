import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Clock, FileText, Loader2 } from "lucide-react";

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
  marketing: "Marketing",
  press: "Press",
  contract: "Contract",
  policy: "Policy",
  communication: "Communication",
  decision: "Decision",
};

const verdictConfig: Record<string, { label: string; color: string }> = {
  approved: { label: "승인", color: "bg-emerald-100 text-emerald-700" },
  conditional: { label: "조건부", color: "bg-amber-100 text-amber-700" },
  rejected: { label: "재검토", color: "bg-red-100 text-red-700" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "완료", color: "bg-emerald-100 text-emerald-700" },
  IN_PROGRESS: { label: "진행 중", color: "bg-blue-100 text-blue-700" },
  RECHECKING: { label: "재검토 중", color: "bg-amber-100 text-amber-700" },
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
            <div className="space-y-3">
              {reviews.map((review) => (
                <button
                  key={review.sessionId}
                  className="w-full text-left rounded-xl border border-slate-200 p-4 hover:border-[#1E3A8A]/40 hover:bg-slate-50 transition-colors"
                  onClick={() => navigate(`/reviews/${review.sessionId}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{review.companyName}</p>
                      <p className="text-sm text-slate-600 truncate">{review.situation}</p>
                      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(review.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant="outline">{reviewTypeLabels[review.reviewType] || review.reviewType}</Badge>
                      {review.verdict && <Badge className={verdictConfig[review.verdict]?.color || "bg-slate-100 text-slate-700"}>{verdictConfig[review.verdict]?.label || review.verdict}</Badge>}
                      <Badge className={statusConfig[review.status]?.color || "bg-slate-100 text-slate-700"}>{statusConfig[review.status]?.label || review.status}</Badge>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
