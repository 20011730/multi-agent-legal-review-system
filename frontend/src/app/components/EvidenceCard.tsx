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
  /** 검색 source 태그 ("cases_e5" / "laws_e5" / "extended_case..." / undefined). */
  dataSource?: string;
}

/** RAG chunk metadata. 모든 키는 optional — 백엔드 변경/구버전 응답에서도 안전.
 *  CASE 의 경우 Python 어댑터(`ai/generate_rag/5-2.insert_cases_e5.py`)가 snake_case 로 적재하므로
 *  snake_case alias 도 함께 노출됨. 사용 시 metaStrAny() 헬퍼로 두 표기법을 한 번에 처리. */
export interface EvidenceMetadata {
  sourceType?: string;
  source_type?: string;             // CASE adapter (snake_case)
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
  // CASE: camelCase
  caseNumber?: string;
  court?: string;
  judgmentDate?: string;
  caseType?: string;
  section?: string;
  section_type?: string;
  subsection_label?: string;
  ref_statutes?: string;
  ref_cases?: string;
  db_id?: string | number;
  // CASE: snake_case alias (Python adapter)
  case_number?: string;
  case_name?: string;
  decision_date?: string;
  text_type?: string;
  referenced_laws?: string;
  source_url?: string;
  summary?: string;
  // 공통
  chunkIndex?: number;
  chunk_index?: number;
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

/* 여러 키 후보 중 처음 발견되는 non-empty 값 (CASE snake_case ↔ camelCase 호환). */
function metaStrAny(meta: EvidenceMetadata | undefined, ...keys: string[]): string {
  if (!meta) return "";
  for (const k of keys) {
    const v = (meta as Record<string, unknown>)[k];
    if (v !== null && v !== undefined) {
      const s = String(v);
      if (s.length > 0) return s;
    }
  }
  return "";
}

/* Phase 10.85 — formatScore 는 사용자 화면 노출을 중단. PDF/내부 디버그에서도 사용하지 않음. */

/**
 * CASE chunk 의 text_type (backend metadata) → 사용자 친화 한글 라벨.
 * 본문/판결요지/판시사항/참조조문 등 — title 의 sectionLabel 과 별개로 카드 상단 작은 배지로 활용 가능.
 */
function humanizeTextType(textType: string): string {
  if (!textType) return "";
  // 공백 정규화 — "이    유" / "이유" / "주    문" / "주문" 등 두 형식 모두 인식
  const t = textType.replace(/\s+/g, "");
  switch (t) {
    case "body": return "판례 본문";
    case "main":
    case "본문":
      return "판례 본문";
    case "holding":
    case "summary":
    case "판결요지":
    case "판시사항요약":
      return "판결요지";
    case "issue":
    case "issues":
    case "판시사항":
      return "판시사항";
    case "referenced_laws":
    case "참조조문":
      return "참조조문";
    case "referenced_cases":
    case "참조판례":
      return "참조판례";
    case "이유": return "판단이유";
    case "주문": return "주문";
    case "결론": return "결론";
    case "인정근거": return "인정근거";
    case "청구취지": return "청구취지";
    case "청구취지및항소취지": return "청구취지";
    case "meta": return "메타정보";
    // Phase 10.71 — section_type 이 "피고인" / "원고" / "당사자참가인" 등 사건 당사자 라벨 (본문 아닌
    //   헤더 chunk) 일 때는 사용자 화면에 노출하지 않음 (chip 미표시).
    case "피고인":
    case "피고인들":
    case "피고피상고인":
    case "원고":
    case "원고들":
    case "원고상고인":
    case "원고피상고인":
    case "당사자참가인":
    case "당사자참가인피상고인":
    case "피고인수참가인":
    case "원심판결":
      return "";
    default: return "";
  }
}

/**
 * body_status 원시값 (backend 진단 메타) → 사용자 친화 한글 문구.
 * 빈 문자열 또는 "ok" 면 표시 안 함 (정상 case 이므로 라벨 불필요).
 */
function humanizeBodyStatus(bodyStatus: string): string {
  if (!bodyStatus || bodyStatus === "ok") return "";
  switch (bodyStatus) {
    case "skip:external-data-source":
      return "본문 미확보 · 외부 출처";
    case "empty-root:Law":
    case "all-empty":
      return "본문 미확보";
    case "xml-parse-error":
      return "본문 파싱 실패";
    default:
      // 모르는 status — "본문 미확보" 로 보수적 표시 (원시값 노출 X)
      return "본문 미확보";
  }
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
  // Phase 10.85 — scoreLabel (벡터 유사도 %) 은 사용자 화면에서 노출하지 않음.

  // CASE 전용 상태 라벨 (카드 요약 행에 한눈에 보이도록 표시) — 닫힌 상태에서도 본문 vs 메타 구분
  const caseTextType = !isLaw ? metaStrAny(ev.metadata, "text_type", "section", "section_type", "subsection_label") : "";
  const caseBodyStatus = !isLaw ? metaStrAny(ev.metadata, "body_status") : "";
  const caseDataSource = !isLaw ? metaStrAny(ev.metadata, "data_source") : "";
  // "참고용 메타" 판정 — 데이터 출처가 빈값('') 이거나 '대법원' 같은 법제처 직영이면 정상 본문 case.
  // 외부 시스템(예: 국세법령정보시스템) 또는 본문이 명시적으로 비어 있는 경우만 ref-only 로 표시.
  // (data_source 가 채워졌다는 사실만으로 ref-only 판정하지 않음 — 직전 버그 수정)
  const EXTERNAL_DATA_SOURCES = new Set<string>(["국세법령정보시스템"]);
  const caseBodyMissing = caseBodyStatus !== "" && caseBodyStatus !== "ok";
  const caseFromExternalSystem = caseDataSource !== "" && EXTERNAL_DATA_SOURCES.has(caseDataSource);
  const caseIsReferenceOnly = !isLaw && (caseBodyMissing || caseFromExternalSystem);
  const caseTextTypeLabel = !isLaw && !caseIsReferenceOnly ? humanizeTextType(caseTextType) : "";
  const isExtendedCaseSource = !isLaw && Boolean(ev.dataSource?.toLowerCase().startsWith("extended_case"));

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

  /* Phase 10.85 — 공식 사이트(국가법령정보센터) deep link.
     LAW: 법령명으로 법령 페이지(`/법령/{명}`) 열기.
     CASE: referenceId 에서 순수 사건번호(YYYY+한글+숫자, 예: 2022누56427)만 정규화해
           판례 단축경로(`/판례/{사건번호}`) 시도. 정규화 실패 시 통합검색 폴백.
     이전 `판례검색?query=` 경로는 동작하지 않아 빈 결과 페이지가 떴음.
     검색어(title/referenceId) 가 전혀 없으면 링크 비활성화. */
  const buildSearchUrl = (): string | null => {
    if (isLaw) {
      // 법령 단축경로(`/법령/{명}`)는 조문 번호 없이 순수 법령명만 받음.
      // title 에 "...법률 제27조" / 중복 "제제27조" 가 붙어 있으면 제거.
      const rawName = (lawNameKr || ev.title || "").trim();
      const lawName = rawName.replace(/\s*제+\s*\d+\s*조(?:의\s*\d+)?.*$/, "").trim();
      if (!lawName) return null;
      return `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`;
    }
    const ref = (ev.referenceId || "").trim();
    // "서울고등법원-2022-누-56427" → "서울고등법원2022누56427" → 사건번호 "2022누56427"
    const cleaned = ref.replace(/[-\s]/g, "");
    const m = /([0-9]{4}[가-힣]{1,3}[0-9]+)/.exec(cleaned);
    if (m) {
      return `https://www.law.go.kr/판례/(${encodeURIComponent(m[1])})`;
    }
    // 사건번호 정규화 실패 → 통합검색 폴백 (사건명/제목)
    const q = (ev.title || ref || "").trim();
    if (!q) return null;
    return `https://www.law.go.kr/LSW/precInfoR.do?precSeq=&searchQuery=${encodeURIComponent(q)}`;
  };
  const searchUrl = buildSearchUrl();

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
        {/* Phase 10.64 — 검색 source 구분 chip (운영 vs 확장). 내부 collection 명은 노출하지 않음. */}
        {isExtendedCaseSource && (
          <Badge
            variant="outline"
            className="text-[10px] flex-shrink-0 border-indigo-300 bg-indigo-50 text-indigo-700"
            title="확장 판례 DB"
          >
            확장 판례 DB
          </Badge>
        )}
        {ev.dataSource && !isExtendedCaseSource && !isLaw && (
          <Badge
            variant="outline"
            className="text-[10px] flex-shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
            title="운영 판례 DB"
          >
            기존 판례 DB
          </Badge>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 line-clamp-1">
              {ev.title}
            </span>
            {/* Phase 10.85 — 사용자 화면에서 벡터 유사도/관련도 % 표시 제거.
                내부 RAG 점수는 사용자에게 오해를 줄 수 있어 노출하지 않음. */}
            {/* CASE: 본문 풍부 (text_type=body/holding/issue/...) 시 양성 라벨, 메타 only 시 amber 경고 */}
            {caseTextTypeLabel && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0"
                title="이 판례 카드의 본문 종류"
              >
                {caseTextTypeLabel}
              </span>
            )}
            {caseIsReferenceOnly && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 shrink-0"
                title="본문이 확보되지 않은 참고용 메타 카드"
              >
                참고용 메타
              </span>
            )}
          </div>
          {/* 보조 텍스트 — 빈값 라벨이 노출되지 않도록 보호.
              LAW: 조문 또는 "소관: 부처명"
              CASE: 법원명 + 사건번호 (법원/사건번호 둘 다 빈값이면 행 자체 숨김) */}
          {(() => {
            // LAW 흐름: 조문 라벨 우선, 없으면 소관부처
            if (isLaw) {
              if (articleLabel) {
                return (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{articleLabel}</p>
                );
              }
              if (deptName) {
                return (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                    소관: {deptName}
                  </p>
                );
              }
              return null;
            }
            // CASE 흐름: 법원 / 사건번호 둘 다 비어 있으면 행 숨김
            const courtName = deptName; // CASE 의 articleOrCourt = court
            const caseNumber = ev.referenceId;
            if (!courtName && !caseNumber) return null;
            const parts: string[] = [];
            if (courtName) parts.push(courtName);
            if (caseNumber) parts.push(String(caseNumber));
            return (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                {parts.join(" | ")}
              </p>
            );
          })()}
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

          {/* CASE 전용: 선고일 + 참조조문 (snake_case/camelCase 양쪽 fallback) */}
          {!isLaw && (() => {
            const decisionDate = metaStrAny(ev.metadata, "decision_date", "judgmentDate");
            const referencedLaws = metaStrAny(ev.metadata, "referenced_laws", "ref_statutes");
            const referencedCases = metaStrAny(ev.metadata, "ref_cases");
            const textType = metaStrAny(ev.metadata, "text_type", "section", "section_type", "subsection_label");
            const bodyStatus = metaStrAny(ev.metadata, "body_status");
            const dataSource = metaStrAny(ev.metadata, "data_source");
            // "참고용 메타" 판정 — 카드 요약 행과 동일 정책 유지.
            //   * body_status 가 비어있지 않고 "ok" 가 아닌 경우 → 본문 미확보
            //   * data_source 가 명시적 외부 시스템(국세법령정보시스템)인 경우만
            //   * data_source 가 "" 또는 "대법원" 등 법제처 직영이면 정상 — ref-only 아님
            const EXTERNAL_DATA_SOURCES_INNER = new Set<string>(["국세법령정보시스템"]);
            const bodyMissing = bodyStatus !== "" && bodyStatus !== "ok";
            const fromExternal = dataSource !== "" && EXTERNAL_DATA_SOURCES_INNER.has(dataSource);
            const isReferenceOnly = bodyMissing || fromExternal;
            if (!decisionDate && !referencedLaws && !referencedCases && !textType && !isReferenceOnly) return null;
            return (
              <div className="space-y-1">
                {decisionDate && (
                  <div className="flex items-start gap-2 text-xs">
                    <FileText className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                    <div>
                      <span className="text-gray-500">선고일:</span>
                      <span className="font-medium text-gray-900 ml-1">{decisionDate}</span>
                    </div>
                  </div>
                )}
                {textType && (
                  <div className="flex items-start gap-2 text-xs">
                    <Tag className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                    <div>
                      <span className="text-gray-500">구분:</span>
                      <span className="font-medium text-gray-700 ml-1">
                        {humanizeTextType(textType) || textType}
                      </span>
                    </div>
                  </div>
                )}
                {referencedLaws && (
                  <div className="flex items-start gap-2 text-xs">
                    <BookOpen className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                    <div>
                      <span className="text-gray-500">참조조문:</span>
                      <p className="text-gray-700 mt-0.5 leading-relaxed">{referencedLaws}</p>
                    </div>
                  </div>
                )}
                {referencedCases && (
                  <div className="flex items-start gap-2 text-xs">
                    <BookOpen className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                    <div>
                      <span className="text-gray-500">참조판례:</span>
                      <p className="text-gray-700 mt-0.5 leading-relaxed">{referencedCases}</p>
                    </div>
                  </div>
                )}
                {isReferenceOnly && (
                  <div className="flex items-start gap-2 text-xs">
                    <Info className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
                    <div>
                      <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                        참고용 메타
                      </span>
                      <span className="text-gray-600 ml-1.5">
                        {humanizeBodyStatus(bodyStatus) || "본문 미확보, 메타 기반 참고 결과"}
                        {dataSource ? ` · 출처: ${dataSource}` : ""}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

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

          {/* 관련 이유 — Phase 10.85: 벡터 유사도 fallback 문구 제거. relevanceReason 이 있을 때만 표시. */}
          {ev.relevanceReason && (
            <div className="flex items-start gap-2 text-xs">
              <Info className="w-3.5 h-3.5 text-indigo-500 mt-0.5" />
              <div>
                <span className="text-gray-500">관련 이유:</span>
                <p className="text-indigo-700 mt-0.5 leading-relaxed">
                  {ev.relevanceReason}
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
              disabled={!searchUrl}
              title={searchUrl ? "국가법령정보센터에서 검색" : "검색어가 없어 검색을 열 수 없습니다"}
              onClick={() => {
                if (!searchUrl) return;
                // Phase 10.85 — deep link 가 결과를 못 띄울 가능성에 대비해 검색어를 함께 복사.
                navigator.clipboard?.writeText(
                  ev.title + (ev.referenceId ? ` (${ev.referenceId})` : ""),
                ).catch(() => { /* 클립보드 실패는 무시 — 링크는 그대로 열림 */ });
                window.open(searchUrl, "_blank", "noopener,noreferrer");
              }}
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
                입력 내용에서 확인 가능한 법령·판례 근거가 충분하지 않은 경우입니다.
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
