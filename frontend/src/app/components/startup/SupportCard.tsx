/**
 * SupportCard — 스타트업 지원사업 한 건 표시.
 * Phase 9.7: AI insight popover 를 React Portal 로 렌더 → 카드/그리드 overflow 영향 0.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Calendar, ExternalLink, MapPin, Sparkles, Target, Brain, Scale } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import type { SupportItem, SupportStatus } from "../../utils/mockStartupSupport";
import { buildStartupSupportInsight, type InsightLevel } from "../../utils/startupSupportInsight";

interface SupportCardProps {
  item: SupportItem;
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

function isClosed(status: SupportStatus | string): boolean {
  return status === "모집마감" || status === "마감";
}

/** "공고문 참고"/"확인 필요" 같은 placeholder 값 — 액션처럼 보이지 않게 약하게 렌더. */
function isPlaceholderValue(s: string | undefined): boolean {
  if (!s) return true;
  const t = s.trim();
  return t === "" || t === "공고문 참고" || t === "확인 필요" || t === "(제목 없음)";
}

/** placeholder 값은 italic + 약한 색, 실제 값은 일반 텍스트. */
function fieldValueClass(s: string | undefined): string {
  return isPlaceholderValue(s) ? "italic text-slate-400" : "";
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

/** popover 위치 — anchor 요소 기준 viewport 좌표 계산. */
function calcPosition(anchor: DOMRect): { top: number; left: number; placeBelow: boolean } {
  const popW = 320;
  const popH = 280; // 추정 — 실제는 가변. 화면 끝 부근일 때 위로 띄움.
  const margin = 8;
  let left = anchor.right - popW;
  if (left < margin) left = margin;
  if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
  // 위/아래 선택: 아래쪽 공간 부족하면 위로
  const spaceBelow = window.innerHeight - anchor.bottom;
  const placeBelow = spaceBelow > popH + margin;
  const top = placeBelow ? anchor.bottom + 6 : anchor.top - popH - 6;
  return { top, left, placeBelow };
}

export function SupportCard({ item }: SupportCardProps) {
  const insight = useMemo(() => buildStartupSupportInsight(item), [item]);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placeBelow: boolean } | null>(null);

  // open 상태에서 anchor 위치 측정
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos(calcPosition(rect));
  }, [open]);

  // 스크롤/리사이즈 시 popover 위치 갱신 + outside click 닫기
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (anchorRef.current) setPos(calcPosition(anchorRef.current.getBoundingClientRect()));
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 320, zIndex: 9999 }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-700 shadow-xl"
            role="tooltip"
          >
            <div className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-[#1E3A8A]">
              <Sparkles className="h-3.5 w-3.5" />
              AI 요약 &amp; 추천 분석
            </div>
            <p className="mb-2 break-keep text-slate-600">{insight.summary}</p>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="font-medium text-slate-800">추천도</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${levelBadgeClass(
                  insight.level,
                )}`}
              >
                {insight.level}
              </span>
            </div>
            <p className="mb-1 break-keep">
              <span className="font-medium text-slate-800">왜 추천?</span> {insight.reason}
            </p>
            <p className="mb-2 break-keep">
              <span className="font-medium text-slate-800">적합한 사용자:</span> {insight.fitFor}
            </p>
            {insight.legalReviewPoints.length > 0 && (
              <div className="mt-1 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5">
                <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                  <Scale className="h-3 w-3" />
                  법률 검토 연결 포인트
                </div>
                <ul className="ml-3 list-disc space-y-0.5 break-keep text-amber-900/90">
                  {insight.legalReviewPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-400">
              ※ rule-기반 deterministic 분석 (LLM 미사용)
            </p>
          </div>,
          document.body,
        )
      : null;

  const closed = isClosed(item.status);

  return (
    <Card
      className={`h-full border-slate-200 transition-shadow hover:shadow-md ${
        closed ? "bg-slate-50/70 opacity-90" : "bg-white"
      }`}
    >
      <CardContent className={`flex h-full flex-col gap-3 pb-5 pt-5 ${closed ? "text-slate-600" : ""}`}>
        {/* header: 상태 + 카테고리 + 지역 + AI 추천 배지 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={statusBadgeClass(item.status)}>
            {item.status}
          </Badge>
          <Badge variant="outline" className="border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]">
            {item.category}
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
            <MapPin className="mr-1 h-3 w-3" />
            {item.region}
          </Badge>
          <button
            ref={anchorRef}
            type="button"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={() => setOpen((v) => !v)}
            onFocus={() => setOpen(true)}
            aria-expanded={open}
            aria-label="AI 추천 분석 보기"
            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${levelBadgeClass(
              insight.level,
            )} focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/30`}
          >
            <Brain className="h-3 w-3" />
            추천도 {insight.level}
          </button>
        </div>

        {/* title */}
        <h3 className="line-clamp-2 break-keep text-base font-semibold text-slate-900 leading-snug">
          {item.title}
        </h3>

        {/* 주관기관 + 지원금 + 마감일 */}
        <div className="space-y-1.5 text-xs text-slate-600">
          <div className="flex items-start gap-2">
            <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-1">{item.organization}</span>
          </div>
          <div className="flex items-start gap-2">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-1">
              <span className="text-slate-500">지원대상: </span>
              <span className={fieldValueClass(item.target)}>{item.target}</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-2 break-keep">
              <span className="text-slate-500">지원분야: </span>
              <span className={fieldValueClass(item.fieldSummary)}>{item.fieldSummary}</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              <span className="text-slate-500">{(item.status as string) === "공지" ? "게시일" : "마감"}: </span>
              <span
                className={
                  item.status === "마감임박"
                    ? "font-medium text-rose-600"
                    : fieldValueClass(item.deadline)
                }
              >
                {item.deadline}
              </span>
            </span>
          </div>
        </div>

        {/* 지원금 — 실제 금액 값이 있을 때만 강조 박스 */}
        {item.maxAmount && item.maxAmount !== "공고문 참고" && (
          <div className="rounded-md border border-[#1E3A8A]/15 bg-[#1E3A8A]/5 px-3 py-2 text-sm font-medium text-[#1E3A8A]">
            {item.maxAmount}
          </div>
        )}

        {/* 추천 이유 */}
        <p className="line-clamp-3 break-keep text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-700">💡 추천 이유: </span>
          {item.recommendReason}
        </p>

        {/* rawCategory + itemSource (Phase 9.8) */}
        {(item.rawCategory || item.itemSource) && (
          <p className="text-[10px] text-slate-400">
            {item.rawCategory && item.rawCategory !== item.category && (
              <>원문 분류: <span className="text-slate-500">{item.rawCategory}</span></>
            )}
            {item.rawCategory && item.rawCategory !== item.category && item.itemSource && " · "}
            {item.itemSource && (
              <>
                출처:{" "}
                <span className="text-slate-500">
                  {item.itemSource === "k-startup-news"
                    ? "창업소식"
                    : item.itemSource === "k-startup-service"
                      ? "사업공고 조회서비스"
                      : item.itemSource === "mock"
                        ? "샘플"
                        : item.itemSource}
                </span>
              </>
            )}
          </p>
        )}

        {/* action — 모집마감 항목은 약한 회색 톤 + "공고문 확인" 라벨 */}
        <div className="mt-auto">
          <Button
            asChild
            variant="outline"
            size="sm"
            className={
              closed
                ? "w-full border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                : "w-full border-[#1E3A8A]/30 text-[#1E3A8A] hover:bg-[#1E3A8A]/5"
            }
          >
            <a href={item.applyUrl} target="_blank" rel="noopener noreferrer">
              {closed ? "공고문 확인" : "신청 페이지 열기"}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardContent>
      {popover}
    </Card>
  );
}
