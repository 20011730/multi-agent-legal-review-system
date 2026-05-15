import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MockReviewData, RecheckRequest } from "../utils/mockReviewData";
import { ensureMockDebateSession, pollMockDebateSession } from "../utils/mockDebateSession";

const API_BASE = "http://localhost:8080/api";
const POLL_INTERVAL = 3000;

export type BackendSessionStatus = "CREATED" | "ANALYZING" | "COMPLETED" | "FAILED";
export type AnalysisPhase =
  | "ROUND1_BIZ"
  | "ROUND1_LEGAL"
  | "WAITING_FOR_USER_R1"
  | "ROUND2_BIZ"
  | "ROUND2_LEGAL"
  | "WAITING_FOR_USER_R2"
  | "ROUND3_BIZ"
  | "ROUND3_LEGAL"
  | "JUDGING"
  | "COLLECTING_EVIDENCE";

export type DebateUiState = "LOADING" | "DEBATING" | "WAITING_FOR_USER" | "COMPLETED" | "FAILED";

/** 화면 전환용 4분법(로딩·토론은 동일 모드에서 픽셀+토론 블록으로 처리). */
export type DebateScreenMode = "ACTIVE_DEBATE" | "WAITING_FOR_USER" | "COMPLETED" | "FAILED";

export function deriveDebateScreenMode(uiState: DebateUiState): DebateScreenMode {
  if (uiState === "FAILED") return "FAILED";
  if (uiState === "COMPLETED") return "COMPLETED";
  if (uiState === "WAITING_FOR_USER") return "WAITING_FOR_USER";
  return "ACTIVE_DEBATE";
}

export interface DebateMessage {
  agentId: string;
  agentName?: string;
  content: string;
  type: string;
  round: number;
  stance?: string;
  evidenceSummary?: string;
}

export interface PhaseInfo {
  label: string;
  description: string;
  progress: number;
}

interface SessionStatusPayload {
  status?: BackendSessionStatus;
  messageCount?: number;
  analysisPhase?: AnalysisPhase | null;
}

interface DebateLatestPayload {
  status?: BackendSessionStatus;
  messages?: DebateMessage[];
  finalDecision?: unknown;
  evidences?: unknown[];
}

const phaseMap: Record<AnalysisPhase, PhaseInfo> = {
  ROUND1_BIZ: {
    label: "라운드 1 — 비즈니스 전략관",
    description: "실무·창 관점에서 사업적 가치와 실행 가능성을 블록 단위로 정리합니다.",
    progress: 15,
  },
  ROUND1_LEGAL: {
    label: "라운드 1 — 법무 담당관",
    description: "법률·방패 관점에서 규제 리스크와 위반 가능성을 검토합니다.",
    progress: 30,
  },
  WAITING_FOR_USER_R1: {
    label: "사용자 입력 대기 (Round 1 종료)",
    description: "팩트 정정 또는 제약 조건을 입력하거나 패스하세요.",
    progress: 35,
  },
  ROUND2_BIZ: {
    label: "라운드 2 — 비즈니스 전략관",
    description: "사용자 개입을 반영해 반박·완화 논리를 정리합니다.",
    progress: 50,
  },
  ROUND2_LEGAL: {
    label: "라운드 2 — 법무 담당관",
    description: "사용자 조건과 반박을 근거 중심으로 재검토합니다.",
    progress: 62,
  },
  WAITING_FOR_USER_R2: {
    label: "사용자 입력 대기 (Round 2 종료)",
    description: "추가 의견을 제출하거나 패스하면 최종 라운드로 진행됩니다.",
    progress: 68,
  },
  ROUND3_BIZ: {
    label: "라운드 3 — 비즈니스 전략관",
    description: "최종 실행 우선순위와 현실적 완화안을 제시합니다.",
    progress: 78,
  },
  ROUND3_LEGAL: {
    label: "라운드 3 — 법무 담당관",
    description: "법적 안정성을 확보하는 최종 권고안을 정리합니다.",
    progress: 86,
  },
  JUDGING: {
    label: "수석 조율관 — 최종 판정",
    description: "5인 체제 토론을 종합해 판정문을 확정합니다.",
    progress: 92,
  },
  COLLECTING_EVIDENCE: {
    label: "데이터 분석관 — 근거 수집",
    description: "판례·팩트·공공 법령 데이터를 매칭해 근거를 보강합니다.",
    progress: 96,
  },
};

const defaultPhase: PhaseInfo = {
  label: "AI 에이전트 분석 준비 중",
  description: "잠시만 기다려주세요...",
  progress: 5,
};

function getUiState(status: BackendSessionStatus, phase: AnalysisPhase | null): DebateUiState {
  if (status === "FAILED") return "FAILED";
  if (status === "COMPLETED") return "COMPLETED";
  if (phase === "WAITING_FOR_USER_R1" || phase === "WAITING_FOR_USER_R2") return "WAITING_FOR_USER";
  if (status === "ANALYZING") return "DEBATING";
  return "LOADING";
}

function mapMessages(messages: DebateLatestPayload["messages"]): DebateMessage[] {
  return (messages ?? []).map((m) => ({
    agentId: m.agentId || "legal",
    agentName: m.agentName || "",
    content: m.content || "",
    type: m.type || "analysis",
    round: m.round || 1,
    stance: m.stance || "",
    evidenceSummary: m.evidenceSummary || "",
  }));
}

export function useDebatePolling(sessionId: string | null) {
  const [usingMockData, setUsingMockData] = useState(
    () => sessionStorage.getItem("usingMockData") === "true",
  );
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [status, setStatus] = useState<BackendSessionStatus>("ANALYZING");
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase | null>(null);
  const [uiState, setUiState] = useState<DebateUiState>("LOADING");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchedCountRef = useRef(0);
  const inFlightRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchLatest = useCallback(async (id: string, force = false) => {
    const res = await fetch(`${API_BASE}/sessions/${id}/debates/latest`);
    if (!res.ok) return null;
    const result = (await res.json()) as DebateLatestPayload;
    const mapped = mapMessages(result.messages);

    if (force || mapped.length > fetchedCountRef.current) {
      fetchedCountRef.current = mapped.length;
      setMessages(mapped);
    }

    if (result.finalDecision) {
      sessionStorage.setItem("finalDecision", JSON.stringify(result.finalDecision));
    }
    sessionStorage.setItem("evidences", JSON.stringify(result.evidences || []));
    return {
      messages: mapped,
      finalDecision: result.finalDecision,
      evidences: result.evidences || [],
    };
  }, []);

  const startMockSimulation = useCallback((id: string) => {
    const reviewDataRaw = sessionStorage.getItem("reviewData");
    if (!reviewDataRaw) return false;

    try {
      const reviewData = JSON.parse(reviewDataRaw) as MockReviewData;
      const recheckRaw = sessionStorage.getItem("recheckRequest");
      let recheckRequest: RecheckRequest | null = null;
      if (recheckRaw) {
        try {
          recheckRequest = JSON.parse(recheckRaw) as RecheckRequest;
        } catch {
          recheckRequest = null;
        }
      }

      ensureMockDebateSession(id, reviewData, recheckRequest);
      sessionStorage.setItem("usingMockData", "true");
      setUsingMockData(true);

      const snapshot = pollMockDebateSession(id);
      setStatus(snapshot.status);
      setAnalysisPhase(snapshot.analysisPhase);
      setUiState(getUiState(snapshot.status, snapshot.analysisPhase));
      setMessages(snapshot.messages);
      fetchedCountRef.current = snapshot.messageCount;
      setError("");
      return true;
    } catch {
      return false;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    if (!sessionId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (usingMockData) {
        const snapshot = pollMockDebateSession(sessionId);
        setStatus(snapshot.status);
        setAnalysisPhase(snapshot.analysisPhase);
        setUiState(getUiState(snapshot.status, snapshot.analysisPhase));
        setError("");

        if (snapshot.messageCount > fetchedCountRef.current || snapshot.status === "COMPLETED") {
          fetchedCountRef.current = snapshot.messageCount;
          setMessages(snapshot.messages);
        }

        if (snapshot.finalDecision) {
          sessionStorage.setItem("finalDecision", JSON.stringify(snapshot.finalDecision));
        }
        if (snapshot.evidences) {
          sessionStorage.setItem("evidences", JSON.stringify(snapshot.evidences));
        }

        if (snapshot.status === "COMPLETED" || snapshot.status === "FAILED") {
          cleanup();
        }
        return;
      }

      const res = await fetch(`${API_BASE}/sessions/${sessionId}/status`);
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          setError("세션 상태를 조회할 수 없습니다. 입력 화면에서 다시 시작해 주세요.");
          setStatus("FAILED");
          setUiState("FAILED");
          cleanup();
        }
        return;
      }

      const payload = (await res.json()) as SessionStatusPayload;
      const nextStatus: BackendSessionStatus = payload.status || "ANALYZING";
      const nextPhase = payload.analysisPhase || null;
      const nextUiState = getUiState(nextStatus, nextPhase);

      setStatus(nextStatus);
      setAnalysisPhase(nextPhase);
      setUiState(nextUiState);
      setError("");

      if ((payload.messageCount ?? 0) > fetchedCountRef.current) {
        await fetchLatest(sessionId);
      }

      if (nextStatus === "COMPLETED") {
        const latest = await fetchLatest(sessionId, true);
        const isBackendFallbackOnly =
          latest?.messages.length === 1 &&
          latest.messages[0]?.agentId === "system" &&
          latest.messages[0]?.type === "error";

        if (isBackendFallbackOnly && startMockSimulation(sessionId)) {
          return;
        }
        cleanup();
      } else if (nextStatus === "FAILED") {
        if (startMockSimulation(sessionId)) {
          return;
        }
        setError("분석에 실패했습니다. 다시 시도해주세요.");
        cleanup();
      }
    } catch {
      // 네트워크 오류는 다음 폴링에서 재시도
    } finally {
      inFlightRef.current = false;
    }
  }, [cleanup, fetchLatest, sessionId, startMockSimulation, usingMockData]);

  useEffect(() => {
    if (!sessionId) {
      setError("세션 정보를 찾을 수 없습니다.");
      setUiState("FAILED");
      setStatus("FAILED");
      return;
    }

    fetchedCountRef.current = 0;
    setMessages([]);
    setError("");
    setStatus("ANALYZING");
    setUiState("LOADING");
    setAnalysisPhase(null);
    setElapsedSeconds(0);

    if (usingMockData) {
      const reviewDataRaw = sessionStorage.getItem("reviewData");
      if (!reviewDataRaw) {
        setError("모의 세션 데이터를 찾을 수 없습니다.");
        setStatus("FAILED");
        setUiState("FAILED");
        return;
      }
      let reviewData: MockReviewData;
      try {
        reviewData = JSON.parse(reviewDataRaw) as MockReviewData;
      } catch {
        setError("모의 세션 데이터를 해석할 수 없습니다.");
        setStatus("FAILED");
        setUiState("FAILED");
        return;
      }
      const recheckRaw = sessionStorage.getItem("recheckRequest");
      let recheckRequest: RecheckRequest | null = null;
      if (recheckRaw) {
        try {
          recheckRequest = JSON.parse(recheckRaw) as RecheckRequest;
        } catch {
          recheckRequest = null;
        }
      }
      ensureMockDebateSession(sessionId, reviewData, recheckRequest);
    }

    void pollOnce();
    pollRef.current = setInterval(() => void pollOnce(), POLL_INTERVAL);

    return () => cleanup();
  }, [cleanup, pollOnce, sessionId, usingMockData]);

  useEffect(() => {
    const pausedForUser = uiState === "WAITING_FOR_USER";
    if (status !== "ANALYZING" || pausedForUser) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, uiState]);

  const phaseInfo = useMemo<PhaseInfo>(() => {
    if (uiState === "COMPLETED") {
      return { label: "분석 완료", description: "모든 에이전트의 검토가 완료되었습니다.", progress: 100 };
    }
    if (analysisPhase && phaseMap[analysisPhase]) {
      return phaseMap[analysisPhase];
    }
    return defaultPhase;
  }, [analysisPhase, uiState]);

  const screenMode = useMemo(() => deriveDebateScreenMode(uiState), [uiState]);

  const userInterventionRound = useMemo<1 | 2 | null>(() => {
    if (analysisPhase === "WAITING_FOR_USER_R1") return 1;
    if (analysisPhase === "WAITING_FOR_USER_R2") return 2;
    return null;
  }, [analysisPhase]);

  const refreshNow = useCallback(() => {
    void pollOnce();
  }, [pollOnce]);

  const isWaitingForUser =
    analysisPhase === "WAITING_FOR_USER_R1" || analysisPhase === "WAITING_FOR_USER_R2";

  return {
    sessionId,
    usingMockData,
    messages,
    status,
    analysisPhase,
    uiState,
    screenMode,
    userInterventionRound,
    phaseInfo,
    elapsedSeconds,
    error,
    isWaitingForUser,
    refreshNow,
  };
}
