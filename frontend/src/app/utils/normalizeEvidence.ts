import type { EvidenceItem } from "../components/EvidenceCard";

/**
 * 다양한 형태의 응답 payload에서 evidences 배열을 일관되게 추출한다.
 *
 * 백엔드 응답 위치는 현재 다음 중 하나:
 *   1) payload.evidences            (현재 정식 — SessionService.getLatestDebateResult, ReviewService.getReviewDetail)
 *   2) payload.finalDecision.evidences  (보안용 — 백엔드 변경 가능성 대비)
 *   3) (그 외)                        (sessionStorage stale 등은 안전 무시)
 *
 * 또한 sessionStorage에서 읽어온 stale "[]"가 실제 fetch 결과를 덮어쓰지 않도록
 * 호출 측에서 "비어있지 않을 때만 hydrate" 패턴과 함께 사용한다.
 */
export function normalizeEvidences(source: unknown): EvidenceItem[] {
  if (!source) return [];

  // 직접 배열인 경우 (sessionStorage 값 등)
  if (Array.isArray(source)) {
    return source.filter(isEvidenceLike) as EvidenceItem[];
  }

  // payload 객체에서 후보 위치 순서대로 탐색
  if (typeof source === "object") {
    const obj = source as Record<string, unknown>;

    // 1순위: top-level evidences
    if (Array.isArray(obj.evidences)) {
      return (obj.evidences as unknown[]).filter(isEvidenceLike) as EvidenceItem[];
    }

    // 2순위: finalDecision.evidences (호환)
    const fd = obj.finalDecision as Record<string, unknown> | undefined;
    if (fd && Array.isArray(fd.evidences)) {
      return (fd.evidences as unknown[]).filter(isEvidenceLike) as EvidenceItem[];
    }
  }

  return [];
}

function isEvidenceLike(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  // 최소 조건: title이 있어야 evidence로 인정
  // (score / metadata 등 부가 키는 자동 통과 — Jackson NON_NULL 직렬화로 누락 가능하나 객체 자체는 통과)
  return typeof o.title === "string" && o.title.length > 0;
}
