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
