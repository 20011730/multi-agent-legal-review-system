import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { normalizeEvidences } from "../utils/normalizeEvidence";
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
  const pdfRef = useRef<HTMLDivElement>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [recheckTarget, setRecheckTarget] = useState<"legal" | "business" | "ethics">("legal");
  const [recheckQuestion, setRecheckQuestion] = useState("");
  // evidence fetch 진행 상태 — empty-state 카드를 fetch 완료 후에만 보여주기 위함
  const [evidenceLoadState, setEvidenceLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    const data = sessionStorage.getItem("reviewData");
    if (!data) {
      navigate("/input");
      return;
    }
    setReviewData(JSON.parse(data));

    // 1차 hydration: sessionStorage 보조 (단, **빈 배열은 무시**해서 stale "[]"가
    // 화면을 "근거 없음"으로 잘못 단정짓는 것을 차단)
    const fdData = sessionStorage.getItem("finalDecision");
    if (fdData) {
      try { setFinalDecision(JSON.parse(fdData)); } catch { /* ignore */ }
    }

    const evData = sessionStorage.getItem("evidences");
    if (evData) {
      try {
        const arr = JSON.parse(evData);
        if (Array.isArray(arr) && arr.length > 0) {
          setEvidences(normalizeEvidences(arr));
        }
      } catch { /* ignore */ }
    }

    // 2차 hydration: 항상 backend에서 fresh fetch (DB가 진실의 원천)
    const sessionId = sessionStorage.getItem("sessionId");
    setActiveSessionId(sessionId);
    if (!sessionId) {
      // sessionId 없으면 fetch 불가 — 사용자에게 신호를 주기 위해 error 상태로
      console.warn("[verdict] sessionStorage.sessionId 없음 — fresh fetch 불가");
      setEvidenceLoadState("error");
      return;
    }

    const usingMockData = sessionStorage.getItem("usingMockData") === "true";
    if (usingMockData) {
      const mockDetail = getMockReviewDetail(sessionId);
      if (mockDetail) {
        setFinalDecision(mockDetail.finalDecision as FinalDecision);
        const normalized = normalizeEvidences(mockDetail.evidences);
        setEvidences(normalized);
        sessionStorage.setItem("finalDecision", JSON.stringify(mockDetail.finalDecision));
        sessionStorage.setItem("evidences", JSON.stringify(normalized));
        setEvidenceLoadState("loaded");
      } else {
        // 모의 토론 완료 직후라면 sessionStorage 값을 그대로 사용
        setEvidenceLoadState("loaded");
      }
      return;
    }

    let cancelled = false;
    setEvidenceLoadState("loading");
    fetch(`http://localhost:8080/api/sessions/${sessionId}/debates/latest`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        if (cancelled) return;
        console.info("[verdict] fetch ok — sessionId=" + sessionId, {
          hasFinalDecision: !!result?.finalDecision,
          evidencesLen: Array.isArray(result?.evidences) ? result.evidences.length : 0,
        });

        if (result?.finalDecision) {
          setFinalDecision(result.finalDecision);
          sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
        }

        // top-level evidences를 1순위로, finalDecision.evidences fallback 포함
        const freshEvidences = normalizeEvidences(result);
        setEvidences(freshEvidences);
        sessionStorage.setItem("evidences", JSON.stringify(freshEvidences));
        setEvidenceLoadState("loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[verdict] fetch 실패:", err);
        setEvidenceLoadState("error");
      });

    return () => { cancelled = true; };
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
    // PDF 전용 hidden 마크업을 캡처 (재검토/공유/유의사항 등 UI 제외, 콤팩트 레이아웃)
    const el = pdfRef.current ?? reportRef.current;
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
    <div className="min-h-screen bg-[#ffffffff] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#ffffffff]/94 backdrop-blur-md shadow-sm">
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

          {/* 법령·판례 근거 — fetch 진행 중에는 empty-state를 그리지 않음 */}
          {evidenceLoadState === "loading" && evidences.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              법령·판례 근거를 불러오는 중...
            </div>
          )}
          {evidenceLoadState === "error" && evidences.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              <p className="font-medium mb-1">법령·판례 근거를 불러오지 못했습니다.</p>
              <p className="text-xs text-amber-700">
                {activeSessionId
                  ? `세션 ${activeSessionId}의 응답을 가져오는 중 오류가 발생했습니다. 백엔드 서버가 실행 중인지 확인해 주세요.`
                  : "현재 세션 식별자가 없어 백엔드에서 근거를 다시 불러올 수 없습니다. 새로 검토를 시작하면 정상 표시됩니다."}
              </p>
            </div>
          )}
          {(evidences.length > 0 || evidenceLoadState === "loaded") && (
            <EvidenceCardList evidences={evidences} />
          )}

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

        {/* ─────────────────────────────────────────────────────
             PDF 전용 off-screen 마크업
             - 화면에는 보이지 않음 (absolute, left: -10000px)
             - 인터랙션 UI(재검토/버튼/공유) 제외
             - 콤팩트 폰트/패딩/간격으로 페이지 효율 극대화
             - 각 섹션이 PDF 페이지 단위 후보가 됨
           ───────────────────────────────────────────────────── */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: 0,
            width: "780px",       // A4 폭(210mm)에 가깝게 (margin 16mm 빼고 ~178mm)
            background: "#ffffff",
            color: "#0f172a",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif",
          }}
        >
          <div ref={pdfRef} style={{ background: "#ffffff", padding: "0 0 12px 0" }}>
            {/* 1. 헤더 */}
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #1E3A8A", marginBottom: "10px" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#1E3A8A" }}>
                LexRex AI · 최종 법률 리스크 리포트
              </div>
              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                생성일: {new Date().toLocaleString("ko-KR")} · {reviewData.companyName} ({reviewData.industry})
              </div>
            </div>

            {/* 2. 검토 안건 메타 */}
            <div style={{ padding: "8px 16px", marginBottom: "8px", fontSize: "11px", color: "#475569" }}>
              <div><b>검토 유형:</b> {reviewData.reviewType}</div>
              <div style={{ marginTop: 2 }}><b>상황:</b> {reviewData.situation}</div>
            </div>

            {/* 3. 종합 요약 */}
            {finalDecision?.summary && (
              <div style={pdfCardStyle}>
                <div style={pdfTitleStyle}>종합 요약</div>
                <div style={pdfBodyStyle}>{finalDecision.summary}</div>
              </div>
            )}

            {/* 4. 리스크 스코어 (한 줄로 콤팩트) */}
            <div style={pdfCardStyle}>
              <div style={pdfTitleStyle}>리스크 스코어</div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#1E3A8A" }}>{riskScore}</div>
                <div style={{ flex: 1, height: "8px", background: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${riskScore}%`,
                      background: riskScore >= 70 ? "#ef4444" : riskScore >= 40 ? "#f59e0b" : "#10b981",
                    }}
                  />
                </div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  위험도: {finalDecision?.riskLevel ?? "MEDIUM"}
                </div>
              </div>
            </div>

            {/* 5. 리스크 항목 — 각 아이템을 별도 섹션으로 (페이지 break 자유도 확보) */}
            {risks.length > 0 && (
              <>
                <div style={{ ...pdfCardStyle, paddingBottom: "10px" }}>
                  <div style={pdfTitleStyle}>리스크 항목 ({risks.length}건)</div>
                </div>
                {risks.map((risk, idx) => (
                  <div key={idx} style={{ ...pdfSubCardStyle, marginTop: "0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>{risk.category}</div>
                        <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px", lineHeight: 1.5 }}>
                          {risk.description}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "10px",
                          background: risk.level === "high" ? "#fee2e2" : risk.level === "medium" ? "#fef3c7" : "#d1fae5",
                          color: risk.level === "high" ? "#b91c1c" : risk.level === "medium" ? "#92400e" : "#065f46",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {risk.level.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* 6. 원문 vs 수정안 */}
            {finalDecision?.revisedContent && (
              <div style={{ ...pdfCardStyle }}>
                <div style={pdfTitleStyle}>수정 문안 제안</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
                  <div style={{ padding: "8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: "#b91c1c", marginBottom: "3px" }}>원문</div>
                    <div style={{ fontSize: "11px", color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {reviewData.content}
                    </div>
                  </div>
                  <div style={{ padding: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: "#166534", marginBottom: "3px" }}>수정안 (권고)</div>
                    <div style={{ fontSize: "11px", color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {finalDecision.revisedContent}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. 최종 권고사항 */}
            {finalDecision?.recommendation && (
              <div style={pdfCardStyle}>
                <div style={pdfTitleStyle}>최종 권고사항</div>
                <div style={pdfBodyStyle}>{finalDecision.recommendation}</div>
              </div>
            )}

            {/* 8. 법령/판례 근거 — 각 항목을 펼침 상태로 별도 섹션 */}
            {evidences.length === 0 && (
              <div style={pdfCardStyle}>
                <div style={pdfTitleStyle}>법령·판례 근거</div>
                <div style={{ ...pdfBodyStyle, color: "#64748b", fontStyle: "italic" }}>
                  이 검토에 매칭된 법령·판례 근거가 없거나 법제처 검색 결과가 없습니다.
                </div>
              </div>
            )}
            {evidences.length > 0 && (
              <>
                <div style={{ ...pdfCardStyle, paddingBottom: "10px" }}>
                  <div style={pdfTitleStyle}>법령·판례 근거 ({evidences.length}건)</div>
                </div>
                {evidences.map((ev, idx) => (
                  <div key={idx} style={{ ...pdfSubCardStyle, marginTop: "0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                      <span style={{
                        fontSize: "9px", fontWeight: 700, padding: "1px 6px", borderRadius: "8px",
                        background: ev.sourceType === "LAW" ? "#dbeafe" : "#f3e8ff",
                        color: ev.sourceType === "LAW" ? "#1e40af" : "#6b21a8",
                      }}>
                        {ev.sourceType === "LAW" ? "법령" : "판례"}
                      </span>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                        {ev.title}{ev.articleOrCourt ? ` · ${ev.articleOrCourt}` : ""}
                      </div>
                    </div>
                    {ev.summary && (
                      <div style={{ fontSize: "11px", color: "#334155", lineHeight: 1.5, marginTop: "2px" }}>
                        {ev.summary}
                      </div>
                    )}
                    {ev.relevanceReason && (
                      <div style={{ fontSize: "10px", color: "#64748b", marginTop: "3px", fontStyle: "italic" }}>
                        관련성: {ev.relevanceReason}
                      </div>
                    )}
                    {ev.url && (
                      <div style={{ fontSize: "9px", color: "#3b82f6", marginTop: "3px", wordBreak: "break-all" }}>
                        {ev.url}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* 9. Footer */}
            <div style={{ padding: "8px 16px", marginTop: "12px", borderTop: "1px solid #e2e8f0", fontSize: "9px", color: "#94a3b8", lineHeight: 1.5 }}>
              본 보고서는 AI 기반 멀티에이전트 시스템의 분석 결과이며 참고용입니다.
              최종 의사결정은 사내 법무·컴플라이언스 검토를 거쳐 진행하십시오.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── PDF 전용 인라인 스타일 ──
// 핵심 원칙:
//   - border-radius 0~2px (둥근 모서리 안티앨리어싱이 캡처 경계와 충돌하지 않게)
//   - 명확한 1px solid border + 진한 색상 (#94a3b8)
//   - padding-bottom 18px 충분히 — 카드 내부 콘텐츠와 하단 border 사이 시각적 여유
//   - box-shadow / transform / overflow-hidden 없음
//   - boxSizing border-box로 폭/높이 계산 안정화
//   - line-height 명시 (브라우저 기본값 변동 차단)
const pdfCardStyle: CSSProperties = {
  padding: "14px 16px 18px 16px",
  margin: "0 0 10px 0",
  border: "1px solid #94a3b8",
  borderRadius: "2px",
  background: "#ffffff",
  boxShadow: "none",
  overflow: "visible",
  boxSizing: "border-box",
  pageBreakInside: "avoid",
  breakInside: "avoid",
  lineHeight: 1.5,
};

const pdfSubCardStyle: CSSProperties = {
  padding: "10px 14px 14px 14px",
  margin: "0 0 6px 0",
  border: "1px solid #94a3b8",
  borderRadius: "2px",
  background: "#f8fafc",
  boxShadow: "none",
  overflow: "visible",
  boxSizing: "border-box",
  pageBreakInside: "avoid",
  breakInside: "avoid",
  lineHeight: 1.5,
};

const pdfTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#1E3A8A",
  marginTop: 0,
  marginBottom: "8px",
  lineHeight: 1.3,
  letterSpacing: "-0.01em",
};

const pdfBodyStyle: CSSProperties = {
  fontSize: "11px",
  color: "#0f172a",
  lineHeight: 1.65,
  whiteSpace: "pre-wrap",
  margin: 0,
  paddingBottom: 0,
};
