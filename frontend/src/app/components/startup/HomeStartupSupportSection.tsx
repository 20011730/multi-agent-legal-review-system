/**
 * HomeStartupSupportSection — 메인 페이지의 "스타트업 지원사업 큐레이션" 진입 섹션 (Phase 9.6).
 *
 * - backend `/api/startup-support?size=3&sort=recommend` 로 미리보기 3건 가져옴
 * - 실패/로딩 시에도 메인 페이지가 깨지지 않도록 fallback UI
 * - "지원사업 전체 보기" CTA → `/startup-support`
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Sparkles, ArrowRight, Calendar, Building2, AlarmClock } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { fetchStartupSupportListResponse } from "../../utils/startupSupportApi";
import type { SupportItem } from "../../utils/mockStartupSupport";

interface HomeStartupSupportSectionProps {
  /** 외부 reveal class — Home.tsx 의 getRevealClass("startup") 결과를 받음. 빈 문자열도 안전. */
  revealClass?: string;
}

export function HomeStartupSupportSection({ revealClass = "" }: HomeStartupSupportSectionProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SupportItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    const ctrl = new AbortController();
    // Phase 9.11 — 메인 미리보기는 "모집중 우선" 으로 보여서 실제 신청 가능 항목이 먼저 노출
    fetchStartupSupportListResponse({ size: 3, sort: "activeFirst" }, ctrl.signal)
      .then((env) => {
        setItems(env.items);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && /aborted/i.test(err.message)) return;
        setHasError(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <section id="startup" className="scroll-mt-24 pt-4 pb-14 md:pt-6 md:pb-16">
      <p className={`text-xs uppercase tracking-[0.22em] text-slate-500 mb-3 ${revealClass}`}>
        스타트업 지원사업 큐레이션
      </p>
      <h3 className={`text-[28px] md:text-[36px] leading-[1.15] font-semibold tracking-tight mb-4 ${revealClass}`}>
        창업·성장 단계에 맞는 정부 지원사업을 한곳에
      </h3>
      <p className={`text-base text-slate-600 max-w-3xl leading-relaxed break-keep mb-7 ${revealClass}`}>
        K-Startup · 중소벤처기업부 공공데이터를 결합해 사용자의 상황에 맞는 지원사업을 빠르게 찾고,
        법률 검토 결과와 함께 협약·정산·지식재산 의사결정에 활용할 수 있습니다.
      </p>

      <div className={`grid md:grid-cols-3 gap-5 items-stretch ${revealClass}`}>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white">
                <CardContent className="h-full py-5">
                  <div className="mb-3 h-4 w-20 animate-pulse rounded bg-slate-100" />
                  <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-slate-100" />
                  <div className="mb-2 h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                  <div className="h-12 w-full animate-pulse rounded bg-slate-100" />
                </CardContent>
              </Card>
            ))
          : hasError || items.length === 0
            ? (
              <Card className="border-slate-200 bg-white md:col-span-3">
                <CardContent className="py-8 text-center text-sm text-slate-500">
                  지원사업 미리보기를 불러오지 못했습니다. "지원사업 전체 보기" 에서 직접 확인해 주세요.
                </CardContent>
              </Card>
            )
            : items.slice(0, 3).map((item) => (
                <Card
                  key={item.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/startup-support?status=${encodeURIComponent(item.status)}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/startup-support?status=${encodeURIComponent(item.status)}`);
                    }
                  }}
                  aria-label={`${item.title} 상세 보기`}
                  className="group h-full cursor-pointer border-slate-200 bg-white transition-all hover:-translate-y-1 hover:border-[#1E3A8A] hover:shadow-lg hover:ring-1 hover:ring-[#1E3A8A]/15 focus:outline-none focus-visible:border-[#1E3A8A] focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                >
                  <CardContent className="flex h-full flex-col gap-3 py-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={
                          item.status === "마감임박"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : item.status === "모집중"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800 font-semibold"
                              : "border-sky-200 bg-sky-50 text-sky-700"
                        }
                      >
                        {item.status === "마감임박" && <AlarmClock className="mr-1 h-3 w-3" />}
                        {item.status}
                      </Badge>
                      <Badge variant="outline" className="border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]">
                        {item.category}
                      </Badge>
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {item.region}
                      </Badge>
                    </div>
                    <h4 className="line-clamp-2 break-keep text-base font-semibold text-slate-900 leading-snug">
                      {item.title}
                    </h4>
                    <div className="space-y-1 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-slate-400" />
                        <span className="line-clamp-1">{item.organization}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>마감 {item.deadline}</span>
                      </div>
                    </div>
                    <p className="line-clamp-2 break-keep text-xs text-slate-500">
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      {item.recommendReason}
                    </p>
                    {/* "공고 자세히 보기" 인디케이터 — 항상 보이되 hover 시 강조 + 이동 */}
                    <div className="mt-auto flex items-center justify-end gap-1 text-[12px] font-medium text-[#1E3A8A] transition-all group-hover:gap-2">
                      공고 자세히 보기
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
      </div>

      {/* Phase 9.11 — 4번째 진입 카드 제거됨. 큐레이션 섹션 CTA 를 약간 더 명확하게 (작은 라운드 버튼) */}
      <div className={`mt-7 flex justify-center ${revealClass}`}>
        <button
          type="button"
          onClick={() => navigate("/startup-support")}
          aria-label="스타트업 지원사업 전체 목록 페이지로 이동"
          className="inline-flex h-11 min-w-[220px] items-center justify-center gap-1.5 rounded-full border border-[#1E3A8A] bg-white px-6 text-sm font-medium text-[#1E3A8A] transition hover:bg-[#1E3A8A] hover:text-white"
        >
          지원사업 전체 보기
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
