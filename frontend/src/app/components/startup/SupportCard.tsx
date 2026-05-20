/**
 * SupportCard — 스타트업 지원사업 한 건 표시.
 * 정적 mock 데이터 기반 (Phase 1).
 */
import { Building2, Calendar, ExternalLink, MapPin, Sparkles, Target } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import type { SupportItem, SupportStatus } from "../../utils/mockStartupSupport";

interface SupportCardProps {
  item: SupportItem;
}

function statusBadgeClass(status: SupportStatus): string {
  switch (status) {
    case "마감임박":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "모집중":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "상시모집":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "마감":
    default:
      return "border-slate-200 bg-slate-100 text-slate-500";
  }
}

export function SupportCard({ item }: SupportCardProps) {
  return (
    <Card className="h-full border-slate-200 bg-white transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3 pb-5 pt-5">
        {/* header: 상태 + 카테고리 + 지역 */}
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
        </div>

        {/* title */}
        <h3 className="line-clamp-2 text-base font-semibold text-slate-900 leading-snug">
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
              {item.target}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-2">
              <span className="text-slate-500">지원분야: </span>
              {item.fieldSummary}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              <span className="text-slate-500">마감: </span>
              <span className={item.status === "마감임박" ? "font-medium text-rose-600" : ""}>{item.deadline}</span>
            </span>
          </div>
        </div>

        {/* 지원금 highlight */}
        <div className="rounded-md border border-[#1E3A8A]/15 bg-[#1E3A8A]/5 px-3 py-2 text-sm font-medium text-[#1E3A8A]">
          {item.maxAmount}
        </div>

        {/* 추천 이유 */}
        <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-700">💡 추천 이유: </span>
          {item.recommendReason}
        </p>

        {/* action */}
        <div className="mt-auto">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="w-full border-[#1E3A8A]/30 text-[#1E3A8A] hover:bg-[#1E3A8A]/5"
          >
            <a href={item.applyUrl} target="_blank" rel="noopener noreferrer">
              신청 페이지 열기
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
