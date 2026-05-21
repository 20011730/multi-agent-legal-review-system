/**
 * StartupSupportDetailModal — 지원사업 상세 + AI 분석 모달 (Phase 10).
 *
 * - React Portal 기반, position:fixed, z-9999
 * - ESC 닫기 / 외부 클릭 닫기 / 닫기 버튼
 * - 모바일 max-height + overflow-y 처리
 * - "이 공고로 법률 리스크 진단하기" 버튼 → /input 으로 route state(startupContext) 전달
 */
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  X,
  Building2,
  MapPin,
  Target,
  Calendar,
  Sparkles,
  ExternalLink,
  Scale,
  Brain,
  ArrowRight,
  Tag,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { SupportItem, SupportStatus } from "../../utils/mockStartupSupport";
import { buildStartupSupportInsight, type InsightLevel } from "../../utils/startupSupportInsight";

interface StartupSupportDetailModalProps {
  item: SupportItem | null;
  open: boolean;
  onClose: () => void;
}

function statusBadgeClass(status: SupportStatus | string): string {
  switch (status) {
    case "마감임박":
      return "border-rose-200 bg-rose-50 text-rose-700 font-semibold";
    case "모집중":
      return "border-emerald-300 bg-emerald-100 text-emerald-800 font-semibold";
    case "상시모집":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "모집마감":
    case "마감":
      return "border-slate-300 bg-slate-100 text-slate-500";
    case "확인 필요":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-500";
  }
}

function levelBadgeClass(level: InsightLevel): string {
  switch (level) {
    case "높음":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "보통":
      return "border-slate-300 bg-slate-50 text-slate-700";
    case "낮음":
    default:
      return "border-slate-200 bg-white text-slate-500";
  }
}

function sourceLabel(src: string | undefined): string {
  switch (src) {
    case "k-startup-service":
      return "사업공고 조회서비스";
    case "k-startup-news":
      return "창업소식";
    case "k-startup-mixed":
      return "통합 매칭";
    case "mock":
      return "샘플";
    default:
      return src ?? "확인 필요";
  }
}

function isPlaceholder(s: string | undefined): boolean {
  if (!s) return true;
  const t = s.trim();
  return t === "" || t === "공고문 참고" || t === "확인 필요" || t === "(제목 없음)";
}

function primaryActionLabel(status: SupportStatus | string): string {
  if (status === "모집마감" || status === "마감") return "공고문 확인";
  if (status === "상시모집") return "상시 지원 확인";
  return "신청 페이지 열기";
}

export function StartupSupportDetailModal({ item, open, onClose }: StartupSupportDetailModalProps) {
  const navigate = useNavigate();
  const insight = useMemo(() => (item ? buildStartupSupportInsight(item) : null), [item]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // ESC 닫기 + 포커스 trap + 열림 전 포커스 복원 (Phase 10.1 접근성 보강)
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    const focusables = () => {
      if (!dialogRef.current) return [] as HTMLElement[];
      return Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    };
    // 첫 포커스 — 닫기 버튼이 첫 번째
    requestAnimationFrame(() => {
      const fs = focusables();
      fs[0]?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const fs = focusables();
        if (fs.length === 0) return;
        const first = fs[0];
        const last = fs[fs.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // 모달이 열기 전 포커스 위치 복원
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open || !item || !insight) return null;

  const handleLegalReview = () => {
    const startupContext = {
      id: item.id,
      title: item.title,
      organization: item.organization,
      category: item.category,
      target: item.target,
      fieldSummary: item.fieldSummary,
      deadline: item.deadline,
      applyUrl: item.applyUrl,
      source: item.itemSource ?? "k-startup",
      aiInsightHint: item.aiInsightHint ?? insight.summary,
      legalReviewHint: insight.legalReviewPoints.join(" / "),
    };
    // Phase 10.1 — sessionStorage 에 백업하여 새로고침 시에도 컨텍스트 유지
    try {
      sessionStorage.setItem("lexrex.startupContext", JSON.stringify(startupContext));
    } catch {
      /* 사용자가 sessionStorage 차단 시 무시 — location.state 만 의존 */
    }
    onClose();
    navigate("/input", { state: { startupContext } });
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-detail-title"
      style={{ position: "fixed", inset: 0, zIndex: 9999 }}
      className="flex items-center justify-center bg-black/50 p-3 sm:p-6 backdrop-blur-sm"
      onClick={(e) => {
        // 바깥 영역 클릭 닫기
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative flex w-full max-w-2xl max-h-[92vh] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 (상태 배지 + 닫기) */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={statusBadgeClass(item.status)}>
              {item.status}
            </Badge>
            <Badge variant="outline" className="border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]">
              <Tag className="mr-1 h-3 w-3" />
              {item.category}
            </Badge>
            <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
              <MapPin className="mr-1 h-3 w-3" />
              {item.region}
            </Badge>
            {insight.level && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${levelBadgeClass(
                  insight.level,
                )}`}
              >
                <Brain className="h-3 w-3" />
                추천도 {insight.level}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 (스크롤 영역) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 제목 */}
          <h2 id="startup-detail-title" className="break-keep text-lg font-semibold leading-snug text-slate-900">
            {item.title}
          </h2>

          {/* 메타 정보 그리드 */}
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <div className="text-xs text-slate-500">주관 기관</div>
                <div className={isPlaceholder(item.organization) ? "italic text-slate-400" : "text-slate-700"}>
                  {item.organization}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <div className="text-xs text-slate-500">접수 마감</div>
                <div
                  className={
                    item.status === "마감임박"
                      ? "font-medium text-rose-600"
                      : isPlaceholder(item.deadline)
                        ? "italic text-slate-400"
                        : "text-slate-700"
                  }
                >
                  {item.deadline}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <Target className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <div className="text-xs text-slate-500">지원 대상</div>
                <div className={isPlaceholder(item.target) ? "italic text-slate-400" : "text-slate-700"}>
                  {item.target}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <div className="text-xs text-slate-500">지원 분야 / 내용 요약</div>
                <div
                  className={`break-keep whitespace-pre-line ${
                    isPlaceholder(item.fieldSummary) ? "italic text-slate-400" : "text-slate-700"
                  }`}
                >
                  {item.fieldSummary}
                </div>
              </div>
            </div>
          </div>

          {/* 지원 규모 / 예산 — placeholder 값이면 박스 숨김 */}
          {item.maxAmount && item.maxAmount !== "공고문 참고" && (
            <div className="rounded-md border border-[#1E3A8A]/15 bg-[#1E3A8A]/5 px-3 py-2 text-sm font-medium text-[#1E3A8A]">
              💰 지원 규모: {item.maxAmount}
            </div>
          )}

          {/* 지원사업 요약 및 검토 포인트 (Phase 10.1 — wording 톤다운) */}
          <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <Brain className="h-4 w-4" />
              지원사업 요약 및 검토 포인트
              <span className="ml-1 text-[10px] font-normal text-slate-500">(규칙 기반 사전 분석)</span>
            </div>
            <p className="mb-2 break-keep text-sm text-slate-700">
              <span className="font-medium text-slate-800">한 줄 요약 — </span>
              {insight.summary}
            </p>
            <p className="mb-1.5 break-keep text-sm text-slate-700">
              <span className="font-medium text-slate-800">추천 이유 — </span> {insight.reason}
            </p>
            <p className="mb-2.5 break-keep text-sm text-slate-700">
              <span className="font-medium text-slate-800">적합한 사용자 — </span> {insight.fitFor}
            </p>

            {/* Phase 10.13 — 신청자 관점 핵심 (실제 신청 기업이 준비해야 할 항목) */}
            {insight.applicantPerspective.length > 0 && (
              <div className="mb-2 rounded border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                <div className="mb-1.5 text-xs font-semibold text-emerald-800">
                  📋 신청자 관점 핵심 — 실제 준비할 사항
                </div>
                <ul className="ml-4 list-disc space-y-1 break-keep text-[12px] text-emerald-900/90">
                  {insight.applicantPerspective.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {/* Phase 10.9 — 예상 리스크 태그 */}
            {insight.riskTags.length > 0 && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50/60 px-3 py-2">
                <div className="mb-1.5 text-xs font-semibold text-rose-800">예상 리스크 태그</div>
                <div className="flex flex-wrap gap-1.5">
                  {insight.riskTags.map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full border border-rose-300 bg-white px-2 py-0.5 text-[11px] text-rose-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {insight.legalReviewPoints.length > 0 && (
              <div className="mb-2 rounded border border-amber-200 bg-white/80 px-3 py-2">
                <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-amber-800">
                  <Scale className="h-3.5 w-3.5" />
                  법률 검토가 필요한 이유 · 연결 포인트
                </div>
                <ul className="ml-4 list-disc space-y-1 break-keep text-[12px] text-amber-900/90">
                  {insight.legalReviewPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Phase 10.9 — 추천 첨부 자료 */}
            {insight.recommendedAttachments.length > 0 && (
              <div className="mb-2 rounded border border-sky-200 bg-sky-50/60 px-3 py-2">
                <div className="mb-1.5 text-xs font-semibold text-sky-800">추천 첨부 자료 (선택)</div>
                <div className="flex flex-wrap gap-1">
                  {insight.recommendedAttachments.map((a, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] text-sky-700"
                    >
                      📄 {a}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[10.5px] text-slate-500">
                  업로드 전 영업비밀·개인정보를 가리고 필요한 최소 정보만 첨부하시기를 권장합니다.
                </p>
              </div>
            )}

            {/* Phase 10.9 — 원문 근거 문장 (요약문이 아닌 인용) */}
            {insight.evidenceSnippet && (
              <div className="rounded border border-slate-200 bg-white/80 px-3 py-2">
                <div className="mb-1 text-xs font-semibold text-slate-700">원문 근거 (일부 인용)</div>
                <p className="break-keep text-[12px] italic leading-relaxed text-slate-600">
                  "{insight.evidenceSnippet}"
                </p>
              </div>
            )}
          </section>

          {/* 출처 / 원본 분류 */}
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <span className="text-slate-500">데이터 출처: </span>
                <strong className="text-slate-700">{sourceLabel(item.itemSource)}</strong>
              </span>
              {item.rawCategory && item.rawCategory !== item.category && (
                <span>
                  <span className="text-slate-500">원본 분류: </span>
                  <strong className="text-slate-700">{item.rawCategory}</strong>
                </span>
              )}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400">
            ※ 이 분석은 공고 키워드 기반 사전 검토 초안입니다. 실제 법률 진단은 다음 단계(법률 리스크 진단)에서 멀티
            에이전트 토론으로 진행됩니다. 공고문 원문 또는 협약서를 업로드하면 정확도가 향상됩니다.
            실제 신청 자격·금액·마감일은 각 기관 공식 페이지에서 반드시 확인해 주세요.
          </p>
        </div>

        {/* 하단 actions — Phase 10.1: primary 단일 강조 + 보조 outline. 닫기는 우상단 X / ESC / 백드롭 */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-3 sm:flex-row sm:justify-end">
          <Button
            asChild
            type="button"
            size="sm"
            variant="outline"
            className="border-slate-300 text-slate-600 hover:border-[#1E3A8A]/30 hover:text-[#1E3A8A]"
          >
            <a href={item.applyUrl} target="_blank" rel="noopener noreferrer">
              {primaryActionLabel(item.status)}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleLegalReview}
            className="bg-[#1E3A8A] text-white hover:bg-[#16306f] shadow-sm hover:shadow-md"
          >
            <Scale className="mr-1.5 h-3.5 w-3.5" />
            이 공고로 법률 리스크 진단하기
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
