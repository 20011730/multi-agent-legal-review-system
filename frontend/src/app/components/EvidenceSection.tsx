import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Search,
  Copy,
  Check,
  Info,
} from "lucide-react";

export interface EvidenceItem {
  sourceType: string;
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  url?: string;
  relevanceReason?: string;
  quotedText?: string;
}

/**
 * 법령/판례 공개 검색 URL 생성
 * DRF API URL(인증 필요)이 아닌, 국가법령정보센터 공개 검색 페이지로 연결
 */
function buildPublicSearchUrl(ev: EvidenceItem): string {
  const base = "https://www.law.go.kr";
  if (ev.sourceType === "LAW") {
    // 법령: 법령명으로 직접 접근
    return `${base}/법령/${encodeURIComponent(ev.title.replace(/\s+/g, ""))}`;
  }
  // 판례: 사건번호가 있으면 사건번호로 검색, 없으면 사건명으로 검색
  const query = ev.referenceId || ev.title;
  return `${base}/판례/(${encodeURIComponent(query)})`;
}

function EvidenceCard({ ev }: { ev: EvidenceItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = ev.sourceType === "LAW"
      ? ev.title
      : `${ev.title} ${ev.referenceId || ""}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const publicUrl = buildPublicSearchUrl(ev);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {/* 기본 표시 영역 (항상 보임) */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <Badge
          className={`text-xs flex-shrink-0 mt-0.5 ${
            ev.sourceType === "LAW" ? "bg-blue-600" : "bg-purple-600"
          }`}
        >
          {ev.sourceType === "LAW" ? "법령" : "판례"}
        </Badge>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-gray-900 line-clamp-2">
            {ev.title}
          </span>
          {ev.articleOrCourt && (
            <p className="text-xs text-gray-500 mt-0.5">
              {ev.sourceType === "LAW" ? "소관: " : "법원: "}
              {ev.articleOrCourt}
              {ev.referenceId ? ` | ${ev.referenceId}` : ""}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 mt-0.5 text-gray-400">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </button>

      {/* 상세 보기 (펼침 시) */}
      {expanded && (
        <div className="px-4 py-3 bg-white border-t border-gray-100 space-y-3">
          {/* 상세 정보 테이블 */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <span className="text-gray-400 font-medium">유형</span>
            <span className="text-gray-700">
              {ev.sourceType === "LAW" ? "법령" : "판례"}
            </span>

            <span className="text-gray-400 font-medium">
              {ev.sourceType === "LAW" ? "법령명" : "사건명"}
            </span>
            <span className="text-gray-900 font-medium">{ev.title}</span>

            {ev.articleOrCourt && (
              <>
                <span className="text-gray-400 font-medium">
                  {ev.sourceType === "LAW" ? "소관부처" : "법원"}
                </span>
                <span className="text-gray-700">{ev.articleOrCourt}</span>
              </>
            )}

            {ev.referenceId && (
              <>
                <span className="text-gray-400 font-medium">
                  {ev.sourceType === "LAW" ? "법령번호" : "사건번호"}
                </span>
                <span className="text-gray-700">{ev.referenceId}</span>
              </>
            )}

            {ev.summary && (
              <>
                <span className="text-gray-400 font-medium">요약</span>
                <span className="text-gray-700">{ev.summary}</span>
              </>
            )}

            {ev.relevanceReason && (
              <>
                <span className="text-gray-400 font-medium">관련성</span>
                <span className="text-indigo-600">{ev.relevanceReason}</span>
              </>
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}
            >
              <Search className="w-3 h-3 mr-1" />
              국가법령정보센터에서 검색
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1 text-green-600" />
                  <span className="text-green-600">복사됨</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  검색어 복사
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EvidenceSection({ evidences }: { evidences: EvidenceItem[] }) {
  return (
    <Card className="border-gray-200 mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" />
          법령·판례 근거
        </CardTitle>
        <CardDescription>분석에 참조된 법령 및 판례 자료</CardDescription>
      </CardHeader>
      <CardContent>
        {evidences.length > 0 ? (
          <div className="space-y-2">
            {/* 안내 문구 */}
            <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg mb-3">
              <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                각 항목을 클릭하면 상세 정보를 확인할 수 있습니다. 원문은 국가법령정보센터에서 검색하여 열람하세요.
              </p>
            </div>

            {evidences.map((ev, idx) => (
              <EvidenceCard key={idx} ev={ev} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            참조된 법령·판례 근거가 없습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
