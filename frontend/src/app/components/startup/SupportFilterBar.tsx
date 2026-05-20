/**
 * SupportFilterBar — 카테고리/지역/상태 필터 바.
 * 정적 chip 기반. 부모(StartupSupport) 가 필터 state 관리.
 */
import { Badge } from "../ui/badge";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_REGIONS,
  type SupportCategory,
  type SupportStatus,
} from "../../utils/mockStartupSupport";

interface SupportFilterBarProps {
  category: SupportCategory | "전체";
  region: string | "전체";
  status: SupportStatus | "전체";
  isFilterActive?: boolean;
  onCategoryChange: (c: SupportCategory | "전체") => void;
  onRegionChange: (r: string) => void;
  onStatusChange: (s: SupportStatus | "전체") => void;
  onReset?: () => void;
}

const STATUS_OPTIONS: Array<SupportStatus | "전체"> = ["전체", "마감임박", "모집중", "상시모집"];

function chipClass(active: boolean): string {
  return active
    ? "cursor-pointer border-[#1E3A8A] bg-[#1E3A8A] text-white hover:bg-[#1E3A8A]/90"
    : "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100";
}

export function SupportFilterBar({
  category,
  region,
  status,
  isFilterActive = false,
  onCategoryChange,
  onRegionChange,
  onStatusChange,
  onReset,
}: SupportFilterBarProps) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {/* 헤더: 필터 라벨 + reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">필터</p>
        {isFilterActive && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-[#1E3A8A]/30 hover:bg-slate-50 hover:text-[#1E3A8A]"
            aria-label="필터 초기화"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* 카테고리 */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">카테고리</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            role="button"
            tabIndex={0}
            onClick={() => onCategoryChange("전체")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCategoryChange("전체");
              }
            }}
            className={`rounded-full px-3 py-1 text-xs font-normal ${chipClass(category === "전체")}`}
          >
            전체
          </Badge>
          {SUPPORT_CATEGORIES.map((c) => (
            <Badge
              key={c}
              variant="outline"
              role="button"
              tabIndex={0}
              onClick={() => onCategoryChange(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCategoryChange(c);
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-normal ${chipClass(category === c)}`}
            >
              {c}
            </Badge>
          ))}
        </div>
      </div>

      {/* 지역 */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">지역</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            role="button"
            tabIndex={0}
            onClick={() => onRegionChange("전체")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRegionChange("전체");
              }
            }}
            className={`rounded-full px-3 py-1 text-xs font-normal ${chipClass(region === "전체")}`}
          >
            전체
          </Badge>
          {SUPPORT_REGIONS.map((r) => (
            <Badge
              key={r}
              variant="outline"
              role="button"
              tabIndex={0}
              onClick={() => onRegionChange(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRegionChange(r);
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-normal ${chipClass(region === r)}`}
            >
              {r}
            </Badge>
          ))}
        </div>
      </div>

      {/* 상태 */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">모집 상태</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((s) => (
            <Badge
              key={s}
              variant="outline"
              role="button"
              tabIndex={0}
              onClick={() => onStatusChange(s)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onStatusChange(s);
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-normal ${chipClass(status === s)}`}
            >
              {s}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
