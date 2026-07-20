/**
 * Phase 10.23 — 세션 SSE 스트림 클라이언트.
 *
 * 사용 예:
 *   const ctrl = connectSessionStream(sessionId, {
 *     onMessage: (msg) => ...,
 *     onStatus: (s) => ...,
 *     onCompleted: () => ...,
 *     onError: (e) => ...,
 *     onSnapshot: (snap) => ...,
 *     onOpen: () => ...,
 *     onClose: () => ...,
 *   });
 *   // 정리 시
 *   ctrl.close();
 *
 * 정책:
 *  - EventSource 가 자동 재연결을 시도하지만, 5회 이상 onerror 발생 시 close + onFatal 호출.
 *  - SSE 미지원 환경 (typeof EventSource === "undefined") 은 connect 가 null 을 반환 → 호출 측이 polling fallback 사용.
 */

export interface StreamDebateMessage {
  id?: number | null;
  agentId?: string;
  agentName?: string;
  content?: string;
  type?: string;
  round?: number;
  stance?: string;
  evidenceSummary?: string;
}

export type SessionStreamEvent =
  | {
      type: "snapshot";
      sessionId: number;
      status?: string;
      analysisPhase?: string | null;
      messageCount?: number;
      messages?: StreamDebateMessage[];
    }
  | { type: "status"; sessionId: number; status: string; progress?: number; label?: string }
  | { type: "message"; sessionId: number; message: StreamDebateMessage }
  | { type: "progress"; sessionId: number; progress: number; label?: string }
  | { type: "completed"; sessionId: number; status: "COMPLETED"; progress?: number; messageCount?: number }
  | { type: "error"; sessionId: number; message: string }
  | { type: "heartbeat"; sessionId: number; at?: number; phase?: string };

export interface StreamHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  onSnapshot?: (e: Extract<SessionStreamEvent, { type: "snapshot" }>) => void;
  onStatus?: (e: Extract<SessionStreamEvent, { type: "status" }>) => void;
  onMessage?: (e: Extract<SessionStreamEvent, { type: "message" }>) => void;
  onProgress?: (e: Extract<SessionStreamEvent, { type: "progress" }>) => void;
  onCompleted?: (e: Extract<SessionStreamEvent, { type: "completed" }>) => void;
  onError?: (e: Extract<SessionStreamEvent, { type: "error" }>) => void;
  onHeartbeat?: (e: Extract<SessionStreamEvent, { type: "heartbeat" }>) => void;
  /** EventSource 가 복구 불가 수준으로 끊겼을 때 — 호출 측이 polling fallback 으로 전환 */
  onFatal?: (reason: string) => void;
  /** Phase 10.24 — 1~MAX-1 회 onerror 발생 (자동 재연결 시도 중). UI 에 "error/복구중" 배지 표시용. */
  onTransientError?: (attempt: number) => void;
}

export interface StreamController {
  close: () => void;
  /** 현재 readyState — 0=CONNECTING, 1=OPEN, 2=CLOSED */
  readyState: () => number;
}

const MAX_ERROR_COUNT = 5;

/**
 * 세션 SSE 스트림에 연결한다. EventSource 미지원 환경에서는 null 반환.
 */
export function connectSessionStream(
  sessionId: number | string,
  handlers: StreamHandlers,
  baseUrl: string = "http://localhost:8080",
): StreamController | null {
  if (typeof EventSource === "undefined") {
    handlers.onFatal?.("EventSource 미지원 — polling fallback 사용");
    return null;
  }

  const url = `${baseUrl}/api/sessions/${sessionId}/stream`;
  const es = new EventSource(url);
  let errorCount = 0;
  let closed = false;

  const safeParse = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  es.onopen = () => {
    errorCount = 0;
    handlers.onOpen?.();
  };

  // 기본 onmessage — event name 이 없는 데이터 (대부분의 브라우저는 named event 와 분리)
  es.onmessage = (ev) => {
    const data = safeParse(ev.data);
    if (data && typeof data === "object") {
      handlers.onMessage?.(data as Extract<SessionStreamEvent, { type: "message" }>);
    }
  };

  es.addEventListener("snapshot", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onSnapshot?.(data as Extract<SessionStreamEvent, { type: "snapshot" }>);
  });
  es.addEventListener("status", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onStatus?.(data as Extract<SessionStreamEvent, { type: "status" }>);
  });
  es.addEventListener("message", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onMessage?.(data as Extract<SessionStreamEvent, { type: "message" }>);
  });
  es.addEventListener("progress", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onProgress?.(data as Extract<SessionStreamEvent, { type: "progress" }>);
  });
  es.addEventListener("completed", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onCompleted?.(data as Extract<SessionStreamEvent, { type: "completed" }>);
  });
  es.addEventListener("error", (ev) => {
    const data = safeParse((ev as MessageEvent).data ?? "{}");
    if (data && (data as { type?: string }).type === "error") {
      handlers.onError?.(data as Extract<SessionStreamEvent, { type: "error" }>);
    }
  });
  es.addEventListener("heartbeat", (ev) => {
    const data = safeParse((ev as MessageEvent).data);
    if (data) handlers.onHeartbeat?.(data as Extract<SessionStreamEvent, { type: "heartbeat" }>);
  });

  es.onerror = () => {
    errorCount += 1;
    if (errorCount >= MAX_ERROR_COUNT && !closed) {
      closed = true;
      es.close();
      handlers.onClose?.();
      handlers.onFatal?.(`SSE 연결이 ${MAX_ERROR_COUNT}회 실패 — polling fallback 으로 전환`);
    } else if (!closed) {
      // Phase 10.24 — 자동 재연결 진행 중. UI 가 "error/복구중" 배지로 안내.
      handlers.onTransientError?.(errorCount);
    }
  };

  return {
    close: () => {
      if (closed) return;
      closed = true;
      es.close();
      handlers.onClose?.();
    },
    readyState: () => es.readyState,
  };
}
