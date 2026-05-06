from pydantic import BaseModel
from typing import Optional


class AnalyzeRequest(BaseModel):
    sessionId: int = 0
    companyName: str = ""
    industry: str = ""
    reviewType: str
    situation: str
    content: str
    participationMode: str = "ai_only"
    contextWindow: int = 6   # 이전 라운드 참조 메시지 수 파라미터


class AgentMessage(BaseModel):
    agentId: str
    agentName: str
    content: str
    type: str
    round: int
    stance: str
    evidenceSummary: str


class RiskItem(BaseModel):
    category: str
    level: str
    description: str


class EvidenceItem(BaseModel):
    sourceType: str
    title: str
    referenceId: str = ""
    articleOrCourt: str = ""
    summary: str = ""
    url: str = ""
    relevanceReason: str = ""
    relevanceScore: int = 0
    quotedText: str = ""
    metadata: Optional[dict] = None


class FinalDecision(BaseModel):
    verdict: str
    riskLevel: str
    risks: list[RiskItem]
    summary: str
    recommendation: str
    revisedContent: str


class AnalyzeResponse(BaseModel):
    messages: list[AgentMessage]
    finalDecision: FinalDecision
    evidences: list[EvidenceItem] = []


# ── 인터랙티브 모드용 ──

class PhaseOneResponse(BaseModel):
    debateSessionId: str          # Phase 2 호출 시 필요한 세션 ID
    messages: list[AgentMessage]


class ContinueRequest(BaseModel):
    debateSessionId: str          # Phase 1에서 받은 세션 ID
    userQuestion: str = ""        # 사용자 질문
    userOpinion: str = ""         # 사용자 의견 (Round 4에 반영)


class ContinueResponse(BaseModel):
    messages: list[AgentMessage]
    finalDecision: FinalDecision
    evidences: list[EvidenceItem] = []
