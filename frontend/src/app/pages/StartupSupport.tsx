/**
 * StartupSupport — 스타트업 지원사업 큐레이션 페이지.
 *
 * Phase 9.6:
 *   - sort (latest / deadline / recommend / title) + URL 동기화
 *   - pagination (page/size, 10/20/50) + URL 동기화
 *   - 상단 요약에 totalCount / source / lastUpdated 정돈 표시
 *   - 0건일 때 액션(필터 초기화 / 전체 보기) 제공
 *   - 카드 tooltip은 SupportCard 내부 처리
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  AlarmClock,
  Filter,
  ListFilter,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  TriangleAlert,
  X,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { SupportCard } from "../components/startup/SupportCard";
import { SupportFilterBar } from "../components/startup/SupportFilterBar";
import { Input } from "../components/ui/input";
import {
  fetchStartupSupportListResponse,
  type StartupSupportFilters,
  type StartupSupportListResponse,
} from "../utils/startupSupportApi";
import type { SupportCategory, SupportItem, SupportStatus } from "../utils/mockStartupSupport";

const VALID_CATEGORIES: ReadonlyArray<SupportCategory> = [
  "사업화",
  "정책자금",
  "R&D",
  "멘토링",
  "창업교육",
  "법률·세무·노무",
  "투자/IR",
];
const VALID_STATUSES: ReadonlyArray<SupportStatus> = ["모집중", "마감임박", "상시모집", "모집마감", "확인 필요"];

type SortKey = "recommend" | "activeFirst" | "deadline" | "latest" | "recentClosed";
const VALID_SORTS: ReadonlyArray<SortKey> = ["recommend", "activeFirst", "deadline", "latest", "recentClosed"];
const SORT_LABEL: Record<SortKey, string> = {
  recommend: "추천순",
  activeFirst: "모집중 우선",
  deadline: "마감 임박순",
  latest: "최신 등록순",
  recentClosed: "최근 마감순",
};
const DEFAULT_SORT: SortKey = "activeFirst";
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_SIZE = 20;
const KEYWORD_DEBOUNCE_MS = 300;

function readCategoryParam(raw: string | null): SupportCategory | "전체" {
  if (!raw) return "전체";
  return (VALID_CATEGORIES as ReadonlyArray<string>).includes(raw) ? (raw as SupportCategory) : "전체";
}
function readStatusParam(raw: string | null): SupportStatus | "전체" {
  if (!raw) return "전체";
  return (VALID_STATUSES as ReadonlyArray<string>).includes(raw) ? (raw as SupportStatus) : "전체";
}
function readSortParam(raw: string | null): SortKey {
  if (!raw) return DEFAULT_SORT;
  return (VALID_SORTS as ReadonlyArray<string>).includes(raw) ? (raw as SortKey) : DEFAULT_SORT;
}
function readIntParam(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const ALL_CATEGORY: SupportCategory | "전체" = "전체";
const ALL_REGION = "전체";
const ALL_STATUS: SupportStatus | "전체" = "전체";

function toBackendFilters(
  category: SupportCategory | "전체",
  region: string,
  status: SupportStatus | "전체",
  keyword: string,
  sort: SortKey,
  page: number,
  size: number,
): StartupSupportFilters {
  const filters: StartupSupportFilters = {};
  if (category !== "전체") filters.category = category;
  if (region !== "전체") filters.region = region;
  if (status !== "전체") filters.status = status;
  const trimmed = keyword.trim();
  if (trimmed) filters.keyword = trimmed;
  filters.sort = sort;
  filters.page = page;
  filters.size = size;
  return filters;
}

export function StartupSupport() {
  const [searchParams, setSearchParams] = useSearchParams();

  const category = readCategoryParam(searchParams.get("category"));
  const region = searchParams.get("region") || ALL_REGION;
  const status = readStatusParam(searchParams.get("status"));
  const urlKeyword = searchParams.get("keyword") || "";
  const sort = readSortParam(searchParams.get("sort"));
  const page = readIntParam(searchParams.get("page"), 1);
  const size = readIntParam(searchParams.get("size"), DEFAULT_SIZE);

  const [keywordInput, setKeywordInput] = useState<string>(() => urlKeyword);

  const [items, setItems] = useState<SupportItem[]>([]);
  const [envelope, setEnvelope] = useState<StartupSupportListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

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

  // 필터 변경 시 page=1 로 리셋 (정렬/사이즈 변경도 동일)
  const updateFilterAndResetPage = useCallback(
    (updates: Record<string, string | null>) => {
      updateSearchParams({ ...updates, page: null });
    },
    [updateSearchParams],
  );

  const handleCategoryChange = useCallback(
    (c: SupportCategory | "전체") =>
      updateFilterAndResetPage({ category: c === ALL_CATEGORY ? null : c }),
    [updateFilterAndResetPage],
  );
  const handleRegionChange = useCallback(
    (r: string) => updateFilterAndResetPage({ region: r === ALL_REGION ? null : r }),
    [updateFilterAndResetPage],
  );
  const handleStatusChange = useCallback(
    (s: SupportStatus | "전체") =>
      updateFilterAndResetPage({ status: s === ALL_STATUS ? null : s }),
    [updateFilterAndResetPage],
  );
  const handleSortChange = useCallback(
    (s: SortKey) => updateFilterAndResetPage({ sort: s === DEFAULT_SORT ? null : s }),
    [updateFilterAndResetPage],
  );
  const handleSizeChange = useCallback(
    (n: number) => updateFilterAndResetPage({ size: n === DEFAULT_SIZE ? null : String(n) }),
    [updateFilterAndResetPage],
  );
  const listAnchorRef = useRef<HTMLDivElement>(null);
  const goToPage = useCallback(
    (next: number) => {
      updateSearchParams({ page: next <= 1 ? null : String(next) });
      // 페이지 변경 시 리스트 상단으로 부드럽게 스크롤
      window.requestAnimationFrame(() => {
        listAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [updateSearchParams],
  );

  useEffect(() => {
    setKeywordInput((prev) => (prev === urlKeyword ? prev : urlKeyword));
  }, [urlKeyword]);

  useEffect(() => {
    const trimmed = keywordInput.trim();
    if (trimmed === urlKeyword) return;
    const t = window.setTimeout(() => {
      updateFilterAndResetPage({ keyword: trimmed || null });
    }, KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [keywordInput, urlKeyword, updateFilterAndResetPage]);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = toBackendFilters(category, region, status, urlKeyword, sort, page, size);

    fetchStartupSupportListResponse(filters, ctrl.signal)
      .then((env) => {
        if (cancelled) return;
        setItems(env.items);
        setEnvelope(env);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        if (err instanceof Error && /aborted/i.test(err.message)) return;
        console.error("[startup-support] fetch 실패", err);
        setError("지원사업 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [category, region, status, urlKeyword, sort, page, size, reloadKey]);

  const handleRetry = useCallback(() => setReloadKey((k) => k + 1), []);

  const urgentItems = useMemo(
    () => items.filter((i) => i.status === "마감임박"),
    [items],
  );
  const regularItems = useMemo(
    () => items.filter((i) => i.status !== "마감임박"),
    [items],
  );

  const totalCount = envelope?.totalCount ?? items.length;
  const totalPages = envelope?.totalPages ?? 1;
  const currentPage = envelope?.page ?? page;
  const sourceLabel = envelope?.source ?? "";
  const lastUpdated = envelope?.lastUpdated ?? "";
  const originTotal = envelope?.originTotal ?? 0;
  const loadedCount = envelope?.loadedCount ?? 0;

  // 항목별 source 분포 (Phase 9.8)
  const sourceBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const s = it.itemSource || "unknown";
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [items]);
  const SOURCE_LABEL: Record<string, string> = {
    "k-startup-news": "창업소식",
    "k-startup-service": "사업공고 조회서비스",
    "k-startup-mixed": "통합 매칭",
    "mock": "샘플",
  };

  const isFilterActive =
    category !== "전체" || region !== "전체" || status !== "전체" || keywordInput.trim() !== "";

  const resetFilters = useCallback(() => {
    setKeywordInput("");
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearKeyword = () => {
    setKeywordInput("");
    updateFilterAndResetPage({ keyword: null });
    searchInputRef.current?.focus();
  };

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

  const activeFilterChips = (
    <div className="flex flex-wrap gap-1.5">
      {category !== "전체" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#1E3A8A]/30 bg-[#1E3A8A]/5 px-2 py-0.5 text-[11px] text-[#1E3A8A]">
          카테고리: {category}
        </span>
      )}
      {status !== "전체" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
          상태: {status}
        </span>
      )}
      {region !== "전체" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">
          지역: {region}
        </span>
      )}
      {keywordInput.trim() && (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
          검색어: {keywordInput.trim()}
        </span>
      )}
    </div>
  );

  return (
    <MarketingLayout
      title="스타트업 지원사업 큐레이션"
      description="흩어진 창업지원사업을 한곳에서 비교하고, 내 상황에 맞는 제도를 빠르게 찾을 수 있습니다. 법률 검토(LexRex AI 토론) 결과와 함께 활용하면 의사결정이 더 빨라집니다."
    >
      {/* 데이터 출처 안내 (Phase 9.13 — 문구 간결화) */}
      {(originTotal > 0 || loadedCount > 0 || sourceBreakdown.length > 0) && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
          <p className="text-[12px] leading-relaxed text-slate-600">
            공공데이터 원본 <strong className="text-slate-800">{(originTotal || 0).toLocaleString("ko-KR")}건</strong>
            {" "}중 최근 <strong className="text-slate-800">{(loadedCount || 0).toLocaleString("ko-KR")}건</strong>을 큐레이션하고 있습니다.
            {sourceBreakdown.length > 0 && (
              <>
                {" "}현재 페이지에는{" "}
                {sourceBreakdown.map(([src, n], i) => (
                  <span key={src}>
                    {i > 0 && " · "}
                    <strong className="text-slate-800">{SOURCE_LABEL[src] ?? src}</strong>{" "}
                    {n}건
                  </span>
                ))}
                {"이 표시됩니다."}
              </>
            )}
          </p>
          <p className="mt-0.5 text-[10.5px] text-slate-400">
            일부 공공데이터는 자동 보강 중입니다.
          </p>
        </div>
      )}

      {/* 상단 요약 통계 */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ListFilter className="h-3.5 w-3.5" /> 큐레이션 건수
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {totalCount.toLocaleString("ko-KR")}건{" "}
            <span className="text-xs font-normal text-slate-400">(필터 적용 결과)</span>
          </div>
        </div>
        <div className="rounded-lg border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[#1E3A8A]">
            <Filter className="h-3.5 w-3.5" /> 현재 페이지
          </div>
          <div className="mt-1 text-lg font-semibold text-[#1E3A8A]">
            {currentPage} / {totalPages} 페이지 · {items.length}건 표시
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-rose-600">
            <AlarmClock className="h-3.5 w-3.5" /> 마감 임박 (현재 페이지)
          </div>
          <div className="mt-1 text-lg font-semibold text-rose-700">{urgentItems.length}건</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Sparkles className="h-3.5 w-3.5" /> 데이터 출처
          </div>
          <div className="mt-1 truncate text-sm font-medium text-slate-700" title={sourceLabel}>
            {sourceLabel || "—"}
          </div>
          {lastUpdated && (
            <div className="mt-0.5 text-[10px] text-slate-400">
              {new Date(lastUpdated).toLocaleString("ko-KR")}
            </div>
          )}
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

      {/* 필터 바 */}
      <div className="mb-4">
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

      {/* 정렬 + 페이지 크기 — Phase 9.13 시각 밀도 약간 낮춤 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <ArrowUpDown className="h-3.5 w-3.5" />
          정렬
        </div>
        <div className="flex flex-wrap gap-1">
          {VALID_SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSortChange(s)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                sort === s
                  ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                  : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-[#1E3A8A]"
              }`}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
          <span>페이지당</span>
          <select
            value={size}
            onChange={(e) => handleSizeChange(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:border-[#1E3A8A] focus:outline-none"
            aria-label="페이지당 표시 건수"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}개
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 정렬 안내 */}
      {sort === DEFAULT_SORT && originTotal > 0 && (
        <p className="mb-5 text-[11px] text-slate-400">
          ℹ 기본 정렬: 신청 가능한 항목(모집중 → 마감 임박 → 상시모집) 을 위에, 모집 마감 항목을 아래에 배치합니다.
        </p>
      )}
      {sort === "latest" && originTotal > 0 && (
        <p className="mb-5 text-[11px] text-slate-400">
          ℹ 최신 등록순 — 공공데이터 원본의 등록일자 내림차순. 일부 과거 데이터가 포함될 수 있습니다.
        </p>
      )}
      {sort === "recentClosed" && originTotal > 0 && (
        <p className="mb-5 text-[11px] text-slate-400">
          ℹ 최근 마감순 — 모집 마감 항목을 최근에 마감된 순서로 보여줍니다.
        </p>
      )}
      {status === "상시모집" && items.length === 0 && (
        <p className="mb-5 text-[11px] text-slate-400">
          ℹ 상시모집은 원본 공고에 상시모집 여부가 명확히 표시된 경우에만 분류됩니다 — 현재 데이터에는 해당 항목이 없습니다.
        </p>
      )}

      {loading && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E3A8A]" />
          <span>지원사업 정보를 불러오는 중입니다...</span>
        </div>
      )}

      {/* 카드 목록 anchor (페이지 변경 시 스크롤 타겟) */}
      <div ref={listAnchorRef} className="scroll-mt-24" />

      {urgentItems.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <AlarmClock className="h-4 w-4 text-rose-600" />
            <h2 className="text-sm font-semibold text-rose-700">마감 임박 — 우선 확인</h2>
            <span className="text-xs text-slate-500">({urgentItems.length}건)</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {urgentItems.map((item) => (
              <SupportCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* 빈 상태 — 액션 제공 */}
      {!loading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <Sparkles className="mx-auto mb-3 h-6 w-6 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">조건에 맞는 지원사업이 없습니다</p>
          {isFilterActive ? (
            <>
              <p className="mt-1 text-xs text-slate-500">아래 필터가 적용되어 있습니다:</p>
              <div className="mt-2 flex justify-center">{activeFilterChips}</div>
              <p className="mt-3 text-xs text-slate-500">
                필터를 조금 넓혀보세요 — 카테고리/지역/상태를 "전체"로 바꾸거나 검색어를 짧게 줄여 보세요.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 rounded-md border border-[#1E3A8A]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#1E3A8A] hover:bg-[#1E3A8A]/5"
                >
                  필터 초기화
                </button>
                <button
                  type="button"
                  onClick={() => updateFilterAndResetPage({ category: null, status: null, region: null })}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  카테고리·상태·지역 해제
                </button>
                {keywordInput.trim() && (
                  <button
                    type="button"
                    onClick={clearKeyword}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    검색어 지우기
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              잠시 후 다시 시도하거나 외부 API 상태를 확인해 주세요.
            </p>
          )}
        </div>
      ) : regularItems.length > 0 ? (
        <section>
          {urgentItems.length > 0 && (
            <h2 className="mb-3 text-sm font-semibold text-slate-700">전체 결과</h2>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {regularItems.map((item) => (
              <SupportCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 페이지네이션 — 처음/이전/현재·전체/다음/마지막 (Phase 9.7) */}
      {totalPages > 1 && (
        <nav
          className="mt-10 flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
          aria-label="페이지 이동"
        >
          <button
            type="button"
            onClick={() => goToPage(1)}
            disabled={currentPage <= 1}
            aria-label="처음 페이지"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-[#1E3A8A]/30 hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
            처음
          </button>
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="이전 페이지"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-[#1E3A8A]/30 hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>
          <span className="mx-2 inline-flex items-center rounded-md bg-[#1E3A8A]/5 px-2.5 py-1.5 text-xs font-medium text-[#1E3A8A]">
            {currentPage} / {totalPages} 페이지
          </span>
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="다음 페이지"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-[#1E3A8A]/30 hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => goToPage(totalPages)}
            disabled={currentPage >= totalPages}
            aria-label="마지막 페이지"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-[#1E3A8A]/30 hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-40"
          >
            마지막
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </nav>
      )}

      {/* 안내 */}
      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">⚠ 본 페이지 안내</p>
        <p className="mt-1">
          본 큐레이션은 K-Startup · 중소벤처기업부 등 공공데이터 OpenAPI 와 mock 데이터를 결합한 결과입니다.
          실제 신청 자격·금액·마감일은 각 기관 공식 페이지에서 반드시 확인해 주세요.
          카드의 추천도/요약은 공고 키워드 기반 사전 분석이며, 실제 법률 진단은 "법률 리스크 진단" 단계에서 멀티 에이전트 토론으로 진행됩니다.
        </p>
      </div>
    </MarketingLayout>
  );
}
