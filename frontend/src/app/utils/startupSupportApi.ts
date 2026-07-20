/**
 * startupSupportApi.ts — Phase 2 backend mock API client.
 *
 * Phase 1 (mock-only frontend import) → Phase 2 (fetch backend) 전환.
 * 응답 타입은 `mockStartupSupport.ts` 의 SupportItem 과 동일.
 * 추후 백엔드가 K-Startup OpenAPI 로 전환되어도 본 client 는 변경 불필요.
 */
import type { SupportItem } from "./mockStartupSupport";

// 동일 host 의 backend (Vite dev / 빌드 후 reverse proxy 가능)
// 다른 컴포넌트 (Result.tsx 등) 도 동일하게 절대경로 사용 — 일관성 유지.
const API_BASE = "http://localhost:8080/api";

/**
 * backend 필터 쿼리 파라미터 (Phase 3.5 — controller 에 추가됨, frontend 는 선택 사용).
 *
 * 현재 frontend StartupSupport.tsx 는 in-memory 필터를 사용하므로 본 인터페이스 미사용.
 * 추후 backend 필터로 전환 시 `fetchStartupSupportList({ category: ... })` 형태로 호출.
 */
export interface StartupSupportFilters {
  /** 카테고리 정확 일치 (예: "R&D", "법률·세무·노무") */
  category?: string;
  /** 모집 상태 정확 일치 (예: "마감임박", "모집중", "상시모집") */
  status?: string;
  /** 지역 정확 일치 또는 "전국" 자동 통과 */
  region?: string;
  /** 키워드 — title/organization/target/fieldSummary/recommendReason contains */
  keyword?: string;
  /** 정렬 옵션 (Phase 9.9 — activeFirst/recentClosed 추가, title 제거) */
  sort?: "recommend" | "activeFirst" | "deadline" | "latest" | "recentClosed";
  /** 페이지 (1-base, default 1) */
  page?: number;
  /** 페이지 크기 (default 20, max 100) */
  size?: number;
}

/**
 * 적용된 필터 echo (backend 가 응답에 반영).
 * 입력 안 한 필드는 null.
 */
export interface AppliedFilters {
  category: string | null;
  status: string | null;
  region: string | null;
  keyword: string | null;
}

/**
 * Phase 5 응답 envelope.
 * Backend `StartupSupportListResponse` record 직렬화 결과와 1:1 매칭.
 */
export interface StartupSupportListResponse {
  items: SupportItem[];
  source: string;         // "mock" / "k-startup" / "k-startup-news" / "k-startup-mixed" 등
  count: number;          // items.length 와 동일 (편의 메타) — 현재 페이지 건수
  lastUpdated: string;    // ISO-8601 Instant
  filters: AppliedFilters;
  /** 필터 적용 후 전체 건수 (Phase 9.6) */
  totalCount: number;
  /** 현재 페이지 (1-base) */
  page: number;
  /** 페이지 크기 */
  size: number;
  /** 전체 페이지 수 */
  totalPages: number;
  /** 적용된 정렬 옵션 */
  sort: string;
  /** upstream(공공데이터) 원본 총 건수 (알 수 없으면 0) (Phase 9.7) */
  originTotal?: number;
  /** backend 메모리에 로드한 건수 (필터 전, originTotal 의 일부) (Phase 9.7) */
  loadedCount?: number;
}

export interface SavedSupportProgram {
  id: number;
  programId: string;
  title: string;
  organization?: string | null;
  category?: string | null;
  region?: string | null;
  fieldSummary?: string | null;
  status?: string | null;
  deadline?: string | null;
  applyUrl?: string | null;
  savedAt: string;
  deadlineLabel: string;
  daysLeft: number | null;
  deadlineStatus: string;
}

function userHeaders(): HeadersInit {
  try {
    const user = JSON.parse(localStorage.getItem("legalreview_currentUser") || "{}");
    return user?.id ? { "X-User-Id": String(user.id) } : {};
  } catch {
    return {};
  }
}

function buildQueryString(filters?: StartupSupportFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.category && filters.category.trim()) params.set("category", filters.category.trim());
  if (filters.status && filters.status.trim()) params.set("status", filters.status.trim());
  if (filters.region && filters.region.trim()) params.set("region", filters.region.trim());
  if (filters.keyword && filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.size && filters.size !== 20) params.set("size", String(filters.size));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * 전체 지원사업 envelope 응답 (Phase 5 신규).
 * items + source + lastUpdated + filters echo 메타 포함.
 */
export async function fetchStartupSupportListResponse(
  filters?: StartupSupportFilters,
  signal?: AbortSignal,
): Promise<StartupSupportListResponse> {
  const qs = buildQueryString(filters);
  const res = await fetch(`${API_BASE}/startup-support${qs}`, { signal });
  if (!res.ok) {
    throw new Error(`startup-support list HTTP ${res.status}`);
  }
  return (await res.json()) as StartupSupportListResponse;
}

/**
 * 전체 지원사업 목록 (items 만 반환 — backward compatible).
 *
 * Phase 5 부터 backend 가 envelope 응답을 보내지만, 본 함수는 `.items` 만 추출해서
 * Phase 2~4 호출 코드 (`fetchStartupSupportList(signal)` / `(filters, signal)`) 가 그대로 동작.
 *
 * 시그니처 호환:
 *   - `fetchStartupSupportList(signal)` — Phase 2 형태
 *   - `fetchStartupSupportList(filters, signal)` — Phase 3.5 형태
 *
 * 메타 (source/lastUpdated/filters) 가 필요하면 `fetchStartupSupportListResponse` 직접 호출 권장.
 */
export async function fetchStartupSupportList(
  filtersOrSignal?: StartupSupportFilters | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<SupportItem[]> {
  let filters: StartupSupportFilters | undefined;
  let signal: AbortSignal | undefined;
  if (filtersOrSignal instanceof AbortSignal) {
    signal = filtersOrSignal;
  } else {
    filters = filtersOrSignal;
    signal = maybeSignal;
  }
  const envelope = await fetchStartupSupportListResponse(filters, signal);
  return envelope.items;
}

/** 단건 조회 (선택). 404 시 null 반환. */
export async function fetchStartupSupportItem(
  id: string,
  signal?: AbortSignal,
): Promise<SupportItem | null> {
  const res = await fetch(`${API_BASE}/startup-support/${encodeURIComponent(id)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`startup-support ${id} HTTP ${res.status}`);
  }
  return (await res.json()) as SupportItem;
}

export async function fetchSavedSupportPrograms(sort: "saved" | "deadline" = "saved"): Promise<SavedSupportProgram[]> {
  const qs = sort === "deadline" ? "?sort=deadline" : "";
  const res = await fetch(`${API_BASE}/startup-support/saved${qs}`, { headers: userHeaders() });
  if (!res.ok) {
    throw new Error(`saved startup-support HTTP ${res.status}`);
  }
  return (await res.json()) as SavedSupportProgram[];
}

export async function fetchSavedSupportStatus(): Promise<Record<string, boolean>> {
  const res = await fetch(`${API_BASE}/startup-support/saved/status`, { headers: userHeaders() });
  if (!res.ok) {
    throw new Error(`saved startup-support status HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, boolean>;
}

export async function saveStartupSupportProgram(programId: string): Promise<SavedSupportProgram> {
  const res = await fetch(`${API_BASE}/startup-support/${encodeURIComponent(programId)}/saved`, {
    method: "POST",
    headers: userHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "관심 공고 저장에 실패했습니다.");
  }
  return (await res.json()) as SavedSupportProgram;
}

export async function deleteSavedStartupSupportProgram(programId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/startup-support/${encodeURIComponent(programId)}/saved`, {
    method: "DELETE",
    headers: userHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "관심 공고 제거에 실패했습니다.");
  }
}
