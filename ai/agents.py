"""
LangGraph 기반 멀티에이전트 법률 토론 시스템.
- Round 1: 순차 (직렬) — 에이전트가 앞선 발언 참조하며 토론
- Round 2: 병렬     — Round 1 전체 참고 후 각자 심화 분석
- Round 3: 순차 (직렬) — 최종 권고, 앞선 발언 참조하며 토론
- Supervisor: 전체 종합 판정
"""

import logging
import re
from typing import TypedDict, Annotated
from concurrent.futures import ThreadPoolExecutor
import operator

from langgraph.graph import StateGraph, END
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage

from schemas import AgentMessage, FinalDecision, RiskItem

logger = logging.getLogger(__name__)

llm = ChatOllama(model="phi3.5", temperature=0.4)


class DebateState(TypedDict):
    content: str
    situation: str
    review_type: str
    current_round: int
    messages: Annotated[list, operator.add]


ROUND_CONTEXT = {
    1: "초기 분석 단계입니다. 핵심 법적 쟁점을 파악하세요.",
    2: "심화 검토 단계입니다. 구체적인 위반 가능성과 리스크를 분석하세요.",
    3: "최종 권고 단계입니다. 명확한 수정 방향을 제시하세요.",
}

ROUND_TYPE = {1: "analysis", 2: "concern", 3: "recommendation"}


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        return response.content.strip()
    except Exception as e:
        logger.error("LLM 호출 실패: %s", e)
        return "분석 중 오류가 발생했습니다."


def legal_agent(state: DebateState) -> dict:
    round_num = state["current_round"]
    system = f"""당신은 스타트업 전문 법률 전문가입니다.
검토 유형: {state['review_type']}
{ROUND_CONTEXT[round_num]}
반드시 순수 한국어로만 답변하세요. 영어나 외래어를 절대 사용하지 마세요.
3문장 이내로 핵심만 간결하게 작성하세요.
관련 한국 법령명을 구체적으로 언급하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

법률 전문가 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "CON" if round_num <= 2 else "PRO"

    return {"messages": [AgentMessage(
        agentId="legal", agentName="법률 전문가", content=content,
        type=ROUND_TYPE[round_num], round=round_num, stance=stance,
        evidenceSummary=f"라운드 {round_num} 법률 검토 완료",
    )]}


def risk_agent(state: DebateState) -> dict:
    round_num = state["current_round"]
    system = f"""당신은 스타트업 리스크 관리 전문가입니다.
검토 유형: {state['review_type']}
{ROUND_CONTEXT[round_num]}
반드시 순수 한국어로만 답변하세요. 영어나 외래어를 절대 사용하지 마세요.
3문장 이내로 핵심만 간결하게 작성하세요.
재무적 리스크와 사업적 영향을 중심으로 분석하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

리스크 관리자 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "CON" if round_num <= 2 else "PRO"

    return {"messages": [AgentMessage(
        agentId="risk", agentName="리스크 관리자", content=content,
        type=ROUND_TYPE[round_num], round=round_num, stance=stance,
        evidenceSummary=f"라운드 {round_num} 리스크 검토 완료",
    )]}


def ethics_agent(state: DebateState) -> dict:
    round_num = state["current_round"]
    system = f"""당신은 기업 윤리 및 ESG 전문가입니다.
검토 유형: {state['review_type']}
{ROUND_CONTEXT[round_num]}
반드시 순수 한국어로만 답변하세요. 영어나 외래어를 절대 사용하지 마세요.
3문장 이내로 핵심만 간결하게 작성하세요.
소비자 보호와 사회적 책임 관점에서 분석하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num)}

윤리 검토자 관점에서 분석해주세요."""

    content = _call_llm(system, user)
    stance = "PRO" if round_num == 3 else ("CON" if round_num == 2 else "NEUTRAL")

    return {"messages": [AgentMessage(
        agentId="ethics", agentName="윤리 검토자", content=content,
        type=ROUND_TYPE[round_num], round=round_num, stance=stance,
        evidenceSummary=f"라운드 {round_num} 윤리 검토 완료",
    )]}


def round2_parallel(state: DebateState) -> dict:
    """Round 2: 3개 에이전트 병렬 실행. Round 1 전체 발언을 보고 각자 심화 분석."""
    state_r2 = {**state, "current_round": 2}

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(legal_agent, state_r2),
            executor.submit(risk_agent, state_r2),
            executor.submit(ethics_agent, state_r2),
        ]
        results = [f.result() for f in futures]

    all_messages = []
    for r in results:
        all_messages.extend(r["messages"])

    return {"messages": all_messages, "current_round": 3}


def supervisor(state: DebateState) -> dict:
    all_opinions = "\n".join([
        f"[{m.agentName} / 라운드{m.round}] {m.content}"
        for m in state["messages"]
    ])

    system = """당신은 법률 검토 슈퍼바이저입니다.
세 전문가의 토론을 종합하여 최종 판정을 내려주세요.
반드시 순수 한국어로만 답변하고, 아래 형식을 정확히 따르세요.

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
        agentId="supervisor", agentName="슈퍼바이저", content=verdict_text,
        type="verdict", round=4, stance="NEUTRAL",
        evidenceSummary="최종 종합 판정",
    )]}


def build_graph() -> StateGraph:
    graph = StateGraph(DebateState)

    # Round 1 — 순차 (직렬)
    graph.add_node("legal_r1", legal_agent)
    graph.add_node("risk_r1", risk_agent)
    graph.add_node("ethics_r1", ethics_agent)
    # Round 2 — 병렬
    graph.add_node("round2_parallel", round2_parallel)
    # Round 3 — 순차 (직렬)
    graph.add_node("legal_r3", legal_agent)
    graph.add_node("risk_r3", risk_agent)
    graph.add_node("ethics_r3", ethics_agent)
    # Supervisor
    graph.add_node("supervisor", supervisor)

    graph.add_edge("legal_r1", "risk_r1")
    graph.add_edge("risk_r1", "ethics_r1")
    graph.add_edge("ethics_r1", "round2_parallel")
    graph.add_edge("round2_parallel", "legal_r3")
    graph.add_edge("legal_r3", "risk_r3")
    graph.add_edge("risk_r3", "ethics_r3")
    graph.add_edge("ethics_r3", "supervisor")
    graph.add_edge("supervisor", END)

    graph.set_entry_point("legal_r1")
    return graph.compile()


debate_graph = build_graph()


def run_debate(content: str, situation: str, review_type: str) -> tuple[list[AgentMessage], FinalDecision]:
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

    supervisor_msg = next((m for m in messages if m.agentId == "supervisor"), None)
    final_decision = _parse_final_decision(supervisor_msg, content)
    debate_messages = [m for m in messages if m.agentId != "supervisor"]

    logger.info("토론 완료 — 총 메시지: %d개", len(debate_messages))
    return debate_messages, final_decision


def _parse_final_decision(supervisor_msg: AgentMessage | None, content: str) -> FinalDecision:
    verdict_text = supervisor_msg.content if supervisor_msg else ""

    risk_level = _extract_field(verdict_text, "위험수준") or "MEDIUM"
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
        RiskItem(category="법률 리스크", level=risk_level.lower(), description=summary),
        RiskItem(category="사업 리스크", level="medium", description="스타트업 운영 관점 잠재 리스크"),
        RiskItem(category="윤리 리스크", level="low", description="소비자·사회적 책임 관점 검토"),
    ]

    return FinalDecision(
        verdict=verdict, riskLevel=risk_level, risks=risks,
        summary=summary, recommendation=recommendation,
        revisedContent=content + "\n\n[AI 에이전트 검토 완료 — 상세 수정안은 권고사항 참조]",
    )


def _extract_field(text: str, field_name: str) -> str:
    pattern = rf"{field_name}\s*:\s*(.+?)(?=\n[가-힣]+\s*:|$)"
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else ""


def _get_previous_opinions(messages: list[AgentMessage], current_round: int) -> str:
    prev = [m for m in messages if m.round <= current_round]
    if not prev:
        return "없음 (첫 번째 라운드 첫 발언)"
    return " | ".join([f"[라운드{m.round} {m.agentName}]: {m.content[:80]}..." for m in prev[-6:]])
