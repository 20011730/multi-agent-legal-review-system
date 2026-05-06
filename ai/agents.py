"""
멀티에이전트 법률 토론 시스템.

구조:
- Round 1 (병렬): legal + risk + ethics 초기 분석
- Round 2~3 (순차): 심화 토론
- [사용자 개입]: Explainer가 질문 답변 후 사용자 의견 수집
- Round 4 (순차): 사용자 의견 반영 토론
- 권고 단계 (병렬): 각자 독립 권고
- 판정: 판정자 3명 투표 → 다수결

파라미터:
- CONTEXT_WINDOW: 이전 라운드 참조 메시지 수
"""

import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor

from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage

from schemas import AgentMessage, FinalDecision, RiskItem
import rag

logger = logging.getLogger(__name__)

llm = ChatOllama(model="phi3.5", temperature=0.2)

# ── 파라미터 (조절 가능) ──
CONTEXT_WINDOW = 6   # 이전 라운드 참조 메시지 수

# ── Phase 1 세션 임시 저장소 ──
_session_store: dict[str, dict] = {}

ROUND_TYPE_MAP = {
    1: "analysis",
    2: "debate",
    3: "debate",
    4: "debate",
    5: "recommendation",
    6: "verdict",
}


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


def _get_previous_opinions(messages: list, current_round: int, context_window: int) -> str:
    prev = [m for m in messages if m.round < current_round]
    if not prev:
        return "없음 (첫 번째 발언)"
    recent = prev[-context_window:]
    return " | ".join([f"[라운드{m.round} {m.agentName}]: {m.content[:80]}..." for m in recent])


def _extract_field(text: str, field_name: str) -> str:
    pattern = rf"{field_name}\s*:\s*(.+?)(?=\n[가-힣]+\s*:|$)"
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else ""


# ── 에이전트 함수들 ──

def legal_agent(state: dict) -> list[AgentMessage]:
    round_num = state["current_round"]
    cw = state.get("context_window", CONTEXT_WINDOW)
    rag_context = rag.retrieve(f"법률 위반 {state['review_type']} {state['content'][:150]}")
    rag_section = f"\n\n[관련 법령 조문]\n{rag_context}" if rag_context else ""
    company_ctx = f"기업: {state['company_name']} ({state['industry']})\n" if state.get("company_name") else ""
    user_ctx = f"\n\n[사용자 의견]\n{state['user_opinion']}" if round_num == 4 and state.get("user_opinion") else ""

    system = f"""당신은 스타트업 전문 법률 전문가입니다.
{company_ctx}검토 유형: {state['review_type']}{rag_section}

[출력 규칙]
- 반드시 순수 한국어로만 작성하세요.
- 정확히 2문장으로만 답변하세요.
- 번호, 목록, 소제목 없이 문장만 작성하세요.
- 관련 한국 법령명 하나를 반드시 포함하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num, cw)}{user_ctx}

법률 전문가로서 2문장으로 분석하세요."""

    content = _call_llm(system, user)
    return [AgentMessage(
        agentId="legal", agentName="법률 전문가", content=content,
        type=ROUND_TYPE_MAP.get(round_num, "debate"), round=round_num, stance="NEUTRAL",
        evidenceSummary=f"라운드 {round_num} 법률 검토",
    )]


def risk_agent(state: dict) -> list[AgentMessage]:
    round_num = state["current_round"]
    cw = state.get("context_window", CONTEXT_WINDOW)
    rag_context = rag.retrieve(f"과징금 제재 처벌 {state['review_type']} {state['content'][:150]}")
    rag_section = f"\n\n[관련 법령 조문]\n{rag_context}" if rag_context else ""
    user_ctx = f"\n\n[사용자 의견]\n{state['user_opinion']}" if round_num == 4 and state.get("user_opinion") else ""

    system = f"""당신은 스타트업 리스크 관리 전문가입니다.
검토 유형: {state['review_type']}{rag_section}

[출력 규칙]
- 반드시 순수 한국어로만 작성하세요.
- 정확히 2문장으로만 답변하세요.
- 번호, 목록, 소제목 없이 문장만 작성하세요.
- 재무적 리스크나 사업적 피해를 구체적으로 언급하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num, cw)}{user_ctx}

리스크 관리자로서 2문장으로 분석하세요."""

    content = _call_llm(system, user)
    return [AgentMessage(
        agentId="risk", agentName="리스크 관리자", content=content,
        type=ROUND_TYPE_MAP.get(round_num, "debate"), round=round_num, stance="NEUTRAL",
        evidenceSummary=f"라운드 {round_num} 리스크 검토",
    )]


def ethics_agent(state: dict) -> list[AgentMessage]:
    round_num = state["current_round"]
    cw = state.get("context_window", CONTEXT_WINDOW)
    rag_context = rag.retrieve(f"소비자 보호 권리 {state['review_type']} {state['content'][:150]}")
    rag_section = f"\n\n[관련 법령 조문]\n{rag_context}" if rag_context else ""
    user_ctx = f"\n\n[사용자 의견]\n{state['user_opinion']}" if round_num == 4 and state.get("user_opinion") else ""

    system = f"""당신은 기업 윤리 및 ESG 전문가입니다.
검토 유형: {state['review_type']}{rag_section}

[출력 규칙]
- 반드시 순수 한국어로만 작성하세요.
- 정확히 2문장으로만 답변하세요.
- 번호, 목록, 소제목 없이 문장만 작성하세요.
- 소비자 보호 또는 사회적 책임 관점을 언급하세요."""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}
이전 의견: {_get_previous_opinions(state['messages'], round_num, cw)}{user_ctx}

윤리 검토자로서 2문장으로 분석하세요."""

    content = _call_llm(system, user)
    return [AgentMessage(
        agentId="ethics", agentName="윤리 검토자", content=content,
        type=ROUND_TYPE_MAP.get(round_num, "debate"), round=round_num, stance="NEUTRAL",
        evidenceSummary=f"라운드 {round_num} 윤리 검토",
    )]


def explainer_agent(state: dict) -> list[AgentMessage]:
    """사용자 질문에 쉽게 답변하는 에이전트."""
    all_opinions = "\n".join([
        f"[라운드{m.round} {m.agentName}]: {m.content}"
        for m in state["messages"]
    ])
    user_question = state.get("user_question") or "토론 내용을 쉽게 요약해주세요."

    system = """당신은 법률 토론 내용을 일반인에게 쉽게 설명하는 전문가입니다.

[출력 규칙]
- 반드시 순수 한국어로만 작성하세요.
- 3문장 이내로 간결하게 답변하세요.
- 어려운 법률 용어는 쉬운 말로 바꿔서 설명하세요."""

    user = f"""[지금까지의 토론 내용]
{all_opinions}

[사용자 질문]
{user_question}

위 토론을 바탕으로 사용자 질문에 쉽게 답변해주세요."""

    content = _call_llm(system, user)
    return [AgentMessage(
        agentId="explainer", agentName="설명 에이전트", content=content,
        type="explanation", round=0, stance="NEUTRAL",
        evidenceSummary="사용자 질문 답변",
    )]


def supervisor_agent(state: dict) -> tuple[list[AgentMessage], FinalDecision]:
    """전체 토론을 종합해 최종 판정을 내리는 슈퍼바이저."""
    all_opinions = "\n".join([
        f"[라운드{m.round} {m.agentName}]: {m.content}"
        for m in state["messages"]
    ])

    system = """당신은 스타트업 법률 자문 최종 판정자입니다.
모든 에이전트의 토론을 종합하여 아래 형식으로만 출력하세요:

위험수준: HIGH
핵심문제: (1문장)
권고사항: (1문장)"""

    user = f"""[상황] {state['situation']}
[검토 내용] {state['content']}

[토론 내용]
{all_opinions}

최종 판정을 내려주세요."""

    content = _call_llm(system, user)
    msg = AgentMessage(
        agentId="supervisor", agentName="슈퍼바이저", content=content,
        type="verdict", round=6, stance="NEUTRAL",
        evidenceSummary="최종 판정",
    )

    level = _extract_field(content, "위험수준") or "MEDIUM"
    if "HIGH" in level.upper():
        final_risk = "HIGH"
    elif "LOW" in level.upper():
        final_risk = "LOW"
    else:
        final_risk = "MEDIUM"

    verdict = "conditional" if final_risk in ("HIGH", "MEDIUM") else "approved"
    summary = _extract_field(content, "핵심문제") or content[:200]
    recommendation = _extract_field(content, "권고사항") or ""

    risks = [
        RiskItem(category="법률 리스크", level=final_risk.lower(), description=summary),
        RiskItem(category="사업 리스크", level="medium", description="스타트업 운영 관점 잠재 리스크"),
        RiskItem(category="윤리 리스크", level="low", description="소비자·사회적 책임 관점 검토"),
    ]

    final_decision = FinalDecision(
        verdict=verdict, riskLevel=final_risk, risks=risks,
        summary=summary, recommendation=recommendation,
        revisedContent=state["content"] + "\n\n[AI 에이전트 검토 완료 — 상세 수정안은 권고사항 참조]",
    )

    return [msg], final_decision


# ── 단계 실행 헬퍼 ──

def _run_parallel(state: dict, round_num: int) -> list[AgentMessage]:
    """3 에이전트 병렬 실행."""
    s = {**state, "current_round": round_num}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(legal_agent, s),
            executor.submit(risk_agent, s),
            executor.submit(ethics_agent, s),
        ]
        results = [f.result() for f in futures]
    return [msg for r in results for msg in r]


def _run_sequential(state: dict, round_num: int) -> list[AgentMessage]:
    """3 에이전트 순차 실행 (앞 에이전트 의견 참조)."""
    s = {**state, "current_round": round_num}
    msgs: list[AgentMessage] = []

    m1 = legal_agent(s)
    msgs.extend(m1)
    s = {**s, "messages": state["messages"] + msgs}

    m2 = risk_agent(s)
    msgs.extend(m2)
    s = {**s, "messages": state["messages"] + msgs}

    m3 = ethics_agent(s)
    msgs.extend(m3)

    return msgs




# ── 공개 API ──

def run_debate_phase1(
    content: str,
    situation: str,
    review_type: str,
    company_name: str = "",
    industry: str = "",
    context_window: int = CONTEXT_WINDOW,
) -> tuple[list[AgentMessage], str]:
    """
    Phase 1: Round 1(병렬) → Round 2(순차) → Round 3(순차)
    반환: (메시지 리스트, 세션 ID)
    """
    state: dict = {
        "content": content,
        "situation": situation,
        "review_type": review_type,
        "company_name": company_name,
        "industry": industry,
        "current_round": 1,
        "messages": [],
        "user_question": "",
        "user_opinion": "",
        "context_window": context_window,
    }

    logger.info("Phase 1 시작 — 검토 유형: %s", review_type)
    msgs: list[AgentMessage] = []

    # Round 1: 병렬
    r1 = _run_parallel(state, 1)
    msgs.extend(r1)
    state["messages"] = msgs[:]

    # Round 2: 순차
    r2 = _run_sequential(state, 2)
    msgs.extend(r2)
    state["messages"] = msgs[:]

    # Round 3: 순차
    r3 = _run_sequential(state, 3)
    msgs.extend(r3)
    state["messages"] = msgs[:]

    session_id = str(uuid.uuid4())
    _session_store[session_id] = state

    logger.info("Phase 1 완료 — 메시지: %d개, session_id: %s", len(msgs), session_id)
    return msgs, session_id


def run_debate_phase2(
    session_id: str,
    user_question: str = "",
    user_opinion: str = "",
) -> tuple[list[AgentMessage], FinalDecision]:
    """
    Phase 2: Explainer → Round 4(순차) → 권고(병렬) → 판정(투표)
    반환: (메시지 리스트, 최종 판정)
    """
    state = _session_store.pop(session_id, None)
    if state is None:
        raise ValueError(f"세션을 찾을 수 없습니다: {session_id}")

    state["user_question"] = user_question
    state["user_opinion"] = user_opinion

    logger.info("Phase 2 시작 — session_id: %s", session_id)
    msgs: list[AgentMessage] = []

    # Explainer: 사용자 질문 답변
    exp = explainer_agent(state)
    msgs.extend(exp)
    state["messages"] = state["messages"] + msgs[:]

    # Round 4: 순차 (사용자 의견 반영)
    r4 = _run_sequential(state, 4)
    msgs.extend(r4)
    state["messages"] = state["messages"] + r4

    # 권고: 병렬
    rec = _run_parallel(state, 5)
    msgs.extend(rec)
    state["messages"] = state["messages"] + rec

    # 판정: 슈퍼바이저
    judge_msgs, final_decision = supervisor_agent(state)
    msgs.extend(judge_msgs)

    logger.info("Phase 2 완료 — 메시지: %d개", len(msgs))
    return msgs, final_decision


def run_debate(
    content: str,
    situation: str,
    review_type: str,
    company_name: str = "",
    industry: str = "",
    context_window: int = CONTEXT_WINDOW,
) -> tuple[list[AgentMessage], FinalDecision]:
    """기존 호환용: 사용자 개입 없이 전체 자동 실행."""
    msgs_p1, session_id = run_debate_phase1(
        content, situation, review_type, company_name, industry, context_window
    )
    msgs_p2, final_decision = run_debate_phase2(session_id)
    return msgs_p1 + msgs_p2, final_decision
