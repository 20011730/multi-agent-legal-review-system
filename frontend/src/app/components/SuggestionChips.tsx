/**
 * SuggestionChips — 입력창 옆에 표시할 한 줄짜리 추천 문구 칩.
 *
 * 디자인 정책:
 *   - 정적/규칙 기반 (LLM 호출 없음). 최초 MVP 안전 우선.
 *   - 칩 클릭 시 onApply(text) 호출 → 부모가 textarea state 에 append/replace 처리.
 *   - 입력창 의미는 사용자 자유 — 칩은 "출발점" 으로만 제공.
 *
 * 사용 예 (Input.tsx 의 상황 설명 textarea 옆):
 *   <SuggestionChips
 *     title="자주 쓰는 상황 예시"
 *     items={SITUATION_HINTS}
 *     onApply={(t) => setFormData({ ...formData, situation: appendChunk(formData.situation, t) })}
 *   />
 */
import { Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";

export interface SuggestionChipsProps {
  title?: string;
  items: string[];
  /** 칩 텍스트가 사용자 입력에 어떻게 반영될지 결정 — 부모가 control. */
  onApply: (text: string) => void;
  /** 칩 사이 간격을 키워야 할 때 (예: 모바일). 기본 false. */
  compact?: boolean;
}

export function SuggestionChips({ title, items, onApply, compact = false }: SuggestionChipsProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {title && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-[#1E3A8A]" />
          <span>{title}</span>
        </div>
      )}
      <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`}>
        {items.map((chip) => (
          <Badge
            key={chip}
            variant="outline"
            role="button"
            tabIndex={0}
            onClick={() => onApply(chip)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onApply(chip);
              }
            }}
            className="max-w-full cursor-pointer whitespace-normal rounded-full border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-normal leading-snug text-slate-700 hover:border-[#1E3A8A]/40 hover:bg-slate-50"
            title="클릭하면 입력창에 추가됩니다"
          >
            {chip}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * 입력창에 칩을 append — 이미 텍스트가 있으면 줄바꿈으로 이어 붙임.
 * 동일 문구 중복 추가는 회피.
 */
export function appendSuggestion(prev: string, chip: string): string {
  const base = prev ?? "";
  if (!chip) return base;
  if (base.includes(chip)) return base; // 중복 회피
  if (base.trim().length === 0) return chip;
  return `${base.trim()}\n${chip}`;
}
