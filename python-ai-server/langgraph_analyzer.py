"""
LangGraph 기반 멀티에이전트 법률 검토 분석기.

ai_hyejin_retry 브랜치의 LangGraph 토론 시스템을 FastAPI 서버에 통합.
- Human-in-the-loop 제거 → 고정 라운드 (BIZ↔LEGAL 2회 교대 후 JUDGE 판정)
- 출력을 기존 AnalyzeResponse 스키마에 매핑
- 실패 시 규칙 기반 analyzer.py로 폴백
"""

import logging
import os
from concurrent.futures import ThreadPoolExecutor, Future
from typing import TypedDict

from langgraph.graph import StateGraph, END

from agents.legal_agent import run_legal_agent
from agents.biz_agent import run_biz_agent
from agents.judge_agent import run_judge_agent, parse_judge_response
from schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AgentMessage,
    FinalDecision,
    RiskItem,
    EvidenceItem,
)

logger = logging.getLogger(__name__)

# 고정 토론 라운드 수 (BIZ→LEGAL 1세트 = 1라운드)
MAX_ROUNDS = int(os.getenv("LANGGRAPH_MAX_ROUNDS", "2"))


# ────────────────────────────────────────────────────────────
# Phase 10.18 — startupContext / startupExtras / attachments /
# followUpQuestions 를 LLM 프롬프트에 명시적으로 주입하기 위한
# 보조 컨텍스트 블록 빌더.
# ────────────────────────────────────────────────────────────
def _build_supplementary_context(request: "AnalyzeRequest") -> str:
    """
    선택 필드(지원사업/Step2 추가정보/첨부 메타/후속질문) 를 사람이 읽을 수 있는
    마크다운 블록으로 직렬화한다. 모든 필드가 비어 있으면 빈 문자열.

    이 블록은 다음 위치에 주입된다:
      - topic 끝부분에 부착 → 모든 에이전트가 검토 안건과 함께 참조
      - 초기 history 에도 부착 → 라운드 1 부터 시야에 들어감
      - JUDGE 단계에서도 history 누적되어 자연스럽게 반영됨

    파일 본문 추출은 미구현 (TODO) — 메타데이터(파일명/타입/크기/요약)만 안내성으로 전달함을
    명시해 LLM 이 “파일 내용을 안다”는 환각을 방지한다.
    """
    blocks: list[str] = []

    sc = getattr(request, "startupContext", None)
    if isinstance(sc, dict) and sc:
        lines = ["[지원사업 기반 검토 컨텍스트]"]
        for key, label in (
            ("title", "사업명"),
            ("organization", "주관기관"),
            ("category", "유형"),
            ("target", "지원대상"),
            ("fieldSummary", "분야 요약"),
            ("deadline", "마감"),
            ("applyUrl", "신청 URL"),
            ("source", "출처"),
            ("aiInsightHint", "AI 분석 힌트"),
            ("legalReviewHint", "법적 검토 힌트"),
        ):
            v = sc.get(key)
            if v:
                lines.append(f"- {label}: {v}")
        if len(lines) > 1:
            lines.append(
                "※ 위 컨텍스트가 있는 경우 — 협약/사업비/지식재산권/환수/개인정보 등 "
                "지원사업 특유 쟁점을 검토 대상에 우선 반영하세요."
            )
            blocks.append("\n".join(lines))

    se = getattr(request, "startupExtras", None)
    if isinstance(se, dict) and se:
        label_map = {
            "applicantType": "신청자 유형",
            "executionMode": "수행 방식",
            "privacyHandling": "개인정보 처리",
            "ipOutput": "지식재산 산출물",
            "workforce": "인력 운영",
            "priorSupport": "기존 정부지원 이력",
        }
        lines = ["[Step 2 — 신청자 기본 정보]"]
        for k, label in label_map.items():
            v = se.get(k)
            if v:
                lines.append(f"- {label}: {v}")
        # Phase 10.19 — 추천 첨부자료 목록 (Input UI helper 가 동봉)
        rec = se.get("recommendedAttachments")
        if isinstance(rec, list) and rec:
            lines.append("- 비서 추천 첨부자료:")
            for r in rec[:10]:
                if not isinstance(r, dict):
                    continue
                label = r.get("label") or r.get("name") or ""
                reason = r.get("reason") or ""
                sens = r.get("sensitivity") or "low"
                opt = r.get("optional")
                tag = "권장" if opt is False else "옵션"
                if label:
                    lines.append(f"  · [{tag}/민감도 {sens}] {label} — {reason}")
        if len(lines) > 1:
            blocks.append("\n".join(lines))

    atts = getattr(request, "attachments", None)
    if isinstance(atts, list) and atts:
        # Phase 10.19 — 텍스트 파일은 bodyText 가 동봉됨 (민감정보 마스킹 완료 상태).
        # PDF/DOCX 등은 여전히 메타데이터만 — extractionStatus 로 구분.
        lines = ["[사용자 첨부 자료]"]
        any_body = False
        for i, a in enumerate(atts[:8], start=1):
            if not isinstance(a, dict):
                continue
            name = a.get("name") or "(이름 없음)"
            size = a.get("size")
            mime = a.get("mimeType") or a.get("type") or ""
            summary = a.get("summary") or a.get("description") or ""
            status = a.get("extractionStatus") or "unknown"
            sensitivity = a.get("sensitivityFlags") or []
            body = a.get("bodyText") or ""
            truncated = bool(a.get("bodyTruncated"))

            size_str = f", {size}B" if isinstance(size, int) else ""
            mime_str = f", {mime}" if mime else ""
            head = f"{i}. {name}{size_str}{mime_str}  [추출상태: {status}]"
            if sensitivity:
                head += f"  (민감정보 자동 마스킹: {', '.join(sensitivity)})"
            lines.append(head)
            if summary:
                lines.append(f"   요약/설명: {summary[:160]}")
            if body:
                any_body = True
                excerpt = body[:1500].replace("\n", " ")
                tail = " …(일부만 전달됨)" if truncated or len(body) > 1500 else ""
                lines.append(f"   본문 발췌: {excerpt}{tail}")

        if any_body:
            lines.append(
                "※ 위 ‘본문 발췌’ 는 사용자가 업로드한 텍스트 파일에서 발췌된 내용입니다. "
                "각 에이전트는 자신의 라운드 발언 안에 ‘첨부 자료 기준으로 확인한 사실’ 을 최소 1줄 포함하세요. "
                "본문이 일부만 전달된 경우 추가 확인이 필요한 부분을 권고에 명시하세요."
            )
        else:
            lines.append(
                "※ 본문 추출 결과가 없는 항목(PDF/DOCX 등) 은 파일명·유형만 토대로 ‘어떤 자료를 추가 확인하면 좋은지’를 권고하세요. "
                "파일 내용을 안다고 단정하지 마세요."
            )
        blocks.append("\n".join(lines))

    fq = getattr(request, "followUpQuestions", None)
    if isinstance(fq, list) and fq:
        lines = ["[사용자 후속 질문 — 재검토 요청 (반드시 본문에 직접 답변)]"]
        for i, q in enumerate(fq[:10], start=1):
            if not isinstance(q, dict):
                continue
            target = q.get("targetAgent") or q.get("target") or "all"
            msg = (q.get("message") or "").strip()
            if not msg:
                continue
            lines.append(f"{i}. [대상: {target}] {msg}")
        if len(lines) > 1:
            lines.append(
                "※ 위 질문은 사용자가 이전 토론 결과를 본 뒤 추가로 요청한 사항입니다. "
                "각 에이전트는 자신의 라운드 발언 안에서 해당 질문에 1줄 이상 직접 응답하세요. "
                "최종 판정관(JUDGE) 은 recommendation 안에 “사용자 추가 질문에 대한 답변” 단락을 별도로 포함하세요."
            )
            blocks.append("\n".join(lines))

    if not blocks:
        return ""
    return "\n\n".join(blocks)


# ── LangGraph State ──
class DebateState(TypedDict):
    history: str        # 누적 토론 텍스트
    turn_count: int     # 현재 턴 수
    topic: str          # 검토 대상 안건 원문
    situation: str      # 상황 설명
    messages: list      # AgentMessage 리스트 (결과 수집용)
    round_num: int      # 현재 라운드 번호


# ── 노드 함수 ──
def _count_prev_messages(state: DebateState) -> int:
    """현재까지 누적된 발언 수 (디버깅 메트릭)."""
    return len(state.get("messages", []) or [])


def _build_judge_display_content(raw_response: str) -> str:
    """
    판정 에이전트의 raw 응답(JSON 또는 텍스트)을 토론 로그에 표시하기 좋은
    마크다운 섹션으로 변환한다.

    - JSON 파싱 성공 시: ## 종합 판정 / ## 핵심 위험 요소 / ## 권고사항 / ## 수정 문안 제안
    - 파싱 실패 시: raw 응답을 최대 2000자까지 그대로 보존 (절단되더라도 길게 유지)
    """
    import json
    if not raw_response:
        return "(판정 생성 실패 — 토론 결과를 다시 확인해주세요.)"

    text = raw_response.strip()
    # 코드블록 안의 JSON 추출
    parsed = None
    try:
        if "```json" in text:
            chunk = text.split("```json", 1)[1].split("```", 1)[0].strip()
            parsed = json.loads(chunk)
        elif "```" in text:
            chunk = text.split("```", 1)[1].split("```", 1)[0].strip()
            parsed = json.loads(chunk)
        elif text.startswith("{"):
            # 마지막 } 까지 시도
            end = text.rfind("}")
            if end > 0:
                parsed = json.loads(text[: end + 1])
    except Exception:
        parsed = None

    if not isinstance(parsed, dict):
        # 파싱 실패 — raw 텍스트를 충분히 길게 보존
        return text[:2000] + ("…" if len(text) > 2000 else "")

    parts = []
    summary = (parsed.get("summary") or "").strip()
    recommendation = (parsed.get("recommendation") or "").strip()
    revised = (parsed.get("revisedContent") or "").strip()
    risks = parsed.get("risks") or []
    verdict = (parsed.get("verdict") or "").strip()
    risk_level = (parsed.get("riskLevel") or "").strip()

    header_bits = []
    if verdict:
        verdict_label = {
            "approved": "승인",
            "conditional": "조건부 승인 (수정 권고)",
            "rejected": "반려",
        }.get(verdict.lower(), verdict)
        header_bits.append(f"**판정:** {verdict_label}")
    if risk_level:
        header_bits.append(f"**리스크 등급:** {risk_level}")
    if header_bits:
        parts.append(" · ".join(header_bits))

    if summary:
        parts.append(f"## 종합 판정\n{summary}")

    if isinstance(risks, list) and risks:
        risk_lines = ["## 핵심 위험 요소"]
        for r in risks[:8]:
            if isinstance(r, dict):
                cat = (r.get("category") or "").strip()
                lvl = (r.get("level") or "").strip()
                desc = (r.get("description") or "").strip()
                tag = f"[{lvl.upper()}] " if lvl else ""
                risk_lines.append(f"- {tag}**{cat}**: {desc}")
        if len(risk_lines) > 1:
            parts.append("\n".join(risk_lines))

    if recommendation:
        parts.append(f"## 권고사항\n{recommendation}")

    if revised:
        parts.append(f"## 수정 문안 제안\n{revised}")

    if not parts:
        return text[:2000] + ("…" if len(text) > 2000 else "")
    return "\n\n".join(parts)


def biz_node(state: DebateState) -> dict:
    """비즈니스 에이전트 노드 — 라운드별 prompt 전달."""
    import time
    round_num = state["round_num"]
    prev_count = _count_prev_messages(state)
    t0 = time.time()
    logger.info(
        "[BIZ] round=%d 시작 (prev_messages=%d, history_len=%d)",
        round_num, prev_count, len(state.get("history", "") or ""),
    )
    try:
        response = run_biz_agent(state["history"], state["topic"], round_num=round_num)
    except Exception as e:
        logger.error("비즈니스 에이전트 실패: %s", e)
        response = f"(비즈니스 관점 분석 중 오류 발생: {str(e)[:100]})"

    elapsed = time.time() - t0
    logger.info(
        "[BIZ] round=%d 완료 (response_len=%d, elapsed=%.1fs)",
        round_num, len(response or ""), elapsed,
    )

    new_history = state["history"] + f"\n\n[비즈니스 전략가 / 라운드 {round_num}]: {response}"

    msg = AgentMessage(
        agentId="risk",
        agentName="비즈니스 전략가",
        content=response,
        type="analysis" if round_num == 1 else "concern",
        round=round_num,
        stance="PRO",
        evidenceSummary="비즈니스 성장 및 실행 관점 분석",
    )

    messages = list(state.get("messages", []))
    messages.append(msg)

    return {
        "history": new_history,
        "turn_count": state["turn_count"] + 1,
        "messages": messages,
    }


def legal_node(state: DebateState) -> dict:
    """법무 에이전트 노드 (RAG 포함) — 라운드별 prompt 전달."""
    import time
    round_num = state["round_num"]
    prev_count = _count_prev_messages(state)
    t0 = time.time()
    logger.info(
        "[LEGAL] round=%d 시작 (prev_messages=%d, history_len=%d)",
        round_num, prev_count, len(state.get("history", "") or ""),
    )
    try:
        response = run_legal_agent(state["history"], state["topic"], round_num=round_num)
    except Exception as e:
        logger.error("법무 에이전트 실패: %s", e)
        response = f"(법적 분석 중 오류 발생: {str(e)[:100]})"

    elapsed = time.time() - t0
    logger.info(
        "[LEGAL] round=%d 완료 (response_len=%d, elapsed=%.1fs)",
        round_num, len(response or ""), elapsed,
    )

    new_history = state["history"] + f"\n\n[법률 전문가 / 라운드 {round_num}]: {response}"

    msg = AgentMessage(
        agentId="legal",
        agentName="법률 전문가",
        content=response,
        type="analysis" if round_num == 1 else "concern",
        round=round_num,
        stance="CON",
        evidenceSummary="법적 리스크 및 규정 위반 가능성 분석",
    )

    messages = list(state.get("messages", []))
    messages.append(msg)

    return {
        "history": new_history,
        "turn_count": state["turn_count"] + 1,
        "messages": messages,
    }


def round_increment_node(state: DebateState) -> dict:
    """라운드 카운터 증가 노드."""
    return {"round_num": state["round_num"] + 1}


def judge_node(state: DebateState) -> dict:
    """판정 에이전트 노드 — 전체 토론 종합."""
    import time
    prev_count = _count_prev_messages(state)
    t0 = time.time()
    logger.info(
        "[JUDGE] 시작 (prev_messages=%d, history_len=%d)",
        prev_count, len(state.get("history", "") or ""),
    )
    try:
        response = run_judge_agent(state["history"], state["topic"])
    except Exception as e:
        logger.error("판정 에이전트 실패: %s", e)
        response = ""

    elapsed = time.time() - t0
    logger.info("[JUDGE] 완료 (response_len=%d, elapsed=%.1fs)", len(response or ""), elapsed)

    new_history = state["history"] + f"\n\n[최종 판정]: {response}"

    # 판정 결과를 토론 로그용으로 사람이 읽을 수 있는 형태로 변환:
    #   - JSON 그대로 [:500] 절단하지 않고 summary/recommendation/revisedContent를
    #     사람이 보기 좋은 마크다운 섹션 형태로 재구성
    #   - 파싱 실패 시 raw response를 충분한 길이(2000자)까지 보존
    judge_display = _build_judge_display_content(response)

    msg = AgentMessage(
        agentId="judge",                 # 'ethics' → 'judge'로 명확화 (frontend 호환성: 둘 다 처리됨)
        agentName="최종 판정관",
        content=judge_display,
        type="recommendation",
        round=state["round_num"],
        stance="NEUTRAL",
        evidenceSummary="양측 주장을 종합한 최종 판정",
    )

    messages = list(state.get("messages", []))
    messages.append(msg)

    return {
        "history": new_history,
        "messages": messages,
    }


# ── 라우팅 ──
def should_continue(state: DebateState) -> str:
    """라운드 수 기준으로 토론 계속 여부를 결정한다."""
    if state["round_num"] > MAX_ROUNDS:
        return "judge"
    return "next_round"


# ── 그래프 조립 ──
def _build_graph() -> StateGraph:
    workflow = StateGraph(DebateState)

    workflow.add_node("biz", biz_node)
    workflow.add_node("legal", legal_node)
    workflow.add_node("round_inc", round_increment_node)
    workflow.add_node("judge", judge_node)

    # 흐름: BIZ → LEGAL → (조건: 라운드 초과? → JUDGE / 아니면 → 라운드 증가 → BIZ)
    workflow.set_entry_point("biz")
    workflow.add_edge("biz", "legal")
    workflow.add_conditional_edges("legal", should_continue, {
        "next_round": "round_inc",
        "judge": "judge",
    })
    workflow.add_edge("round_inc", "biz")
    workflow.add_edge("judge", END)

    return workflow.compile()


# 그래프를 모듈 로드 시 한 번만 컴파일
_graph = None


def _get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


# ── 메인 분석 함수 ──
def analyze_with_langgraph(request: AnalyzeRequest) -> AnalyzeResponse:
    """LangGraph 멀티에이전트 토론을 실행하고 AnalyzeResponse로 변환한다."""

    # provider 사전 검증 — 미설정/불충분이면 main.py에서 규칙 기반 폴백
    from agents.llm_client import is_provider_configured, get_provider
    ok, reason = is_provider_configured()
    if not ok:
        raise RuntimeError(f"LLM provider 사용 불가 — 규칙 기반 폴백: {reason}")
    logger.info("✓ LLM provider 검증 통과: %s", reason)

    # 안건 텍스트 구성
    base_topic = (
        f"[기업] {request.companyName} ({request.industry})\n"
        f"[검토 유형] {request.reviewType}\n"
        f"[상황] {request.situation}\n"
        f"[검토 대상 원문] {request.content}"
    )

    # Phase 10.18 — 보조 컨텍스트 (지원사업/추가정보/첨부/후속질문) 주입
    supplementary = _build_supplementary_context(request)
    if supplementary:
        topic = base_topic + "\n\n" + supplementary
        logger.info(
            "LangGraph 보조 컨텍스트 주입 — sc=%s, se=%s, attachments=%s, followUp=%s",
            bool(getattr(request, "startupContext", None)),
            bool(getattr(request, "startupExtras", None)),
            len(getattr(request, "attachments", None) or []),
            len(getattr(request, "followUpQuestions", None) or []),
        )
    else:
        topic = base_topic

    initial_state: DebateState = {
        "history": f"[검토 안건]\n{topic}",
        "turn_count": 0,
        "topic": topic,
        "situation": request.situation,
        "messages": [],
        "round_num": 1,
    }

    logger.info("LangGraph 토론 시작 — 세션 %s, 최대 %d 라운드", request.sessionId, MAX_ROUNDS)

    # evidence 수집을 debate와 동시에 시작 (병렬 실행)
    evidence_future: Future | None = None
    try:
        from services.evidence_service import collect_evidences
        executor = ThreadPoolExecutor(max_workers=1)
        evidence_future = executor.submit(
            collect_evidences,
            request.content, request.situation, request.reviewType, 5
        )
        logger.info("법령/판례 수집을 토론과 동시 시작")
    except Exception as e:
        logger.warning("병렬 evidence 수집 시작 실패: %s", e)

    graph = _get_graph()
    final_state = graph.invoke(initial_state, {"recursion_limit": 30})

    # 메시지 추출 (판정 메시지 제외)
    all_messages: list[AgentMessage] = final_state.get("messages", [])
    debate_messages = [m for m in all_messages if m.agentId != "ethics" or m.type != "recommendation"]
    judge_message = next((m for m in all_messages if m.agentId == "ethics" and m.type == "recommendation"), None)

    # 모든 에이전트가 실패했는지 확인 → 실패 시 규칙 기반으로 폴백
    error_count = sum(1 for m in debate_messages if "오류 발생" in m.content)
    if error_count == len(debate_messages) and len(debate_messages) > 0:
        raise RuntimeError(
            f"LangGraph 토론 중 모든 에이전트가 실패 ({error_count}건) — 규칙 기반으로 폴백합니다."
        )

    # 판정 결과 파싱
    judge_raw = judge_message.content if judge_message else ""
    # 판정 에이전트의 원본 응답에서 JSON 파싱 시도 (history에서 추출)
    history_text = final_state.get("history", "")
    judge_section = ""
    if "[최종 판정]:" in history_text:
        judge_section = history_text.split("[최종 판정]:")[-1].strip()

    parsed = parse_judge_response(judge_section if judge_section else judge_raw)

    # FinalDecision 생성
    risks = [
        RiskItem(
            category=r.get("category", "기타"),
            level=r.get("level", "medium"),
            description=r.get("description", ""),
        )
        for r in parsed.get("risks", [])
    ]

    final_decision = FinalDecision(
        verdict=parsed["verdict"],
        riskLevel=parsed["riskLevel"],
        risks=risks if risks else [
            RiskItem(category="종합 리스크", level="medium", description="AI 토론 기반 종합 평가")
        ],
        summary=parsed["summary"],
        recommendation=parsed["recommendation"],
        revisedContent=parsed.get("revisedContent", ""),
    )

    # 법제처 API 근거 수집 — 병렬 실행 결과 회수 (토론과 동시에 수행됨)
    evidences: list[EvidenceItem] = []
    try:
        if evidence_future is not None:
            evidences_raw = evidence_future.result(timeout=30)  # 최대 30초 대기
            logger.info("병렬 evidence 수집 결과 회수 완료")
        else:
            # 병렬 시작 실패 시 순차 실행 폴백
            from services.evidence_service import collect_evidences
            evidences_raw = collect_evidences(
                request.content, request.situation, request.reviewType, max_results=5
            )

        evidences = [
            EvidenceItem(
                sourceType=ev.get("sourceType", "LAW"),
                title=ev.get("title", ""),
                referenceId=ev.get("referenceId", ""),
                articleOrCourt=ev.get("articleOrCourt", ""),
                summary=ev.get("summary", ""),
                url=ev.get("url", ""),
                relevanceReason=ev.get("relevanceReason", ""),
                relevanceScore=ev.get("relevanceScore", 0),
                quotedText=ev.get("quotedText", ""),
                metadata=ev.get("metadata"),
            )
            for ev in evidences_raw
        ]
        logger.info("법령/판례 근거 %d건 수집 완료", len(evidences))
    except Exception as e:
        logger.error("법령/판례 근거 수집 실패 (분석 결과에는 영향 없음): %s", e)

    logger.info("LangGraph 토론 완료 — 메시지 %d건, 판정: %s", len(debate_messages), parsed["verdict"])

    return AnalyzeResponse(
        messages=debate_messages,
        finalDecision=final_decision,
        evidences=evidences,
    )
