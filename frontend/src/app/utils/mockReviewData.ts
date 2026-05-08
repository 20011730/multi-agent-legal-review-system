export interface MockReviewData {
  companyName: string;
  industry: string;
  reviewType: string;
  situation: string;
  content: string;
  participationMode?: string;
}

export interface RecheckRequest {
  target: string;
  question: string;
}

export interface MockMessage {
  agentId: "legal" | "risk" | "ethics";
  agentName: string;
  content: string;
  type: string;
  round: number;
  stance: string;
  evidenceSummary: string;
}

interface MockRiskItem {
  category: string;
  level: "high" | "medium" | "low";
  description: string;
}

interface MockFinalDecision {
  verdict: "approved" | "conditional" | "rejected";
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  risks: MockRiskItem[];
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

export interface MockReviewDetail {
  sessionId: number;
  companyName: string;
  industry: string;
  reviewType: string;
  situation: string;
  content: string;
  participationMode: string;
  status: string;
  createdAt: string;
  messages: MockMessage[];
  finalDecision: MockFinalDecision;
  evidences: MockEvidence[];
}

interface MockReviewSummary {
  sessionId: number;
  companyName: string;
  reviewType: string;
  situation: string;
  status: string;
  createdAt: string;
  verdict: string | null;
  riskLevel: string | null;
}

const MOCK_HISTORY_KEY = "mock_review_history";
const MOCK_DETAIL_PREFIX = "mock_review_detail_";

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const createMockSessionId = () => Date.now();

export const buildMockDebatePayload = (
  reviewData: MockReviewData,
  recheckRequest?: RecheckRequest | null,
): Pick<MockReviewDetail, "messages" | "finalDecision" | "evidences"> => {
  const topicLabel = reviewData.reviewType || "자문 요청";
  const concern = recheckRequest?.question?.trim() || "핵심 문구의 법적/사업적/윤리적 균형";

  const messages: MockMessage[] = [
    {
      agentId: "legal",
      agentName: "법무 에이전트",
      content: `요청 카테고리(${topicLabel}) 기준으로 표현상의 법적 쟁점을 분해했습니다. 과장 해석 가능성이 있는 문장에는 근거 문구를 추가하는 것이 안전합니다.`,
      type: "analysis",
      round: 1,
      stance: "보수",
      evidenceSummary: "표시광고 관련 조항, 계약 해석 원칙",
    },
    {
      agentId: "risk",
      agentName: "사업 에이전트",
      content: "현 문구는 전환율 관점에서 강점이 있으나, 사실관계 대비 확정적 표현이 많아 분쟁 비용이 커질 수 있습니다.",
      type: "analysis",
      round: 1,
      stance: "균형",
      evidenceSummary: "클레임 민원 패턴, 전환 퍼널 이탈 지표",
    },
    {
      agentId: "ethics",
      agentName: "윤리 에이전트",
      content: "소비자 의사결정에 필요한 제한/조건 정보가 후순위에 있어 오해 가능성이 있습니다. 정보 접근성을 높인 문구 재배치를 권고합니다.",
      type: "analysis",
      round: 1,
      stance: "신중",
      evidenceSummary: "소비자 보호 관점 가이드라인",
    },
    {
      agentId: "legal",
      agentName: "법무 에이전트",
      content: `추가 질의 반영: "${concern}" 항목을 재검토했습니다. 단정형 표현을 조건형으로 전환하면 법적 안정성이 개선됩니다.`,
      type: "recheck",
      round: 2,
      stance: "수정 권고",
      evidenceSummary: "표현 완화 전략 및 책임 한정 문구",
    },
    {
      agentId: "risk",
      agentName: "사업 에이전트",
      content: "강한 CTA는 유지하되, 성과 수치에는 근거 출처를 붙이면 신뢰와 성능을 모두 확보할 수 있습니다.",
      type: "proposal",
      round: 2,
      stance: "실행 지향",
      evidenceSummary: "성과 문구 A/B 테스트 관행",
    },
    {
      agentId: "ethics",
      agentName: "윤리 에이전트",
      content: "최종안은 이해가능성 기준을 충족해야 하므로, 핵심 제한사항을 본문에 명시하는 편이 바람직합니다.",
      type: "proposal",
      round: 2,
      stance: "명확성 중시",
      evidenceSummary: "이해가능성·투명성 원칙",
    },
  ];

  const finalDecision: MockFinalDecision = {
    verdict: "conditional",
    riskLevel: "MEDIUM",
    summary:
      "핵심 메시지는 유지 가능하지만, 법적 분쟁 예방을 위해 단정형 표현 완화와 근거 문구 보강이 필요합니다.",
    recommendation:
      "주장 문구에 조건/범위를 명시하고, 소비자가 핵심 제한사항을 즉시 인지할 수 있도록 배치하세요.",
    revisedContent:
      "본 서비스는 개별 상황에 따라 결과가 달라질 수 있으며, 세부 조건 충족 시에 한해 안내된 혜택이 적용됩니다.",
    risks: [
      {
        category: "Legal",
        level: "medium",
        description: "확정적 표현으로 해석될 여지가 있어 분쟁 발생 시 입증 부담이 증가할 수 있습니다.",
      },
      {
        category: "Business",
        level: "low",
        description: "문구 완화 후 전환율이 일시적으로 하락할 수 있어 메시지 톤 조정이 필요합니다.",
      },
      {
        category: "Ethics",
        level: "medium",
        description: "제한조건 가시성이 낮아 정보 비대칭 이슈가 발생할 수 있습니다.",
      },
    ],
  };

  const evidences: MockEvidence[] = [
    {
      sourceType: "LAW",
      title: "표시·광고의 공정화에 관한 법률",
      referenceId: "제3조",
      articleOrCourt: "공정거래위원회",
      summary: "소비자를 속이거나 잘못 알게 할 우려가 있는 표시·광고를 금지합니다.",
      relevanceReason: "확정적 성과 표현의 리스크 판단 기준",
    },
    {
      sourceType: "CASE",
      title: "대법원 판례(광고 문구 오인 관련)",
      articleOrCourt: "대법원",
      summary: "문구의 전체 맥락과 소비자 평균 인식을 기준으로 오인 여부를 판단합니다.",
      relevanceReason: "문구 재작성 시 필수 고려 요소",
    },
  ];

  return { messages, finalDecision, evidences };
};

export const saveMockReviewDetail = (detail: MockReviewDetail) => {
  localStorage.setItem(`${MOCK_DETAIL_PREFIX}${detail.sessionId}`, JSON.stringify(detail));

  const history = parseJson<MockReviewSummary[]>(localStorage.getItem(MOCK_HISTORY_KEY)) || [];
  const nextItem: MockReviewSummary = {
    sessionId: detail.sessionId,
    companyName: detail.companyName,
    reviewType: detail.reviewType,
    situation: detail.situation,
    status: detail.status,
    createdAt: detail.createdAt,
    verdict: detail.finalDecision?.verdict ?? null,
    riskLevel: detail.finalDecision?.riskLevel ?? null,
  };

  const merged = [nextItem, ...history.filter((item) => item.sessionId !== detail.sessionId)].slice(0, 20);
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(merged));
};

export const getMockReviewDetail = (sessionId: string | number) =>
  parseJson<MockReviewDetail>(localStorage.getItem(`${MOCK_DETAIL_PREFIX}${Number(sessionId)}`));

export const getMockReviewHistory = () =>
  parseJson<MockReviewSummary[]>(localStorage.getItem(MOCK_HISTORY_KEY)) || [];
