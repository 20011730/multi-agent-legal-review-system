"""
Pydantic 모델 정의.
API 요청/응답의 직렬화/역직렬화에 사용된다.
"""

from pydantic import BaseModel, Field
from typing import Optional, Any


class AnalyzeRequest(BaseModel):
    """
    분석 요청 입력.
    Phase 10.18 — 지원사업/추가정보/첨부/후속질문을 모두 선택 필드로 받는다.
    기존 호출(필드 미포함)은 그대로 동작 (하위 호환).
    """
    sessionId: int
    companyName: str
    industry: str
    reviewType: str
    situation: str
    content: str
    participationMode: str

    # Phase 10.18 — 모두 optional (Spring backend 가 있을 때만 동봉)
    startupContext: Optional[dict[str, Any]] = None
    startupExtras: Optional[dict[str, Any]] = None
    attachments: Optional[list[dict[str, Any]]] = Field(default=None)
    followUpQuestions: Optional[list[dict[str, Any]]] = Field(default=None)

    # pydantic v2: 알 수 없는 필드 무시 (관용 모드)
    model_config = {"extra": "ignore"}


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
    """법령/판례 근거 항목."""
    sourceType: str  # "LAW" or "CASE"
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
    # ── 분석 출처 표시 (fallback 구분용, optional) ──
    # "LANGGRAPH_OLLAMA": 정상 LLM 토론 결과
    # "RULE_BASED_FALLBACK": LLM 호출 실패 후 규칙 기반 대체 결과
    analysisSource: str = "LANGGRAPH_OLLAMA"
    fallbackUsed: bool = False
    errorMessage: str | None = None
