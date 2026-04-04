from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    sessionId: int
    companyName: str
    industry: str
    reviewType: str
    situation: str
    content: str
    participationMode: str


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
