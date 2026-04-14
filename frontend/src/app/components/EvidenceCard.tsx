import { useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Scale,
  FileText,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

/* ── 타입 ── */
export interface EvidenceItem {
  sourceType: string;        // "LAW" | "CASE"
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  url?: string;
  relevanceReason?: string;
  quotedText?: string;
}

/* ── 개별 Evidence 아이템 ── */
function EvidenceRow({ ev }: { ev: EvidenceItem }) {
  const [open, setOpen] = useState(false);
  const isLaw = ev.sourceType === "LAW";

  const handleCopy = () => {
    const text = ev.title + (ev.referenceId ? ` (${ev.referenceId})` : "");
    navigator.clipboard.writeText(text).then(() => {
      toast.success("검색어가 복사되었습니다");
    }).catch(() => {
      toast.error("복사에 실패했습니다");
    });
  };

  const searchUrl = isLaw
    ? `https://www.law.go.kr/법령/${encodeURIComponent(ev.title)}`
    : `https://www.law.go.kr/판례검색?query=${encodeURIComponent(ev.title)}`;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* 기본 요약 행 */}
      <div className="flex items-center gap-3 p-3">
        <Badge
          className={`text-xs flex-shrink-0 ${
            isLaw ? "bg-blue-600" : "bg-purple-600"
          }`}
        >
          {isLaw ? "법령" : "판례"}
        </Badge>

        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-gray-900 line-clamp-1">
            {ev.title}
          </span>
          {(ev.articleOrCourt || ev.referenceId) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {isLaw ? "소관: " : "법원: "}
              {ev.articleOrCourt}
              {ev.referenceId ? ` | ${ev.referenceId}` : ""}
            </p>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-gray-500 hover:text-gray-900"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            title="검색어 복사"
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-gray-500 hover:text-blue-700"
            onClick={() => setOpen(!open)}
            title={open ? "접기" : "상세 보기"}
          >
            {open ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* 상세 패널 (아코디언) */}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* 유형 */}
          <div className="flex items-center gap-2 text-xs">
            <Tag className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-gray-500">유형:</span>
            <span className="font-medium text-gray-700">
              {isLaw ? "법령" : "판례"}
            </span>
          </div>

          {/* 제목 */}
          <div className="flex items-start gap-2 text-xs">
            <FileText className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
            <div>
              <span className="text-gray-500">제목:</span>
              <p className="font-medium text-gray-900 mt-0.5">{ev.title}</p>
            </div>
          </div>

          {/* 조문/사건번호 */}
          {(ev.articleOrCourt || ev.referenceId) && (
            <div className="flex items-start gap-2 text-xs">
              <Scale className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">
                  {isLaw ? "소관부처/조문:" : "법원/사건번호:"}
                </span>
                <p className="font-medium text-gray-900 mt-0.5">
                  {ev.articleOrCourt}
                  {ev.referenceId ? ` | ${ev.referenceId}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* 요약 */}
          {ev.summary && (
            <div className="flex items-start gap-2 text-xs">
              <BookOpen className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">요약:</span>
                <p className="text-gray-700 mt-0.5 leading-relaxed">
                  {ev.summary}
                </p>
              </div>
            </div>
          )}

          {/* 인용문 */}
          {ev.quotedText && (
            <div className="bg-white p-2 rounded border border-gray-200 text-xs text-gray-600 italic">
              "{ev.quotedText}"
            </div>
          )}

          {/* 관련 키워드 / 관련 사유 */}
          {ev.relevanceReason && (
            <div className="text-xs">
              <span className="text-indigo-600 font-medium">관련 사유: </span>
              <span className="text-indigo-700">{ev.relevanceReason}</span>
            </div>
          )}

          {/* 하단 액션 */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCopy}
            >
              <Copy className="w-3 h-3 mr-1" />
              검색어 복사
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(searchUrl, "_blank")}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              공식 사이트에서 검색
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 메인 컴포넌트: Evidence 카드 리스트 ── */
export function EvidenceCardList({
  evidences,
  className = "",
}: {
  evidences: EvidenceItem[];
  className?: string;
}) {
  if (!evidences || evidences.length === 0) return null;

  return (
    <Card className={`border-gray-200 ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" />
          법령·판례 근거
        </CardTitle>
        <CardDescription>
          분석에 참조된 법령 및 판례 자료 — 상세 보기를 눌러 내용을 확인하세요
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {evidences.map((ev, idx) => (
            <EvidenceRow key={idx} ev={ev} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
