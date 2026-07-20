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
  const arr: unknown[] = (() => {
    if (Array.isArray(source)) return source;
    if (typeof source === "object") {
      const obj = source as Record<string, unknown>;
      if (Array.isArray(obj.evidences)) return obj.evidences as unknown[];
      const fd = obj.finalDecision as Record<string, unknown> | undefined;
      if (fd && Array.isArray(fd.evidences)) return fd.evidences as unknown[];
    }
    return [];
  })();
  return arr.filter(isEvidenceLike).map(sanitizeEvidence) as EvidenceItem[];
}

/**
 * Phase 10.85 — 백엔드/stale 응답에 남아있는 "벡터 유사도 0.NN" 같은 내부 수치를
 * 사용자 친화 라벨("관련도 높음/보통/참고")로 치환. DB에 이미 영속화된 과거 세션
 * 응답도 안전하게 표시되도록 클라이언트 측 방어막.
 */
function sanitizeEvidence(x: unknown): EvidenceItem {
  const o = { ...(x as Record<string, unknown>) } as unknown as EvidenceItem & { relevanceReason?: string };
  const r = o.relevanceReason;
  if (typeof r === "string") {
    let next = r;
    const m = /벡터\s*유사도\s*([0-9]\.[0-9]{1,2})/.exec(r);
    if (m) {
      const sim = parseFloat(m[1]);
      const label = sim >= 0.75 ? "관련도 높음" : sim >= 0.55 ? "관련도 보통" : "관련도 참고";
      next = next.replace(m[0], label);
    }
    next = next
      .replace(/벡터\s*유사도\s*[0-9.]+/g, "관련도 참고")
      .replace(/similarity\s*[:=]?\s*[0-9.]+/gi, "관련도 참고")
      .replace(/distance\s*[:=]?\s*[0-9.]+/gi, "관련도 참고")
      .replace(/score\s*[:=]?\s*[0-9.]+/gi, "관련도 참고");
    o.relevanceReason = next;
  }
  return o as EvidenceItem;
}

function isEvidenceLike(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  // 최소 조건: title이 있어야 evidence로 인정
  // (score / metadata 등 부가 키는 자동 통과 — Jackson NON_NULL 직렬화로 누락 가능하나 객체 자체는 통과)
  return typeof o.title === "string" && o.title.length > 0;
}
