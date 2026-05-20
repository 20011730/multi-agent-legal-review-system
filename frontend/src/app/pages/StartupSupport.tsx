/**
 * StartupSupport — 스타트업 지원사업 큐레이션 페이지.
 *
 * Phase 진행:
 *   - Phase 1: frontend mock 정적 데이터
 *   - Phase 2: backend mock API fetch (`GET /api/startup-support`)
 *   - Phase 3: Provider 분리
 *   - Phase 3.5: backend query parameter 필터 (`?category=&status=&region=&keyword=`)
 *   - **현재 Phase 4**: frontend 필터 상태 → backend query parameter 연결
 *     · 카테고리/지역/상태 변경 시 즉시 재호출
 *     · keyword 입력은 debounce 300ms
 *     · AbortController 로 stale 응답 무시
 *     · in-memory 중복 필터 제거 (백엔드가 이미 필터한 결과 그대로 사용)
 *     · totalCount 는 첫 진입 시 1회 측정 — 이후 필터 결과 = items.length
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlarmClock, Filter, ListFilter, Loader2, RotateCw, Search, Sparkles, TriangleAlert, X } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { SupportCard } from "../components/startup/SupportCard";
import { SupportFilterBar } from "../components/startup/SupportFilterBar";
import { Input } from "../components/ui/input";
import { fetchStartupSupportListResponse, type StartupSupportFilters } from "../utils/startupSupportApi";
import type { SupportCategory, SupportItem, SupportStatus } from "../utils/mockStartupSupport";

/** 알려진 SupportCategory 값 — URL 에서 들어온 임의 문자열을 안전하게 좁힘. */
const VALID_CATEGORIES: ReadonlyArray<SupportCategory> = [
  "사업화",
  "정책자금",
  "R&D",
  "멘토링",
  "창업교육",
  "법률·세무·노무",
  "투자/IR",
];
const VALID_STATUSES: ReadonlyArray<SupportStatus> = ["마감임박", "모집중", "상시모집", "마감"];

function readCategoryParam(raw: string | null): SupportCategory | "전체" {
  if (!raw) return "전체";
  return (VALID_CATEGORIES as ReadonlyArray<string>).includes(raw) ? (raw as SupportCategory) : "전체";
}
function readStatusParam(raw: string | null): SupportStatus | "전체" {
  if (!raw) return "전체";
  return (VALID_STATUSES as ReadonlyArray<string>).includes(raw) ? (raw as SupportStatus) : "전체";
}

const ALL_CATEGORY: SupportCategory | "전체" = "전체";
const ALL_REGION = "전체";
const ALL_STATUS: SupportStatus | "전체" = "전체";
const KEYWORD_DEBOUNCE_MS = 300;

/** 프론트 필터 상태를 backend filters 객체로 변환. "전체" 값은 누락. */
function toBackendFilters(
  category: SupportCategory | "전체",
  region: string,
  status: SupportStatus | "전체",
  keyword: string,
): StartupSupportFilters {
  const filters: StartupSupportFilters = {};
  if (category !== "전체") filters.category = category;
  if (region !== "전체") filters.region = region;
  if (status !== "전체") filters.status = status;
  const trimmed = keyword.trim();
  if (trimmed) filters.keyword = trimmed;
  return filters;
}

export function StartupSupport() {
  // ── URL query string 동기화 (Phase 6) ──────────────────────────────
  // category / status / region / keyword 는 URL searchParams 가 single source of truth.
  // 컴포넌트 state 는 URL 에서 derive — 뒤로가기/앞으로가기/새로고침/공유 모두 일관 동작.
  // keywordInput 만 typing 중 즉시 반영용 로컬 state — debounce 후 URL 에 반영.
  const [searchParams, setSearchParams] = useSearchParams();

  // URL → 화면 상태 (derived)
  const category = readCategoryParam(searchParams.get("category"));
  const region = searchParams.get("region") || ALL_REGION;
  const status = readStatusParam(searchParams.get("status"));
  const urlKeyword = searchParams.get("keyword") || "";

  // keyword typing 용 로컬 state (lazy init = URL 값으로 시작)
  const [keywordInput, setKeywordInput] = useState<string>(() => urlKeyword);

  // 데이터 상태
  const [items, setItems] = useState<SupportItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);   // 1회 측정 (필터 없는 전체 건수)
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  // Phase 5 envelope 메타
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // ── URL ↔ filter helpers ──────────────────────────────────────────
  /** URL searchParams 부분 갱신. 값이 비거나 "전체" 면 키 삭제. push history (back/forward 가능). */
  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === "" || v === ALL_REGION || v === "전체") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleCategoryChange = useCallback(
    (c: SupportCategory | "전체") => updateSearchParams({ category: c === ALL_CATEGORY ? null : c }),
    [updateSearchParams],
  );
  const handleRegionChange = useCallback(
    (r: string) => updateSearchParams({ region: r === ALL_REGION ? null : r }),
    [updateSearchParams],
  );
  const handleStatusChange = useCallback(
    (s: SupportStatus | "전체") => updateSearchParams({ status: s === ALL_STATUS ? null : s }),
    [updateSearchParams],
  );

  // ── 뒤로가기/앞으로가기로 URL 변경 시 keywordInput 동기화 ──────────────
  // 사용자가 typing 중이 아닐 때만 sync — 동시 갱신 race 회피.
  useEffect(() => {
    setKeywordInput((prev) => (prev === urlKeyword ? prev : urlKeyword));
  }, [urlKeyword]);

  // ── keyword debounce → URL 반영 ───────────────────────────────────
  useEffect(() => {
    const trimmed = keywordInput.trim();
    // 이미 URL 과 동일하면 history 오염 방지
    if (trimmed === urlKeyword) return;
    const t = window.setTimeout(() => {
      updateSearchParams({ keyword: trimmed || null });
    }, KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [keywordInput, urlKeyword, updateSearchParams]);

  // ── API 호출 (URL 필터 의존) ──────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = toBackendFilters(category, region, status, urlKeyword);
    const isFirstAndNoFilters = totalCount === 0 && Object.keys(filters).length === 0;

    fetchStartupSupportListResponse(filters, ctrl.signal)
      .then((envelope) => {
        if (cancelled) return;
        setItems(envelope.items);
        setSourceLabel(envelope.source);
        setLastUpdated(envelope.lastUpdated);
        // 필터 없는 첫 호출이면 totalCount 갱신 (envelope.count 사용)
        if (isFirstAndNoFilters) setTotalCount(envelope.count);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        // AbortError는 SignalAborted 시점에 따라 일반 Error 로 throw 될 수도 있음 — 메시지 패턴 추가 가드
        if (err instanceof Error && /aborted/i.test(err.message)) return;
        console.error("[startup-support] fetch 실패", err);
        setError("지원사업 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [category, region, status, urlKeyword, reloadKey, totalCount]);

  const handleRetry = useCallback(() => setReloadKey((k) => k + 1), []);

  // 마감 임박 상단 강조 (백엔드가 이미 필터해 준 items 안에서)
  const urgentItems = useMemo(
    () => items.filter((i) => i.status === "마감임박"),
    [items],
  );
  const regularItems = useMemo(
    () => items.filter((i) => i.status !== "마감임박"),
    [items],
  );

  const visibleCount = items.length;
  const urgentCount = urgentItems.length;
  // totalCount 가 아직 0 이면 (첫 마운트 + 필터 켜진 진입 등 엣지 케이스) — fallback 으로 visibleCount 사용
  const effectiveTotal = totalCount > 0 ? totalCount : visibleCount;

  const isFilterActive =
    category !== "전체" || region !== "전체" || status !== "전체" || keywordInput.trim() !== "";

  const resetFilters = useCallback(() => {
    setKeywordInput("");
    // URL 전체 클리어 (모든 필터 키 제거)
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  // 검색 input ref — clear 시 focus 유지
  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearKeyword = () => {
    setKeywordInput("");
    updateSearchParams({ keyword: null });
    searchInputRef.current?.focus();
  };

  // ── 에러만 별도 화면 (loading 은 inline 표시 — 필터 조작 중 화면 깜빡임 방지) ──
  if (error) {
    return (
      <MarketingLayout
        title="스타트업 지원사업 큐레이션"
        description="흩어진 창업지원사업을 한곳에서 비교하고, 내 상황에 맞는 제도를 빠르게 찾을 수 있습니다."
      >
        <div className="flex flex-col items-center justify-center rounded-lg border border-rose-200 bg-rose-50 p-12 text-center">
          <TriangleAlert className="mb-3 h-6 w-6 text-rose-600" />
          <p className="text-sm font-medium text-rose-800">{error}</p>
          <p className="mt-1 text-xs text-rose-600">백엔드 서버가 켜져 있는지 확인 후 다시 시도해 주세요.</p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
          >
            <RotateCw className="h-3.5 w-3.5" />
            현재 필터로 다시 시도
          </button>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout
      title="스타트업 지원사업 큐레이션"
      description="흩어진 창업지원사업을 한곳에서 비교하고, 내 상황에 맞는 제도를 빠르게 찾을 수 있습니다. 법률 검토(LexRex AI 토론) 결과와 함께 활용하면 의사결정이 더 빨라집니다."
    >
      {/* 상단 요약 통계 */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ListFilter className="h-3.5 w-3.5" /> 전체 큐레이션
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{effectiveTotal}건</div>
        </div>
        <div className="rounded-lg border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[#1E3A8A]">
            <Filter className="h-3.5 w-3.5" /> 현재 필터 결과
          </div>
          <div className="mt-1 text-lg font-semibold text-[#1E3A8A]">
            총 {effectiveTotal}개 중 {visibleCount}개 지원사업
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-rose-600">
            <AlarmClock className="h-3.5 w-3.5" /> 마감 임박 (필터 적용)
          </div>
          <div className="mt-1 text-lg font-semibold text-rose-700">{urgentCount}건</div>
        </div>
      </div>

      {/* 검색 입력 */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-500">키워드 검색</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={searchInputRef}
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="예: 투자, 청년, R&D, 지식재산권"
            className="pl-9 pr-9"
            aria-label="지원사업 키워드 검색"
          />
          {keywordInput && (
            <button
              type="button"
              onClick={clearKeyword}
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {keywordInput.trim() !== urlKeyword && (
          <p className="mt-1 text-[11px] text-slate-400">입력 중... ({KEYWORD_DEBOUNCE_MS}ms 후 검색)</p>
        )}
      </div>

      {/* 필터 바 (reset 포함) */}
      <div className="mb-6">
        <SupportFilterBar
          category={category}
          region={region}
          status={status}
          isFilterActive={isFilterActive}
          onCategoryChange={handleCategoryChange}
          onRegionChange={handleRegionChange}
          onStatusChange={handleStatusChange}
          onReset={resetFilters}
        />
      </div>

      {/* 로딩 inline indicator (필터 조작 중 화면 보존) */}
      {loading && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E3A8A]" />
          <span>지원사업 정보를 불러오는 중입니다...</span>
        </div>
      )}

      {/* 마감 임박 상단 강조 — 필터 결과 안에 마감임박이 있을 때만 */}
      {urgentItems.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <AlarmClock className="h-4 w-4 text-rose-600" />
            <h2 className="text-sm font-semibold text-rose-700">마감 임박 — 우선 확인</h2>
            <span className="text-xs text-slate-500">({urgentItems.length}건)</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {urgentItems.map((item) => (
              <SupportCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* 일반 카드 그리드 */}
      {!loading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <Sparkles className="mx-auto mb-3 h-6 w-6 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">조건에 맞는 지원사업이 없습니다</p>
          <p className="mt-1 text-xs text-slate-500">필터를 조금 넓혀보세요 — 카테고리/지역/상태 중 하나를 "전체" 로 바꾸거나 검색어를 짧게 줄여 보세요.</p>
          {isFilterActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-[#1E3A8A]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#1E3A8A] hover:bg-[#1E3A8A]/5"
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : regularItems.length > 0 ? (
        <section>
          {urgentItems.length > 0 && (
            <h2 className="mb-3 text-sm font-semibold text-slate-700">전체 결과</h2>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {regularItems.map((item) => (
              <SupportCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 안내 */}
      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">⚠ 본 페이지 안내</p>
        <p className="mt-1">
          본 큐레이션은 K-Startup · 중소벤처기업부 · 한국벤처투자 등의 공개 정보를 참고하여 작성된 <strong>정적 데이터</strong>입니다.
          실제 신청 자격·금액·마감일은 각 기관 공식 페이지에서 반드시 확인해 주세요.
          향후 공공데이터 API 직접 연동을 검토하고 있으며, 법률 검토 결과와의 cross-reference 도 함께 준비됩니다.
        </p>
        {/* Phase 5 envelope 메타 — 데이터 출처 + 최종 갱신 시각 (간단 표시) */}
        {(sourceLabel || lastUpdated) && (
          <p className="mt-2 text-[11px] text-slate-400">
            데이터 출처: <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">{sourceLabel || "unknown"}</code>
            {lastUpdated && (
              <>
                {" · "}최종 응답 시각:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">
                  {new Date(lastUpdated).toLocaleString("ko-KR")}
                </code>
              </>
            )}
          </p>
        )}
      </div>
    </MarketingLayout>
  );
}
