import {
  buildMockDebatePayload,
  saveMockReviewDetail,
  type MockReviewData,
  type RecheckRequest,
} from "./mockReviewData";
import type { AnalysisPhase, BackendSessionStatus, DebateMessage } from "../hooks/useDebatePolling";

type MockMode =
  | "running_r1"
  | "waiting_r1"
  | "running_r2"
  | "waiting_r2"
  | "running_r3"
  | "completed";

interface MockFinalDecision {
  verdict: "approved" | "conditional" | "rejected";
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  risks: Array<{ category: string; level: "high" | "medium" | "low"; description: string }>;
  summary: string;
  recommendation: string;
  revisedContent: string;
}

interface MockEvidence {
  sourceType: "LAW" | "CASE";
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  relevanceReason?: string;
  url?: string;
}

interface MockSessionState {
  sessionId: string;
  reviewData: MockReviewData;
  mode: MockMode;
  transitionedAt: number;
  analysisPhase: AnalysisPhase | null;
  status: BackendSessionStatus;
  visibleMessageCount: number;
  feedbackRound1?: string;
  feedbackRound2?: string;
  finalDecision: MockFinalDecision;
  evidences: MockEvidence[];
  allMessages: DebateMessage[];
}

export interface MockSessionSnapshot {
  status: BackendSessionStatus;
  analysisPhase: AnalysisPhase | null;
  messageCount: number;
  messages: DebateMessage[];
  finalDecision: MockFinalDecision | null;
  evidences: MockEvidence[];
}

interface FeedbackInput {
  content: string;
  isPass: boolean;
}

const MOCK_SESSION_PREFIX = "mock_debate_session_";

const R1_TIMELINE = [
  { atMs: 0, phase: "ROUND1_BIZ" as AnalysisPhase, count: 0 },
  { atMs: 1200, phase: "ROUND1_LEGAL" as AnalysisPhase, count: 1 },
  { atMs: 2600, phase: "WAITING_FOR_USER_R1" as AnalysisPhase, count: 2, nextMode: "waiting_r1" as MockMode },
];

const R2_TIMELINE = [
  { atMs: 0, phase: "ROUND2_BIZ" as AnalysisPhase, count: 2 },
  { atMs: 1100, phase: "ROUND2_LEGAL" as AnalysisPhase, count: 3 },
  { atMs: 2400, phase: "WAITING_FOR_USER_R2" as AnalysisPhase, count: 4, nextMode: "waiting_r2" as MockMode },
];

const R3_TIMELINE = [
  { atMs: 0, phase: "ROUND3_BIZ" as AnalysisPhase, count: 4 },
  { atMs: 1000, phase: "ROUND3_LEGAL" as AnalysisPhase, count: 5 },
  { atMs: 1900, phase: "JUDGING" as AnalysisPhase, count: 6 },
  { atMs: 2900, phase: "COLLECTING_EVIDENCE" as AnalysisPhase, count: 7 },
  { atMs: 3900, phase: null, count: 7, nextMode: "completed" as MockMode },
];

function key(sessionId: string) {
  return `${MOCK_SESSION_PREFIX}${sessionId}`;
}

function readState(sessionId: string): MockSessionState | null {
  const raw = localStorage.getItem(key(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MockSessionState;
  } catch {
    return null;
  }
}

function writeState(state: MockSessionState) {
  localStorage.setItem(key(state.sessionId), JSON.stringify(state));
}

function buildMessages(
  reviewData: MockReviewData,
  feedbackRound1?: string,
  feedbackRound2?: string,
): DebateMessage[] {
  const payload = buildMockDebatePayload(reviewData, null);
  const base = payload.messages;
  const fb1 = feedbackRound1?.trim();
  const fb2 = feedbackRound2?.trim();
  const fb1Label = fb1 ? `사용자 피드백 반영: ${fb1}` : "사용자 패스 반영: 추가 제약 없이 Round 2를 진행합니다.";
  const fb2Label = fb2 ? `사용자 추가조건 반영: ${fb2}` : "사용자 패스 반영: 최종 라운드로 바로 진행합니다.";

  const judgeContent =
    `## 종합 판정\n${payload.finalDecision.summary}\n\n` +
    `## 권고사항\n${payload.finalDecision.recommendation}\n\n` +
    `## 수정 문안 제안\n${payload.finalDecision.revisedContent}`;

  return [
    {
      agentId: "risk",
      agentName: "비즈니스 전략가",
      content: base[1]?.content ?? "비즈니스 관점에서 핵심 가정을 검토했습니다.",
      type: "analysis",
      round: 1,
      stance: "PRO",
      evidenceSummary: "사업 성장 및 실행 관점 분석",
    },
    {
      agentId: "legal",
      agentName: "법률 전문가",
      content: base[0]?.content ?? "법적 리스크를 중심으로 핵심 쟁점을 점검했습니다.",
      type: "analysis",
      round: 1,
      stance: "CON",
      evidenceSummary: "법적 리스크 및 규정 위반 가능성 분석",
    },
    {
      agentId: "risk",
      agentName: "비즈니스 전략가",
      content: `${fb1Label}\n\n실행 가능한 완화안 중심으로 반박안을 구성했습니다.`,
      type: "rebuttal",
      round: 2,
      stance: "PRO",
      evidenceSummary: "사용자 제약 반영 실행 전략",
    },
    {
      agentId: "legal",
      agentName: "법률 전문가",
      content: "사용자 조건을 반영해도 남는 법적 리스크와 최소 대응선을 재정리했습니다.",
      type: "rebuttal",
      round: 2,
      stance: "CON",
      evidenceSummary: "조건부 허용/금지 경계 재정의",
    },
    {
      agentId: "risk",
      agentName: "비즈니스 전략가",
      content: `${fb2Label}\n\n최종 라운드에서 비용·속도·전환율 균형안을 제안합니다.`,
      type: "proposal",
      round: 3,
      stance: "PRO",
      evidenceSummary: "현실적 실행 우선안",
    },
    {
      agentId: "legal",
      agentName: "법률 전문가",
      content: "최종 라운드 권고: 핵심 문구의 단정 표현을 완화하고 조건 문구를 전면 배치합니다.",
      type: "proposal",
      round: 3,
      stance: "CON",
      evidenceSummary: "최종 법적 안정성 보강안",
    },
    {
      agentId: "judge",
      agentName: "최종 판정관",
      content: judgeContent,
      type: "recommendation",
      round: 3,
      stance: "NEUTRAL",
      evidenceSummary: "양측 주장 종합 판정",
    },
  ];
}

function rebuildMessages(state: MockSessionState) {
  state.allMessages = buildMessages(state.reviewData, state.feedbackRound1, state.feedbackRound2);
}

function applyTimeline(state: MockSessionState, timeline: typeof R1_TIMELINE | typeof R2_TIMELINE | typeof R3_TIMELINE) {
  const elapsed = Date.now() - state.transitionedAt;
  let active = timeline[0];

  for (const point of timeline) {
    if (elapsed >= point.atMs) {
      active = point;
    }
  }

  state.analysisPhase = active.phase;
  state.visibleMessageCount = active.count;

  if ("nextMode" in active && active.nextMode) {
    state.mode = active.nextMode;
    state.transitionedAt = Date.now();
    if (active.nextMode === "completed") {
      state.status = "COMPLETED";
      state.analysisPhase = null;
      state.visibleMessageCount = state.allMessages.length;
      sessionStorage.setItem("finalDecision", JSON.stringify(state.finalDecision));
      sessionStorage.setItem("evidences", JSON.stringify(state.evidences));
      saveMockReviewDetail({
        sessionId: Number(state.sessionId),
        companyName: state.reviewData.companyName || "테스트 기업",
        industry: state.reviewData.industry || "기타",
        reviewType: state.reviewData.reviewType || "contract",
        situation: state.reviewData.situation || "모의 진단",
        content: state.reviewData.content || "",
        participationMode: state.reviewData.participationMode || "single",
        status: "COMPLETED",
        createdAt: new Date().toISOString(),
        messages: state.allMessages.map((m) => ({
          agentId: (m.agentId === "judge" ? "ethics" : m.agentId) as "legal" | "risk" | "ethics",
          agentName: m.agentName || "",
          content: m.content,
          type: m.type,
          round: m.round,
          stance: m.stance || "NEUTRAL",
          evidenceSummary: m.evidenceSummary || "",
        })),
        finalDecision: state.finalDecision,
        evidences: state.evidences,
      });
    }
  }
}

export function ensureMockDebateSession(
  sessionId: string,
  reviewData: MockReviewData,
  recheckRequest?: RecheckRequest | null,
) {
  const existing = readState(sessionId);
  if (existing) return existing;

  const payload = buildMockDebatePayload(reviewData, recheckRequest ?? null);
  const state: MockSessionState = {
    sessionId,
    reviewData,
    mode: "running_r1",
    transitionedAt: Date.now(),
    analysisPhase: "ROUND1_BIZ",
    status: "ANALYZING",
    visibleMessageCount: 0,
    finalDecision: payload.finalDecision,
    evidences: payload.evidences,
    allMessages: buildMessages(reviewData),
  };
  writeState(state);
  return state;
}

export function pollMockDebateSession(sessionId: string): MockSessionSnapshot {
  const state = readState(sessionId);
  if (!state) {
    return {
      status: "FAILED",
      analysisPhase: null,
      messageCount: 0,
      messages: [],
      finalDecision: null,
      evidences: [],
    };
  }

  if (state.mode === "running_r1") {
    applyTimeline(state, R1_TIMELINE);
  } else if (state.mode === "running_r2") {
    applyTimeline(state, R2_TIMELINE);
  } else if (state.mode === "running_r3") {
    applyTimeline(state, R3_TIMELINE);
  } else if (state.mode === "waiting_r1") {
    state.analysisPhase = "WAITING_FOR_USER_R1";
    state.visibleMessageCount = 2;
  } else if (state.mode === "waiting_r2") {
    state.analysisPhase = "WAITING_FOR_USER_R2";
    state.visibleMessageCount = 4;
  } else if (state.mode === "completed") {
    state.status = "COMPLETED";
    state.analysisPhase = null;
    state.visibleMessageCount = state.allMessages.length;
  }

  writeState(state);

  return {
    status: state.status,
    analysisPhase: state.analysisPhase,
    messageCount: state.visibleMessageCount,
    messages: state.allMessages.slice(0, state.visibleMessageCount),
    finalDecision: state.status === "COMPLETED" ? state.finalDecision : null,
    evidences: state.status === "COMPLETED" ? state.evidences : [],
  };
}

export function submitMockDebateFeedback(sessionId: string, input: FeedbackInput) {
  const state = readState(sessionId);
  if (!state) {
    throw new Error("모의 세션을 찾을 수 없습니다.");
  }

  const text = input.content.trim();
  if (state.mode === "waiting_r1") {
    state.feedbackRound1 = input.isPass ? "" : text;
    rebuildMessages(state);
    state.mode = "running_r2";
    state.analysisPhase = "ROUND2_BIZ";
    state.transitionedAt = Date.now();
  } else if (state.mode === "waiting_r2") {
    state.feedbackRound2 = input.isPass ? "" : text;
    rebuildMessages(state);
    state.mode = "running_r3";
    state.analysisPhase = "ROUND3_BIZ";
    state.transitionedAt = Date.now();
  } else {
    throw new Error("현재는 피드백을 제출할 수 없는 상태입니다.");
  }

  writeState(state);
}
