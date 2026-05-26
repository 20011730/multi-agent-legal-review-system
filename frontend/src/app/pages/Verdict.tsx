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
import { targetAgentLabel } from "./Result";

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
  // Phase 10.12 — startupContext + followUpQuestions 표시용
  const [startupContext, setStartupContext] = useState<{
    title?: string;
    organization?: string;
    deadline?: string;
    category?: string;
    source?: string;
    applyUrl?: string;
    target?: string;
    fieldSummary?: string;
  } | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<Array<{
    targetAgent?: string;
    message?: string;
    createdAt?: string;
  }>>([]);
  // Phase 10.42 — backend status 에서 derive 한 결과 출처. sessionStorage 의존 제거 → race condition 해소.
  const [resultSource, setResultSource] = useState<"initial" | "latest-reanalyze" | "latest-reanalyze-partial" | "prior-after-reanalyze-fail" | null>(null);

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
        // Phase 10.12 — startupContext + followUpQuestions
        if (result?.startupContext) {
          setStartupContext(result.startupContext);
        } else {
          // fallback: sessionStorage 또는 reviewData
          try {
            const cached = sessionStorage.getItem("lexrex.startupContext");
            if (cached) setStartupContext(JSON.parse(cached));
          } catch { /* ignore */ }
        }
        if (Array.isArray(result?.followUpQuestions)) {
          setFollowUpQuestions(result.followUpQuestions);
        }
        // Phase 10.38 — Result 가 persist 한 userFollowUps (reanalyzeStatus 포함) 가 있으면
        // 백엔드 followUpQuestions 보다 우선 사용 — system 메시지 제외하고 사용자 작성 항목만.
        try {
          const cached = sessionStorage.getItem("userFollowUps");
          if (cached) {
            const arr = JSON.parse(cached);
            if (Array.isArray(arr)) {
              const userOnly = arr.filter((q) => q?.targetAgent !== "system");
              if (userOnly.length > 0) setFollowUpQuestions(userOnly);
            }
          }
        } catch { /* ignore */ }

        // top-level evidences를 1순위로, finalDecision.evidences fallback 포함
        const freshEvidences = normalizeEvidences(result);
        setEvidences(freshEvidences);
        sessionStorage.setItem("evidences", JSON.stringify(freshEvidences));
        setEvidenceLoadState("loaded");

        // Phase 10.43 — resultSource derive 규칙 재정비.
        //  단순 type=error fallback 메시지 한두 건으로 전체 재검토를 실패로 단정짓지 않는다.
        //  우선순위:
        //   A. userFollowUps.reanalyzeStatus === "completed/reflected" & hasFinal → latest-reanalyze
        //   B. userFollowUps.reanalyzeStatus === "failed" → prior-after-reanalyze-fail
        //   C. backend status=COMPLETED & hasFinal & fqCount>0 → latest-reanalyze
        //      (messages 내 type=error 가 일부 있으면 latest-reanalyze-partial)
        //   D. backend status=FAILED & !hasFinal → prior-after-reanalyze-fail
        //   E. 그 외 → initial
        fetch(`http://localhost:8080/api/sessions/${sessionId}/status`)
          .then((r) => r.ok ? r.json() : null)
          .then((s) => {
            if (cancelled || !s) return;
            const status = String(s.status || "").toUpperCase();
            const fqCount = Array.isArray(result?.followUpQuestions) ? result.followUpQuestions.length : 0;
            const hasFinal = !!result?.finalDecision || !!s.hasFinalDecision;
            const msgs = Array.isArray(result?.messages) ? result.messages : [];
            const errMsgCount = msgs.filter((m: { type?: string }) => String(m?.type) === "error").length;
            // Phase 10.44 — followUp 개별 reanalyzeStatus 의 source of truth 는 backend.
            // 1순위: result.followUpQuestions (backend), 2순위: sessionStorage (legacy fallback).
            let userFollowUpStatus: string | null = null;
            let partialFromBackend = false;
            const backendFqs = Array.isArray(result?.followUpQuestions) ? result.followUpQuestions : [];
            const backendUserFqs = backendFqs.filter(
              (q: { targetAgent?: string }) => q?.targetAgent !== "system",
            );
            if (backendUserFqs.length > 0) {
              const statuses: string[] = backendUserFqs.map((q: { reanalyzeStatus?: string }) =>
                String(q?.reanalyzeStatus || ""));
              if (statuses.includes("failed")) userFollowUpStatus = "failed";
              else if (statuses.includes("partial")) {
                userFollowUpStatus = "completed";
                partialFromBackend = true;
              }
              else if (statuses.some((st: string) => st === "completed" || st === "reflected")) userFollowUpStatus = "completed";
              else if (statuses.includes("in-progress")) userFollowUpStatus = "in-progress";
            } else {
              try {
                const cached = sessionStorage.getItem("userFollowUps");
                if (cached) {
                  const arr = JSON.parse(cached);
                  if (Array.isArray(arr)) {
                    const userOnly = arr.filter((q) => q?.targetAgent !== "system");
                    const statuses = userOnly.map((q) => String(q?.reanalyzeStatus || ""));
                    if (statuses.includes("failed")) userFollowUpStatus = "failed";
                    else if (statuses.includes("partial")) {
                      userFollowUpStatus = "completed";
                      partialFromBackend = true;
                    }
                    else if (statuses.some((st) => st === "reflected" || st === "completed")) userFollowUpStatus = "completed";
                    else if (statuses.includes("in-progress")) userFollowUpStatus = "in-progress";
                  }
                }
              } catch { /* ignore */ }
            }

            let derived: "initial" | "latest-reanalyze" | "latest-reanalyze-partial" | "prior-after-reanalyze-fail" = "initial";

            // Phase 10.49 — backend followUpStatus 가 가장 권위 있음.
            //   안내성 system error 메시지(errMsgCount) 는 banner 분기에 사용하지 않음.
            //   partialFromBackend (followUp.reanalyzeStatus === "partial") 만 partial 분기.
            // A
            if (userFollowUpStatus === "completed" && hasFinal) {
              derived = partialFromBackend ? "latest-reanalyze-partial" : "latest-reanalyze";
            }
            // B
            else if (userFollowUpStatus === "failed") {
              derived = "prior-after-reanalyze-fail";
            }
            // C — backend followUp 상태가 없는데 후속 질문이 있고 분석 완료된 케이스 (legacy)
            else if (status === "COMPLETED" && hasFinal && fqCount > 0) {
              derived = "latest-reanalyze";
            }
            // D
            else if (status === "FAILED" && !hasFinal) {
              derived = "prior-after-reanalyze-fail";
            }
            // E (fallback): finalDecision 만 있고 fq=0 이면 최초 결과로 판단
            else {
              derived = "initial";
            }

            setResultSource(derived);
            try { sessionStorage.setItem("verdictResultSource", derived); } catch { /* */ }
          })
          .catch(() => {
            try {
              const cached = sessionStorage.getItem("verdictResultSource");
              if (
                cached === "initial" ||
                cached === "latest-reanalyze" ||
                cached === "latest-reanalyze-partial" ||
                cached === "prior-after-reanalyze-fail"
              ) {
                setResultSource(cached as "initial" | "latest-reanalyze" | "latest-reanalyze-partial" | "prior-after-reanalyze-fail");
              } else {
                setResultSource("initial");
              }
            } catch { setResultSource("initial"); }
          });
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

  // Phase 10.11 — finalDecision 이 없으면 AI 분석 실패 상태로 간주. 임시 mock 점수 표시 명확화.
  const aiFailed = !finalDecision;
  // Phase 10.22 — riskLevel + risks 리스트 조합으로 점수 산출 정교화.
  // 기준: 0~39 낮음 / 40~69 보통·주의 / 70~100 높음·위험.
  const riskScore = (() => {
    const lvl = finalDecision?.riskLevel?.toUpperCase();
    const riskList = Array.isArray(finalDecision?.risks) ? finalDecision!.risks : [];
    const highCount = riskList.filter((r) => String((r as { level?: string }).level).toLowerCase() === "high").length;
    const medCount = riskList.filter((r) => String((r as { level?: string }).level).toLowerCase() === "medium").length;
    let base = 58;
    if (lvl === "HIGH") base = 80;
    else if (lvl === "LOW") base = 28;
    else if (lvl === "MEDIUM") base = 55;
    // 항목 가중치: high 1건당 +4, medium 1건당 +2 (최대 +20)
    const adj = Math.min(20, highCount * 4 + medCount * 2);
    return Math.min(100, Math.max(0, base + adj));
  })();

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
            {/* Phase 10.22 — /result 로 돌아가 전체 토론 로그를 다시 볼 수 있게 */}
            <Button variant="outline" onClick={() => navigate("/result")}>
              <FileText className="w-4 h-4 mr-2" />토론 로그 다시 보기
            </Button>
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
            {/* Phase 10.29/10.37 — 분석 대상 요약 chip (회사명/카테고리/목적/지원사업/첨부/질문 수)
                Phase 10.37: 내부 영문 raw value (data/custom 등) → 사용자 친화 한국어 라벨 매핑 */}
            {(() => {
              const sc = startupContext as { title?: string } | null;
              const attachmentsRaw = (reviewData as unknown as { attachments?: unknown }).attachments;
              const attCount = Array.isArray(attachmentsRaw) ? (attachmentsRaw as unknown[]).length : 0;
              const fqCount = followUpQuestions.length;
              const purposeRaw = ((reviewData as unknown as { diagnosticPurpose?: string; customPurpose?: string }).diagnosticPurpose
                || (reviewData as unknown as { customPurpose?: string }).customPurpose || "").toString().trim();
              // Phase 10.37 — 카테고리 영문 코드 → 한국어 매핑
              const categoryLabel = (v: string): string => {
                const m: Record<string, string> = {
                  contract: "계약·거래",
                  ip: "지식재산·브랜드",
                  data: "개인정보·데이터",
                  privacy: "개인정보·데이터",
                  regulation: "규제·인허가",
                  labor: "인사·노무",
                  hr: "인사·노무",
                  funding: "투자·자금조달",
                  invest: "투자·자금조달",
                  operation: "기업운영·법무",
                  exit: "사업정리·재도전",
                  startup: "지원사업/정부과제",
                };
                return m[v.toLowerCase().trim()] || v;
              };
              // Phase 10.37 — 진단 목적 영문 코드 → 한국어 매핑
              const purposeLabel = (v: string): string => {
                const m: Record<string, string> = {
                  custom: "직접 입력",
                  "startup-support": "지원사업 사전 검토",
                  investment: "투자 조건 검토",
                  "privacy-data": "개인정보·데이터 점검",
                  ip: "지식재산 권리 검토",
                  labor: "인사·노무 검토",
                  "toxic-terms": "독소조항 점검",
                  "compliance-check": "컴플라이언스 점검",
                  "dispute-response": "분쟁 대응 검토",
                  "risk-screening": "리스크 스크리닝",
                };
                return m[v.toLowerCase().trim()] || v;
              };
              const purpose = purposeRaw ? purposeLabel(purposeRaw) : "";
              const chips: Array<{ k: string; v: string; cls?: string }> = [];
              if (reviewData.companyName) chips.push({ k: "회사", v: reviewData.companyName });
              if (reviewData.reviewType) chips.push({ k: "카테고리", v: categoryLabel(reviewData.reviewType) });
              if (purpose) chips.push({ k: "진단 목적", v: purpose.slice(0, 28) });
              if (sc?.title) chips.push({ k: "지원사업", v: sc.title.slice(0, 28), cls: "border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]" });
              chips.push({ k: "첨부", v: `${attCount}건` });
              chips.push({ k: "추가 질문", v: `${fqCount}건` });
              return (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${
                        c.cls || "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      <span className="opacity-70">{c.k}</span>
                      <span className="font-medium">{c.v}</span>
                    </span>
                  ))}
                </div>
              );
            })()}
            {/* Phase 10.42 — backend status 기반 결과 출처 banner (sessionStorage race condition 제거).
                최초 검토 / 재검토 성공 / 재검토 실패 후 기존 결과 3 분기. */}
            {/* Phase 10.47 — banner 톤 정리. partial 은 사용자에게 과장된 경고 대신 차분한 안내. */}
            {resultSource === "latest-reanalyze" && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                🔁 추가 질문을 반영한 최신 검토 결과입니다.
              </div>
            )}
            {resultSource === "latest-reanalyze-partial" && (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-900">
                🔁 추가 질문을 반영한 검토 결과입니다. 일부 보조 항목은 다음 검토에 더 자세히 반영될 수 있습니다.
              </div>
            )}
            {resultSource === "prior-after-reanalyze-fail" && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                ⚠ 최근 재검토를 마치지 못해 직전 검토 결과를 기준으로 표시합니다. 결과 화면에서 다시 시도할 수 있습니다.
              </div>
            )}
            {resultSource === "initial" && (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                📄 최초 검토 결과입니다. 추가 질문을 저장한 뒤 재검토하면 최신 의견이 반영됩니다.
              </div>
            )}
            {/* Phase 10.27 — finalDecision 일부 필드 누락 안내 (빈 카드만 보이지 않도록) */}
            {finalDecision && (() => {
              const s = (finalDecision.summary || "").trim();
              const r = (finalDecision.recommendation || "").trim();
              const rl = Array.isArray(finalDecision.risks) ? finalDecision.risks.length : 0;
              const partial = (s.length < 20 && r.length < 20) || (rl === 0 && !s);
              if (!partial) return null;
              return (
                <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[12px] text-sky-900">
                  ℹ 분석 결과 일부 필드가 비어 있어 입력 정보와 토론 로그 기반 요약을 함께 표시합니다.
                  토론 로그(상세 보기) 와 함께 확인해 주세요.
                </div>
              );
            })()}
          </div>

          {/* Phase 10.11 — AI 분석 실패 시 명확한 실패 배너 (mock 결과처럼 보이지 않도록) */}
          {aiFailed && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <span className="text-lg" aria-hidden>⚠️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-rose-900">AI 분석 결과를 받지 못했습니다</p>
                  <p className="mt-1 text-xs leading-relaxed text-rose-800">
                    AI 검토팀이 결과 생성을 완료하지 못했습니다.
                    아래에 표시되는 점수와 항목은 <strong>임시 보조 값</strong>이며 실제 진단 결과가 아닙니다.
                    잠시 후 다시 시도하거나, 입력 내용을 확인해 주세요.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/input")}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-rose-400 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                  >
                    다시 시도
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 리스크 스코어 */}
          <Card className={`border-[#1E3A8A]/20 ${aiFailed ? "bg-slate-50 opacity-80" : "bg-[#1E3A8A]/5"}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                리스크 스코어
                {aiFailed && (
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-normal text-slate-500">
                    임시 점수 / AI 분석 미완료
                  </span>
                )}
              </CardTitle>
              <CardDescription>0~100 종합 지표</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-baseline gap-3">
                  <p className="text-4xl font-semibold text-[#1E3A8A]">{riskScore}</p>
                  {/* Phase 10.6 — 신호등 색 + 텍스트 라벨 (색만으로 의미 전달 X, 접근성 보강) */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      riskScore >= 70
                        ? "border-red-300 bg-red-50 text-red-700"
                        : riskScore >= 40
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700"
                    }`}
                    aria-label={`종합 리스크 ${riskScore >= 70 ? "높음(위험)" : riskScore >= 40 ? "보통(주의)" : "낮음(안전)"}`}
                  >
                    <span aria-hidden>●</span>
                    {riskScore >= 70 ? "높음 · 위험" : riskScore >= 40 ? "보통 · 주의" : "낮음 · 안전"}
                  </span>
                </div>
                <div
                  className="w-full max-w-[360px]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={riskScore}
                  aria-label={`종합 리스크 점수 ${riskScore} 점`}
                >
                  <div className="h-3 rounded-full border border-slate-300 overflow-hidden">
                    <div
                      className={`h-full ${riskScore >= 70 ? "bg-red-500" : riskScore >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${riskScore}%` }}
                    />
                  </div>
                </div>
              </div>
              {/* Phase 10.22 — 점수 기준 범례 (신호등 정의를 명확히) */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  ● 0~39 낮음·안전
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                  ● 40~69 보통·주의
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">
                  ● 70~100 높음·위험
                </span>
                <span className="ml-1 text-slate-500">
                  점수는 AI 판정의 riskLevel 과 토론에서 도출된 개별 리스크 가중치를 결합해 산출됩니다.
                </span>
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

          {/* Phase 10.27 — 수정안은 광고/문구/계약 등 "텍스트 수정이 의미 있는" 검토 유형에서만 표시.
              지원사업 일반 진단(R&D/사업화 등)에서는 원문이 공고/협약서이므로 1:1 수정안 비교가 부자연스러움.
              조건: (1) revisedContent 가 비어있지 않고 (2) 원문 길이가 충분히 짧거나(< 1500자)
                    (3) reviewType/situation 에 광고/문구/약관/조항 키워드가 있을 때 */}
          {finalDecision?.revisedContent && (() => {
            const rv = (finalDecision.revisedContent || "").trim();
            if (!rv || rv.length < 5) return false;
            const orig = (reviewData.content || "");
            if (rv === orig.trim()) return false;
            // Phase 10.30 — 지원사업 기반 검토면 원문/수정안 카드 강제 비표시.
            // 사용자 QA: "지원사업 신청/협약/정산/IP 점검에서 광고문구식 수정안이 부적절" — 명시 제외.
            if (startupContext) return false;
            const hay = `${reviewData.reviewType || ""} ${reviewData.situation || ""} ${orig}`.toLowerCase();
            // Phase 10.30 — 지원사업/협약/정산/사업비/성과물 키워드면 텍스트 수정 카드 비표시
            const startupHints = ["지원사업", "협약", "정산", "사업비", "성과물", "환수", "보조금", "정부지원"];
            if (startupHints.some((k) => hay.includes(k))) return false;
            // 광고/문구/약관/조항 키워드 — 1:1 비교가 자연스러운 경우
            const textRevisionHints = ["광고", "표시", "문구", "마케팅", "약관", "조항", "캐치", "랜딩", "이벤트", "후기"];
            const hasTextRevisionHint = textRevisionHints.some((k) => hay.includes(k));
            const shortOrig = orig.length > 0 && orig.length <= 800;
            return hasTextRevisionHint || shortOrig;
          })() && (
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

          {/* Phase 10.12 — 지원사업 컨텍스트 기반 구조화 섹션 */}
          {startupContext && (
            <Card className="border-[#1E3A8A]/20 bg-[#1E3A8A]/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-5 h-5 text-[#1E3A8A]" />
                  지원사업 기반 검토 항목
                </CardTitle>
                <CardDescription>
                  공고 정보를 바탕으로 검토가 필요한 영역을 정리했습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-[#1E3A8A]/15 bg-white px-3 py-2 text-xs">
                  <div className="font-semibold text-slate-900">{startupContext.title}</div>
                  <div className="mt-0.5 text-slate-500">
                    {startupContext.organization}
                    {startupContext.organization && startupContext.deadline && " · "}
                    {startupContext.deadline && `마감 ${startupContext.deadline}`}
                    {startupContext.category && ` · ${startupContext.category}`}
                  </div>
                </div>
                {/* Phase 10.13 — 항목별 신호등 리스크 (낮음·주의·높음) */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { title: "협약 체결", body: "협약서 효력·해제·해지·위약 조항 점검. 사용 목적·제한 조건 확인.", level: "주의" as const },
                    { title: "사업비 정산", body: "지출 증빙 요건·집행 한도·외주 단가 기준 확인. 목적 외 사용 시 환수 가능성.", level: "높음" as const },
                    { title: "성과물·IP 귀속", body: "단독·공동 귀속, 사용권 범위, 정부지원 과제 산출물 명시 여부 확인.", level: "주의" as const },
                    { title: "개인정보·데이터", body: "수집 항목·동의 문구·제3자 제공·국외 이전·보관 기간 검토.", level: "주의" as const },
                    { title: "고용·외주", body: "근로계약 vs 도급 구분, 청년채용 의무, 4대 보험·세금 처리 점검.", level: "주의" as const },
                    { title: "중복 수혜·자격", body: "동일 비목 타 지원사업 병행 가능 여부, 결격사유, 업종·연차 자격 확인.", level: "낮음" as const },
                  ].map((sec, i) => {
                    const dotClass =
                      sec.level === "높음"
                        ? "bg-red-500"
                        : sec.level === "주의"
                          ? "bg-amber-500"
                          : "bg-emerald-500";
                    const chipClass =
                      sec.level === "높음"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : sec.level === "주의"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700";
                    return (
                      <div key={i} className="rounded border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-800">{sec.title}</div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${chipClass}`}
                            aria-label={`${sec.title} 리스크 ${sec.level}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
                            {sec.level}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-600">{sec.body}</div>
                      </div>
                    );
                  })}
                </div>
                {startupContext.applyUrl && (
                  <a
                    href={startupContext.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#1E3A8A] hover:underline"
                    aria-label="원문 공고 페이지 새 탭에서 열기"
                  >
                    원문 공고 보기 →
                  </a>
                )}
                <p className="text-[10.5px] text-slate-500">
                  ※ 위 항목은 지원사업 카테고리 기반 체크리스트입니다. 실제 결정은 공고문/협약서 원문과 함께 검토하세요.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Phase 10.20 — 첨부자료 분석 반영 요약 */}
          {(() => {
            const attachmentsRaw = (reviewData as unknown as { attachments?: unknown }).attachments;
            const list: Array<Record<string, unknown>> = Array.isArray(attachmentsRaw)
              ? (attachmentsRaw as Array<Record<string, unknown>>)
              : [];
            // Phase 10.29 — 첨부자료 없음 안내 (빈 화면 대신 명확한 fallback)
            if (list.length === 0) {
              return (
                <Card className="border-slate-200 bg-slate-50/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="w-5 h-5 text-slate-500" />
                      첨부자료 없음
                    </CardTitle>
                    <CardDescription>
                      현재 결과는 입력 정보와 공고/토론 내용을 기준으로 작성되었습니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-[12.5px] text-slate-700">
                    <p>💡 협약서, 사업계획서, 계약서, 개인정보 처리방침 등을 추가하면 정확도가 높아집니다.</p>
                    <p className="text-[10.5px] text-slate-500">
                      ※ 현재 데모 단계에서는 txt/md/json 본문 일부 반영, PDF/DOCX 는 파일명·메타데이터 중심으로 참고됩니다.
                    </p>
                  </CardContent>
                </Card>
              );
            }
            let withBody = 0;
            let metaOnly = 0;
            let masked = 0;
            for (const a of list) {
              // Phase 10.51 — extracted / partial / pending-server-extract 도 본문 반영 카운트.
              const s = a?.extractionStatus;
              const ok = a?.bodyText || s === "ok" || s === "extracted" || s === "partial" || s === "pending-server-extract";
              if (ok) withBody += 1;
              else metaOnly += 1;
              const flags = a?.sensitivityFlags;
              if (Array.isArray(flags) && flags.length > 0) masked += 1;
            }
            return (
              <Card className="border-sky-200 bg-sky-50/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-5 h-5 text-sky-700" />
                    첨부자료 분석 반영 ({list.length}건)
                  </CardTitle>
                  <CardDescription>
                    텍스트 본문이 추출된 자료는 에이전트 발언에 직접 인용됩니다. PDF/DOCX 본문도 일부 추출해 검토에 반영합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">본문 추출 {withBody}건</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">메타데이터만 {metaOnly}건</span>
                    {masked > 0 && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">민감정보 마스킹 {masked}건</span>
                    )}
                  </div>
                  <ul className="space-y-1 text-[12px] text-slate-700">
                    {list.slice(0, 8).map((a, i) => {
                      const name = String(a?.name ?? "(이름 없음)");
                      const status = String(a?.extractionStatus ?? "unknown");
                      const sizeKb = typeof a?.size === "number" ? `${(a.size / 1024).toFixed(1)} KB` : "";
                      const flags = Array.isArray(a?.sensitivityFlags) ? (a.sensitivityFlags as string[]) : [];
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{name}</span>
                          {sizeKb && <span className="text-slate-500">{sizeKb}</span>}
                          <span
                            className={`rounded border px-1.5 py-0 text-[10px] ${
                              status === "ok" || status === "extracted"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : status === "partial" || status === "pending-server-extract"
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : status === "failed" || status === "error"
                                ? "border-red-200 bg-red-50 text-red-700"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {/* Phase 10.51 — 사용자 친화 라벨 */}
                            {status === "ok" || status === "extracted"
                              ? "본문 반영됨"
                              : status === "partial"
                              ? "본문 일부 반영"
                              : status === "pending-server-extract"
                              ? "본문 분석 가능"
                              : status === "failed" || status === "error"
                              ? "본문 추출 실패"
                              : status === "skipped-too-large"
                              ? "용량 초과 — 파일명만 참고"
                              : status === "skipped-unsupported"
                              ? "파일명만 참고"
                              : status}
                          </span>
                          {/* Phase 10.54 — 핵심 검토 키워드 및 반영된 문단 수 */}
                          {Array.isArray(a?.priorityKeywords) && (a.priorityKeywords as string[]).length > 0 && (
                            <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[10px] text-indigo-800">
                              주요 키워드: {(a.priorityKeywords as string[]).slice(0,4).join(", ")}
                              {(a.priorityKeywords as string[]).length > 4 ? " 외" : ""}
                            </span>
                          )}
                          {typeof a?.selectedParagraphCount === "number" && (a.selectedParagraphCount as number) > 0 && (
                            <span className="rounded border border-slate-200 bg-white px-1.5 py-0 text-[10px] text-slate-600">
                              반영 문단 {a.selectedParagraphCount as number}개
                            </span>
                          )}
                          {flags.length > 0 && (
                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800">
                              ⚠ {flags.join(", ")}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[10.5px] text-slate-500">
                    ※ PDF/DOCX 본문도 텍스트 추출이 가능한 경우 핵심 조항 중심으로 검토에 반영합니다. 스캔본/이미지 PDF 등 본문 추출이 어려운 자료는 파일명·유형 기준으로 참고됩니다.
                  </p>
                </CardContent>
              </Card>
            );
          })()}

          {/* Phase 10.29 — 시나리오별(지원사업/계약/개인정보/고용/IP/투자/규제/사업정리) 결과 섹션.
              category + startupContext + content 키워드를 조합해 가장 적합한 분기 선택. */}
          {(() => {
            const sc = startupContext as { title?: string; category?: string } | null;
            const isStartup = Boolean(sc);
            const cat = (reviewData.reviewType || "").toLowerCase();
            const rawHay = `${reviewData.situation || ""} ${reviewData.content || ""}`.toLowerCase();

            // Phase 10.29 — 시나리오 결정 (우선순위: startupContext > category > content 키워드)
            type Scenario = "startup" | "contract" | "data" | "labor" | "ip" | "funding" | "regulation" | "exit" | "default";
            const scenario: Scenario = (() => {
              if (isStartup) return "startup";
              if (cat.includes("contract") || rawHay.includes("계약") && rawHay.includes("해지")) return "contract";
              if (cat.includes("data") || cat.includes("privacy") || rawHay.includes("개인정보")) return "data";
              if (cat.includes("labor") || cat.includes("hr") || rawHay.includes("근로계약") || rawHay.includes("프리랜서")) return "labor";
              if (cat.includes("ip") || cat.includes("brand") || rawHay.includes("지식재산") || rawHay.includes("상표")) return "ip";
              if (cat.includes("funding") || cat.includes("invest") || rawHay.includes("투자계약") || rawHay.includes("term sheet")) return "funding";
              if (cat.includes("regulation") || rawHay.includes("인허가") || rawHay.includes("신고")) return "regulation";
              if (cat.includes("exit") || rawHay.includes("폐업") || rawHay.includes("청산")) return "exit";
              return "default";
            })();

            // Phase 10.29 — 시나리오별 자료/체크리스트/후속검토 fallback (finalDecision 데이터 미존재 시 사용)
            const PRESETS: Record<Scenario, { title: string; desc: string; docs: string[]; checks: string[]; followUp: string }> = {
              startup: {
                title: "지원사업 기반 검토 — 신청·협약·정산·IP·개인정보·환수 권장 점검",
                desc: "공고/협약 단계에서 자주 발생하는 리스크와 보완 항목입니다.",
                docs: [
                  "공고문 원문 PDF — 지원 자격·제외 조건·접수 마감",
                  "선정 후 협약서 초안 — 환수·정산·해지 조항",
                  "사업계획서 초안 — 사업비 사용·성과물 계획",
                  "예산 산출내역서 — 집행 가능 항목 / 증빙 기준",
                  "외주·용역 계약 초안 — 도급/위탁 구분, 성과물 귀속",
                  "성과물/IP 귀속 조항 — 단독·공동·사용권 범위",
                  "개인정보 처리 흐름 — 동의·보관·제3자 제공·위탁",
                ],
                checks: [
                  "신청 자격 충족 확인 (기업 규모·업력·업종 제한)",
                  "협약 조건 확인 (정산 기준·환수·해지·제재)",
                  "사업비 집행 항목 확인 (외주·인건비 한도)",
                  "성과물/IP 귀속 확인 (단독·공동·사용권 범위)",
                  "개인정보 처리 흐름 확인 (수집·보관·제3자 제공)",
                  "중복 수혜·이중지원 가능성 확인",
                  "홍보 문구의 '100% 지원/무료/보장' 표현은 실제 조건과 일치하는지 확인",
                ],
                followUp: "선정 후 협약서 수령 시 재검토 필요. 외주·용역 계약 체결 직전 추가 검토 권장.",
              },
              contract: {
                title: "계약·거래 검토 — 대금·해지·책임·자동갱신 권장 점검",
                desc: "체결 전 확인할 핵심 조항과 협상 포인트 중심입니다.",
                docs: ["계약서 초안 / 최종안", "견적서·발주서·제안서", "상대방 협의 이력 또는 의사록", "산출물 귀속·검수 조항"],
                checks: [
                  "대금 / 지급 시기 / 분할 지급 조건 확인",
                  "해지 / 환불 / 위약금 조항 확인",
                  "손해배상 한도 / 면책 범위 확인",
                  "자동 갱신 / 중도 해지 / 통지 기간 확인",
                  "산출물 / 데이터 / IP 권리 귀속 확인",
                  "분쟁 시 관할 / 준거법 / 중재 조항 확인",
                ],
                followUp: "수정 조항 적용 후 상대방 합의 단계에서 재검토 권장.",
              },
              data: {
                title: "개인정보·데이터 검토 — 수집·동의·보관·제공 점검",
                desc: "개인정보보호법·정보통신망법 기준 확인 사항입니다.",
                docs: ["개인정보 처리방침", "동의서 / 동의 문구", "수집 항목·이용 목적 표", "처리위탁 계약서", "보관·파기 정책"],
                checks: [
                  "수집 항목 최소화 (필요 최소 원칙)",
                  "동의 문구 명시성 / 필수·선택 구분",
                  "보관 기간 / 파기 절차 확인",
                  "제3자 제공 동의 별도 여부 확인",
                  "처리위탁·재위탁 범위 확인",
                  "국외 이전 / 민감정보 / 자동화 처리 별도 안내",
                ],
                followUp: "처리방침 개정 시 사전 고지 + 주요 변경 사항 재검토 필요.",
              },
              labor: {
                title: "인사·노무 검토 — 근로자성·도급 구분·산출물 권리 점검",
                desc: "외주·프리랜서·임직원 계약의 노무 리스크 중심입니다.",
                docs: ["근로계약서 / 외주·용역 계약서", "업무 지시 이력 (이메일/메신저)", "임금·보수 지급 명세", "사내 규정 (비밀유지·경업금지)"],
                checks: [
                  "실제 근무 형태가 도급/위탁/근로 중 어디인지 확인",
                  "업무 지시 방식 / 지휘감독 정도 확인",
                  "보수 / 4대보험 / 퇴직금 처리 확인",
                  "성과물 권리 귀속 확인",
                  "비밀유지·경업금지 조항의 합리적 범위 확인",
                  "해지 / 분쟁 발생 시 절차 확인",
                ],
                followUp: "외주가 실제로 근로자성에 가까우면 재계약 시 형태 재검토 권장.",
              },
              ip: {
                title: "지식재산·브랜드 검토 — 권리 귀속·라이선스·침해 점검",
                desc: "상표·특허·저작권·영업비밀 확보와 외주 산출물 권리 중심입니다.",
                docs: ["공동연구·협약서", "외주·용역 계약 (성과물 권리 조항)", "출원 명세서 / 상표·특허 자료", "오픈소스 사용 내역"],
                checks: [
                  "성과물 단독 / 공동 귀속 확인",
                  "외주 결과물 권리 양도 조항 확인",
                  "사용권(실시권) 범위 / 기간 / 지역 확인",
                  "오픈소스 라이선스 충돌 검토",
                  "상표·특허·저작권 침해 가능성 검토",
                  "영업비밀 보호 조치 (NDA·접근 통제) 확인",
                ],
                followUp: "출원·등록 단계마다 권리자 / 사용권 범위 재검토 권장.",
              },
              funding: {
                title: "투자·자금조달 검토 — 우선주·전환·창업자 제한 점검",
                desc: "Term Sheet·투자계약서·주주간계약 핵심 조항 중심입니다.",
                docs: ["Term Sheet", "투자계약서 초안", "주주간계약서", "정관 / cap table"],
                checks: [
                  "투자금액 / 밸류 / 우선주 조건 확인",
                  "전환권 / 상환권 / 청산우선권 확인",
                  "동의권 / 우선매수 / 태그·드래그 조항 확인",
                  "이사회 구성 / 의사결정 권한 확인",
                  "후속 투자 시 희석 효과 시뮬레이션",
                  "창업자 제한 조항 (경업금지·근속·베스팅) 확인",
                ],
                followUp: "후속 라운드 진입 직전 cap table 시뮬레이션 재검토 권장.",
              },
              regulation: {
                title: "규제·인허가 검토 — 인허가·신고·고시 점검",
                desc: "사업 모델별 적용 규제와 인허가 요건 중심입니다.",
                docs: ["사업 개요 / 서비스 흐름도", "관련 법령·고시·가이드라인", "기존 인·허가 사본 또는 변경 신청 내용"],
                checks: [
                  "필요한 인허가 / 신고 / 등록 요건 식별",
                  "판매·제공 지역별 규제 차이 확인",
                  "대상 고객 (B2C / B2B / 청소년 등) 별 제한 확인",
                  "관련 고시 / 자율규제 / 가이드라인 준수 여부 확인",
                  "표시광고법·전자상거래법·소비자보호법 적용 여부 확인",
                  "미신고 / 무허가 영업 리스크 확인",
                ],
                followUp: "관련 법령 개정 시 / 사업 모델 확장 시 재검토 권장.",
              },
              exit: {
                title: "사업정리·재도전 검토 — 채무·계약·정산·재도전 점검",
                desc: "폐업·청산·회생·재도전 단계의 리스크 중심입니다.",
                docs: ["채무 / 미지급금 내역", "고객·임직원·외주 계약 종료 안내", "데이터·개인정보 파기 정책", "정부지원금 정산·환수 자료"],
                checks: [
                  "미지급 채무 / 우선 변제 순위 확인",
                  "고객 환불·서비스 종료 통지 절차 확인",
                  "임직원 정리 (퇴직금·미지급 임금) 확인",
                  "데이터 / 개인정보 파기 절차 확인",
                  "정부지원금 정산 / 환수 가능성 확인",
                  "회생 / 파산 / 폐업 절차 선택 검토",
                ],
                followUp: "재도전 단계에서 제한업종 / 신용 / 지원사업 제외 여부 재검토 권장.",
              },
              default: {
                title: "사후 점검 항목",
                desc: "본 검토 이후 사용자가 추가로 확인하면 좋은 자료와 작업입니다.",
                docs: ["검토 대상 문서 원본 (계약서/약관/문구)", "관련 협의 이력 또는 의사록", "근거 자료 (가격·성능·인증·후기 등)"],
                checks: [
                  "표시·광고 표현 근거 자료 보관",
                  "계약 조항 중 해지·환불·손해배상 범위 확인",
                  "민감 표현(완벽/100%/최고/유일) 점검",
                ],
                followUp: "수정안 적용 후 재검토 권장. 상대방/주관기관 의견 반영 시 후속 검토 필요.",
              },
            };
            const preset = PRESETS[scenario];

            // Phase 10.29 — 후속 검토 필요성 판단: riskScore + risks + 첨부 + startupContext 조합
            const highRiskCount = Array.isArray(finalDecision?.risks)
              ? finalDecision!.risks.filter((r) => String((r as { level?: string }).level).toLowerCase() === "high").length
              : 0;
            const attachmentsRaw = (reviewData as unknown as { attachments?: unknown }).attachments;
            const attCount = Array.isArray(attachmentsRaw) ? (attachmentsRaw as unknown[]).length : 0;
            const needsFollowUp = riskScore >= 70 || highRiskCount >= 1 || (isStartup && attCount === 0) || aiFailed;
            const followUpVerdict = needsFollowUp
              ? `🔁 후속 검토 권장 — ${preset.followUp}`
              : `✅ 현재 입력 정보 기준 후속 검토 필요성 낮음 — ${preset.followUp}`;

            return (
              <Card className="border-emerald-200 bg-emerald-50/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-5 h-5 text-emerald-700" />
                    {preset.title}
                  </CardTitle>
                  <CardDescription>{preset.desc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div>
                    <p className="font-semibold text-emerald-800">📎 추가로 필요한 자료</p>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[12.5px]">
                      {preset.docs.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-800">✅ 실행 체크리스트</p>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[12.5px]">
                      {preset.checks.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-800">🔁 후속 검토 필요 여부</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed">{followUpVerdict}</p>
                  </div>
                  <p className="text-[10.5px] text-slate-500">
                    ※ 본 항목은 입력 카테고리(<strong>{scenario}</strong>)·공고 컨텍스트·토론 로그를 토대로 자동 생성된 사전 가이드입니다.
                    실제 협약서/계약서 원문이 확보되면 보다 정밀한 검토가 가능합니다.
                  </p>
                </CardContent>
              </Card>
            );
          })()}

          {/* Phase 10.12 — 사용자 추가 질문 반영 항목 */}
          {followUpQuestions.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-5 h-5 text-amber-700" />
                  사용자 추가 질문 반영 항목 ({followUpQuestions.length}건)
                </CardTitle>
                <CardDescription>
                  토론 중 추가로 입력한 질문 — 다음 재검토 또는 후속 분석 시 우선 반영 대상입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {followUpQuestions.map((q, i) => {
                  // Phase 10.29 — 질문 키워드 기반 반영 위치 안내 (fallback)
                  const hay = (q.message || "").toLowerCase();
                  const reflection = (() => {
                    if (/사업비|외주|용역|정산|환수/.test(hay)) {
                      return "관련 내용은 '사업비 집행·정산' 및 '추가 자료/체크리스트' 섹션에 반영되었습니다.";
                    }
                    if (/지식재산|성과물|ip|특허|상표|저작/.test(hay)) {
                      return "관련 내용은 '성과물·IP 귀속 확인' 섹션에 반영되었습니다.";
                    }
                    if (/개인정보|동의|제3자|위탁|보관/.test(hay)) {
                      return "관련 내용은 '개인정보/데이터 처리' 섹션에 반영되었습니다.";
                    }
                    if (/근로|고용|프리랜서|도급|4대보험/.test(hay)) {
                      return "관련 내용은 '외주·고용 관련 주의사항' 섹션에 반영되었습니다.";
                    }
                    if (/광고|홍보|100%|무료|보장|이벤트|문구/.test(hay)) {
                      return "관련 내용은 '표시광고/홍보 문구 주의사항' 섹션에 반영되었습니다.";
                    }
                    return "이 질문은 재검토 요청에 포함되었으며, 관련 내용은 종합 요약과 주요 리스크/권고안에 반영되었습니다.";
                  })();
                  // Phase 10.45 — chip 표시 우선순위:
                  //   1) resultSource (backend session status 기반 — 가장 권위 있음)
                  //   2) rs (개별 followUp.reanalyzeStatus — backend 가 영속화)
                  //   stale "in-progress" 가 화면에 남는 문제를 방지하기 위해 resultSource 가
                  //   확정 상태(완료/부분/실패)이면 그 값으로 chip 결정.
                  const rs = (q as { reanalyzeStatus?: string }).reanalyzeStatus;
                  const statusChip = (() => {
                    // resultSource 우선 (확정 상태)
                    if (resultSource === "latest-reanalyze") return { label: "반영 완료", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
                    if (resultSource === "latest-reanalyze-partial") return { label: "반영 완료 (보조 항목 일부 보완 예정)", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
                    if (resultSource === "prior-after-reanalyze-fail") return { label: "다시 시도 필요", cls: "border-red-300 bg-red-50 text-red-700" };
                    // rs fallback
                    if (rs === "completed" || rs === "reflected") return { label: "반영 완료", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
                    if (rs === "partial") return { label: "반영 완료 (보조 항목 일부 보완 예정)", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
                    if (rs === "failed") return { label: "다시 시도 필요", cls: "border-red-300 bg-red-50 text-red-700" };
                    if (rs === "in-progress") return { label: "재검토 중", cls: "border-blue-300 bg-blue-50 text-blue-700" };
                    if (rs === "pending") return { label: "재검토 반영 대기", cls: "border-amber-300 bg-amber-50 text-amber-800" };
                    // legacy fallback
                    if (Boolean(finalDecision)) return { label: "재검토에 포함됨", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" };
                    return { label: "재검토 반영 대기", cls: "border-amber-300 bg-amber-50 text-amber-800" };
                  })();
                  return (
                    <details key={i} className="group rounded border border-amber-200 bg-white px-3 py-2 open:bg-amber-50/50">
                      <summary className="cursor-pointer list-none">
                        <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
                          <span className="rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0">
                            🙋 대상: {targetAgentLabel(q.targetAgent)}
                          </span>
                          {q.createdAt && <span>{new Date(q.createdAt).toLocaleString("ko-KR")}</span>}
                          <span className={`rounded-full border px-1.5 py-0 ${statusChip.cls}`}>
                            {statusChip.label}
                          </span>
                          <span className="ml-auto text-[10px] text-slate-400 group-open:hidden">▾ 펼치기</span>
                          <span className="ml-auto text-[10px] text-slate-400 hidden group-open:inline">▴ 접기</span>
                        </div>
                        <p className="break-keep text-sm text-slate-700">{q.message}</p>
                      </summary>
                      <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/40 px-2 py-1.5 text-[12px] leading-relaxed text-emerald-900">
                        💡 {reflection}
                      </div>
                    </details>
                  );
                })}
                <p className="mt-1 text-[10.5px] text-slate-500">
                  ※ 질문별 반영 요약은 키워드 기반 보조 안내입니다. 정확한 답변은 토론 로그(상세 보기)의 재검토 라운드에서 확인하세요.
                </p>
              </CardContent>
            </Card>
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
                {evidences.map((ev, idx) => {
                  const m = ev.metadata ?? {};
                  const articleNo = m.articleNo != null ? String(m.articleNo) : "";
                  const articleTitle = m.articleTitle ? String(m.articleTitle) : "";
                  const articleLabel = articleNo
                    ? `제${articleNo}조${articleTitle ? `(${articleTitle})` : ""}`
                    : "";
                  const dept = (m.deptName ? String(m.deptName) : ev.articleOrCourt) || "";
                  const lawType = m.lawTypeName ? String(m.lawTypeName) : "";
                  const enforce = m.enforceDate ? String(m.enforceDate) : "";
                  const scorePct = typeof ev.score === "number" && isFinite(ev.score)
                    ? `${(ev.score * 100).toFixed(0)}%` : "";
                  const body = ev.quotedText || ev.summary || "";

                  return (
                    <div key={idx} style={{ ...pdfSubCardStyle, marginTop: "0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px", flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: "9px", fontWeight: 700, padding: "1px 6px", borderRadius: "8px",
                          background: ev.sourceType === "LAW" ? "#dbeafe" : "#f3e8ff",
                          color: ev.sourceType === "LAW" ? "#1e40af" : "#6b21a8",
                        }}>
                          {ev.sourceType === "LAW" ? "법령" : "판례"}
                        </span>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", flex: 1, minWidth: 0 }}>
                          {ev.title}
                        </div>
                        {scorePct && (
                          <span style={{
                            fontSize: "9px", fontWeight: 600, padding: "1px 6px", borderRadius: "8px",
                            background: "#eef2ff", color: "#4338ca", whiteSpace: "nowrap",
                          }}>
                            관련도 {scorePct}
                          </span>
                        )}
                      </div>
                      {(articleLabel || dept || lawType || enforce) && (
                        <div style={{ fontSize: "10px", color: "#475569", marginBottom: "3px" }}>
                          {articleLabel && <span>{articleLabel}</span>}
                          {articleLabel && (dept || lawType || enforce) && <span> · </span>}
                          {dept && <span>{dept}</span>}
                          {lawType && <span> · {lawType}</span>}
                          {enforce && <span> · 시행 {enforce}</span>}
                        </div>
                      )}
                      {body && (
                        <div style={{ fontSize: "11px", color: "#334155", lineHeight: 1.5, marginTop: "2px", whiteSpace: "pre-wrap" }}>
                          {body.length > 350 ? body.slice(0, 350) + "…" : body}
                        </div>
                      )}
                      {ev.relevanceReason && (
                        <div style={{ fontSize: "10px", color: "#4338ca", marginTop: "3px", fontStyle: "italic" }}>
                          관련 이유: {ev.relevanceReason}
                        </div>
                      )}
                      {ev.url && (
                        <div style={{ fontSize: "9px", color: "#3b82f6", marginTop: "3px", wordBreak: "break-all" }}>
                          {ev.url}
                        </div>
                      )}
                    </div>
                  );
                })}
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
