"""
LangGraph 기반 멀티에이전트 법률 토론 시스템.
법률전문가 / 리스크관리자 / 윤리검토자가 3라운드 토론 후 최종 판정 생성.
"""

import logging
from typing import TypedDict, Annotated
import operator

from langgraph.graph import StateGraph, END
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage

from schemas import AgentMessage, FinalDecision, RiskItem

logger = logging.getLogger(__name__)

# LLM 초기화 (phi3.5 로컬 모델)
llm = ChatOllama(model="phi3.5", temperature=0.4)


# ── 공유 상태 정의 ──────────────────────────────────────────
class DebateState(TypedDict):
    content: str                              # 검토 원문
    situation: str                            # 상황 설명
    review_type: str                          # 검토 유형
    current_round: int                        # 현재 라운드 (1~3)
    messages: Annotated[list, operator.add]   # 누적 메시지


# ── 라운드별 프롬프트 ────────────────────────────────────────
ROUND_CONTEXT = {
    1: "초기 분석 단계입니다. 핵심 법적 쟁점을 파악하세요.",
    2: "심화 검토 단계입니다. 구체적인 위반 가능성과 리스크를 분석하세요.",
    3: "최종 권고 단계입니다. 명확한 수정 방향을 제시하세요.",
}

ROUND_TYPE = {1: "analysis", 2: "concern", 3: "recommendation"}


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """LLM 호출 공통 함수."""
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        return response.content.strip()
    except Exception as e:
        logger.error("LLM 호출 실패: %s", e)
        return "분석 중 오류가 발생했습니다."


# ── 에이전트 노드 ────────────────────────────────────────────
def legal_agent(state: DebateState) -> dict:
    """법률 전문가 에이전트."""
    round_num = state["current_round"]
    context = ROUND_CONTEXT[round_num]

    system = f"""당신은 스타트업 전문 법률 전문가입니다.
검토 유형: {state['review_type']}
{context}
반드시 한국어로 답변하세요. 3문장 이내로 핵심만 간결하게 작성하세요.
관련 법령명을 구체적으로 언급하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

법률 전문가 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "CON" if round_num <= 2 else "PRO"

    msg = AgentMessage(
        agentId="legal",
        agentName="법률 전문가",
        content=content,
        type=ROUND_TYPE[round_num],
        round=round_num,
        stance=stance,
        evidenceSummary=f"라운드 {round_num} 법률 검토 완료",
    )
    return {"messages": [msg]}


def risk_agent(state: DebateState) -> dict:
    """리스크 관리자 에이전트."""
    round_num = state["current_round"]
    context = ROUND_CONTEXT[round_num]

    system = f"""당신은 스타트업 리스크 관리 전문가입니다.
검토 유형: {state['review_type']}
{context}
반드시 한국어로 답변하세요. 3문장 이내로 핵심만 간결하게 작성하세요.
재무적 리스크와 사업적 영향을 중심으로 분석하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

리스크 관리자 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "CON" if round_num <= 2 else "PRO"

    msg = AgentMessage(
        agentId="risk",
        agentName="리스크 관리자",
        content=content,
        type=ROUND_TYPE[round_num],
        round=round_num,
        stance=stance,
        evidenceSummary=f"라운드 {round_num} 리스크 검토 완료",
    )
    return {"messages": [msg]}


def ethics_agent(state: DebateState) -> dict:
    """윤리 검토자 에이전트."""
    round_num = state["current_round"]
    context = ROUND_CONTEXT[round_num]

    system = f"""당신은 기업 윤리 및 ESG 전문가입니다.
검토 유형: {state['review_type']}
{context}
반드시 한국어로 답변하세요. 3문장 이내로 핵심만 간결하게 작성하세요.
소비자 보호와 사회적 책임 관점에서 분석하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

윤리 검토자 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "PRO" if round_num == 3 else ("CON" if round_num == 2 else "NEUTRAL")

    msg = AgentMessage(
        agentId="ethics",
        agentName="윤리 검토자",
        content=content,
        type=ROUND_TYPE[round_num],
        round=round_num,
        stance=stance,
        evidenceSummary=f"라운드 {round_num} 윤리 검토 완료",
    )
    return {"messages": [msg]}


def round_controller(state: DebateState) -> dict:
    """라운드 카운터를 증가시키는 컨트롤러."""
    return {"current_round": state["current_round"] + 1}


def supervisor(state: DebateState) -> dict:
    """슈퍼바이저: 최종 판정 생성."""
    all_opinions = "\n".join([
        f"[{m.agentName} / 라운드{m.round}] {m.content}"
        for m in state["messages"]
    ])

    system = """당신은 법률 검토 슈퍼바이저입니다.
세 전문가의 토론을 종합하여 최종 판정을 내려주세요.
반드시 한국어로 답변하고, 아래 형식을 정확히 따르세요.

위험수준: HIGH 또는 MEDIUM 또는 LOW
핵심문제: (2문장 이내)
권고사항: (2문장 이내)"""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}

[전문가 토론 내용]
{all_opinions}

위 형식에 맞춰 최종 판정을 작성해주세요."""

    verdict_text = _call_llm(system, user)
    return {"messages": [AgentMessage(
        agentId="supervisor",
        agentName="슈퍼바이저",
        content=verdict_text,
        type="verdict",
        round=4,
        stance="NEUTRAL",
        evidenceSummary="최종 종합 판정",
    )]}


# ── 라우팅 함수 ──────────────────────────────────────────────
def should_continue(state: DebateState) -> str:
    """3라운드 완료 여부에 따라 다음 노드 결정."""
    if state["current_round"] > 3:
        return "supervisor"
    return "legal"


# ── 그래프 구성 ──────────────────────────────────────────────
def build_graph() -> StateGraph:
    graph = StateGraph(DebateState)

    graph.add_node("legal", legal_agent)
    graph.add_node("risk", risk_agent)
    graph.add_node("ethics", ethics_agent)
    graph.add_node("round_controller", round_controller)
    graph.add_node("supervisor", supervisor)

    # 한 라운드: legal → risk → ethics → round_controller
    graph.add_edge("legal", "risk")
    graph.add_edge("risk", "ethics")
    graph.add_edge("ethics", "round_controller")

    # 3라운드 반복 or 슈퍼바이저로
    graph.add_conditional_edges(
        "round_controller",
        should_continue,
        {"legal": "legal", "supervisor": "supervisor"},
    )
    graph.add_edge("supervisor", END)
    graph.set_entry_point("legal")

    return graph.compile()


# 그래프 인스턴스 (앱 시작 시 1회 생성)
debate_graph = build_graph()


# ── 메인 실행 함수 ───────────────────────────────────────────
def run_debate(content: str, situation: str, review_type: str) -> tuple[list[AgentMessage], FinalDecision]:
    """토론 실행 후 메시지 목록과 최종 판정 반환."""
    initial_state: DebateState = {
        "content": content,
        "situation": situation,
        "review_type": review_type,
        "current_round": 1,
        "messages": [],
    }

    logger.info("토론 시작 — 검토 유형: %s", review_type)
    result = debate_graph.invoke(initial_state)
    messages = result["messages"]

    # 슈퍼바이저 메시지에서 최종 판정 파싱
    supervisor_msg = next((m for m in messages if m.agentId == "supervisor"), None)
    final_decision = _parse_final_decision(supervisor_msg, content)

    # 슈퍼바이저 메시지는 토론 메시지에서 제외
    debate_messages = [m for m in messages if m.agentId != "supervisor"]

    logger.info("토론 완료 — 총 메시지: %d개", len(debate_messages))
    return debate_messages, final_decision


def _parse_final_decision(supervisor_msg: AgentMessage | None, content: str) -> FinalDecision:
    """슈퍼바이저 출력을 파싱해서 FinalDecision 생성."""
    verdict_text = supervisor_msg.content if supervisor_msg else ""

    risk_level = _extract_field(verdict_text, "위험수준") or "MEDIUM"
    # 필드 값에서 HIGH/MEDIUM/LOW만 추출
    if "HIGH" in risk_level.upper():
        risk_level = "HIGH"
    elif "LOW" in risk_level.upper():
        risk_level = "LOW"
    else:
        risk_level = "MEDIUM"

    summary = _extract_field(verdict_text, "핵심문제") or verdict_text[:200] or "종합 판정 완료"
    recommendation = _extract_field(verdict_text, "권고사항") or verdict_text[:200] or ""
    verdict = "conditional" if risk_level in ("HIGH", "MEDIUM") else "approved"

    risks = [
        RiskItem(category="법률 리스크", level=risk_level.lower(),
                 description=summary),
        RiskItem(category="사업 리스크", level="medium",
                 description="스타트업 운영 관점 잠재 리스크"),
        RiskItem(category="윤리 리스크", level="low",
                 description="소비자·사회적 책임 관점 검토"),
    ]

    return FinalDecision(
        verdict=verdict,
        riskLevel=risk_level,
        risks=risks,
        summary=summary,
        recommendation=recommendation,
        revisedContent=content + "\n\n[AI 에이전트 검토 완료 — 상세 수정안은 권고사항 참조]",
    )


def _extract_field(text: str, field_name: str) -> str:
    """'필드명: 값' 형식에서 값을 추출한다."""
    import re
    pattern = rf"{field_name}\s*:\s*(.+?)(?=\n[가-힣]+\s*:|$)"
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else ""


def _get_previous_opinions(messages: list[AgentMessage], current_round: int) -> str:
    """현재 라운드 이전 발언 + 같은 라운드 내 앞선 발언 요약."""
    prev = [m for m in messages if m.round <= current_round]
    if not prev:
        return "없음 (첫 번째 라운드 첫 발언)"
    return " | ".join([f"[라운드{m.round} {m.agentName}]: {m.content[:80]}..." for m in prev[-6:]])
