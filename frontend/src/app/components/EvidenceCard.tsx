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
  Info,
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
  /** RAG cosine similarity (0~1). RAG 외 evidence는 undefined. */
  score?: number;
  /** 백엔드 EvidenceDto.metadata — RAG chunk 풍부화 정보 (있을 때만). */
  metadata?: EvidenceMetadata;
}

/** RAG chunk metadata. 모든 키는 optional — 백엔드 변경/구버전 응답에서도 안전. */
export interface EvidenceMetadata {
  sourceType?: string;
  lawMst?: string | number;
  lawId?: string;
  lawNameKr?: string;
  lawTypeName?: string;
  deptName?: string;
  deptCode?: string;
  enforceDate?: string;
  promulgateDate?: string;
  articleNo?: string | number;
  articleTitle?: string;
  caseNumber?: string;
  court?: string;
  judgmentDate?: string;
  caseType?: string;
  section?: string;
  chunkIndex?: number;
  chunkingStrategy?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  url?: string;
  shortName?: string;
  revisionType?: string;
  referenceId?: string | number;
  chunkId?: string;
  // forward-compat: 알 수 없는 키도 허용
  [key: string]: unknown;
}

/* ── metadata 안전 접근 헬퍼 (모든 키 optional) ── */
function metaStr(meta: EvidenceMetadata | undefined, key: keyof EvidenceMetadata): string {
  if (!meta) return "";
  const v = meta[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/* score(0~1) → 사람이 읽기 쉬운 라벨. */
function formatScore(score: number | undefined): string {
  if (typeof score !== "number" || !isFinite(score)) return "";
  return `${(score * 100).toFixed(0)}%`;
}

/* ── 개별 Evidence 아이템 ── */
function EvidenceRow({ ev }: { ev: EvidenceItem }) {
  const [open, setOpen] = useState(false);
  const isLaw = ev.sourceType === "LAW";

  // RAG metadata 우선, 없으면 기본 필드 fallback
  const articleNo = metaStr(ev.metadata, "articleNo");
  const articleTitle = metaStr(ev.metadata, "articleTitle");
  const lawNameKr = metaStr(ev.metadata, "lawNameKr");
  const lawTypeName = metaStr(ev.metadata, "lawTypeName");
  const deptName = metaStr(ev.metadata, "deptName") || ev.articleOrCourt || "";
  const enforceDate = metaStr(ev.metadata, "enforceDate");
  const scoreLabel = formatScore(ev.score);

  const articleLabel = articleNo
    ? `제${articleNo}조${articleTitle ? `(${articleTitle})` : ""}`
    : "";

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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 line-clamp-1">
              {ev.title}
            </span>
            {scoreLabel && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0"
                title="RAG 벡터 유사도"
              >
                관련도 {scoreLabel}
              </span>
            )}
          </div>
          {(deptName || ev.referenceId || articleLabel) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {isLaw && articleLabel
                ? articleLabel
                : isLaw
                ? "소관: "
                : "법원: "}
              {!articleLabel && deptName ? deptName : ""}
              {ev.referenceId && !articleLabel ? ` | ${ev.referenceId}` : ""}
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

          {/* 조문 (RAG metadata 우선) */}
          {isLaw && articleLabel && (
            <div className="flex items-start gap-2 text-xs">
              <Scale className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">조문:</span>
                <p className="font-medium text-gray-900 mt-0.5">{articleLabel}</p>
              </div>
            </div>
          )}

          {/* 소관부처 / 법원·사건번호 (조문이 별도로 있으면 보조 정보) */}
          {(deptName || ev.referenceId) && (
            <div className="flex items-start gap-2 text-xs">
              <Scale className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">
                  {isLaw ? "소관부처:" : "법원/사건번호:"}
                </span>
                <p className="font-medium text-gray-900 mt-0.5">
                  {deptName}
                  {ev.referenceId && !articleLabel ? ` | ${ev.referenceId}` : ""}
                  {lawTypeName ? ` | ${lawTypeName}` : ""}
                  {enforceDate ? ` | 시행 ${enforceDate}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* 인용 본문 (RAG chunk) */}
          {ev.quotedText && (
            <div className="flex items-start gap-2 text-xs">
              <BookOpen className="w-3.5 h-3.5 text-indigo-500 mt-0.5" />
              <div className="flex-1">
                <span className="text-gray-500">인용 본문:</span>
                <p className="text-gray-800 mt-0.5 leading-relaxed bg-white border border-gray-200 rounded-md px-2 py-1.5 whitespace-pre-wrap">
                  {ev.quotedText.length > 600
                    ? ev.quotedText.slice(0, 600) + "…"
                    : ev.quotedText}
                </p>
              </div>
            </div>
          )}

          {/* 관련 이유 / 점수 */}
          {(ev.relevanceReason || scoreLabel) && (
            <div className="flex items-start gap-2 text-xs">
              <Info className="w-3.5 h-3.5 text-indigo-500 mt-0.5" />
              <div>
                <span className="text-gray-500">관련 이유:</span>
                <p className="text-indigo-700 mt-0.5 leading-relaxed">
                  {ev.relevanceReason || (scoreLabel && `벡터 유사도 ${scoreLabel}`)}
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
  if (!evidences || evidences.length === 0) {
    return (
      <Card className={`border-gray-200 ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            법령·판례 근거
          </CardTitle>
          <CardDescription>분석에 매칭된 법령·판례 자료가 표시됩니다</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
            <Info className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
            <div className="text-sm text-gray-600">
              <p>이 검토 건에 매칭된 법령·판례 근거가 없습니다.</p>
              <p className="mt-1 text-xs text-gray-400">
                법제처 OPEN API 키가 미설정이거나, 본문에서 추출한 키워드의 검색 결과가 0건인 경우입니다.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

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
