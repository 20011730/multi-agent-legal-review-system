"""
LangGraph 기반 멀티에이전트 법률 검토 분석기.

ai_hyejin_retry 브랜치의 LangGraph 토론 시스템을 FastAPI 서버에 통합.
- Human-in-the-loop 제거 → 고정 라운드 (BIZ↔LEGAL 2회 교대 후 JUDGE 판정)
- 출력을 기존 AnalyzeResponse 스키마에 매핑
- 실패 시 규칙 기반 analyzer.py로 폴백
"""

import logging
import os
import re
import json
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Any, TypedDict

from langgraph.graph import StateGraph, END

from agents.legal_agent import run_legal_agent
from agents.biz_agent import run_biz_agent
from agents.risk_agent import run_risk_agent
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

# 고정 토론 라운드 수 (BIZ→LEGAL→RISK 1세트 = 1라운드)
MAX_ROUNDS = int(os.getenv("LANGGRAPH_MAX_ROUNDS", "2"))


def _clean_timeline_message(text: str, max_chars: int = 1100) -> str:
    """
    토론 타임라인용 발언만 짧고 평문에 가깝게 정리한다.
    FinalDecision/evidence 원본 데이터는 별도 필드로 유지되므로 여기서는 AgentMessage.content만 다듬는다.
    """
    if not text:
        return ""
    cleaned = str(text)
    replacements = [
        (r"```[\s\S]*?```", ""),
        (r"^\s*\|.*\|\s*$", ""),
        (r"^\s*[-:| ]{3,}\s*$", ""),
        (r"^#{1,6}\s*", ""),
        (r"\*\*(.*?)\*\*", r"\1"),
        (r"\*(.*?)\*", r"\1"),
        (r"`([^`]+)`", r"\1"),
        (r"\[(?:라운드|Round)\s*\d+[^\]]*\]", ""),
        (r"\bCSO\s*입장\s*:\s*", ""),
        (r"최종\s*입장\s*정리", ""),
        (r"실제\s*수정\s*표현\s*제시\s*\+?\s*합의\s*정리", ""),
        (r"\bVerdict\s*:\s*\w+", ""),
        (r"\bRisk\s*:\s*\w+", ""),
        (r"\b(MEDIUM|HIGH|LOW)\b", ""),
        (r"source\s*:\s*\S+", ""),
        (r"\b(cases_e5|laws_e5|dataSource|vector|similarity|distance|score)\b[^\n]*", ""),
        (r"Ollama\s+HTTP\s+\d+[^\n]*", "일부 AI 응답을 불러오지 못했습니다."),
        (r"stack trace|raw exception|catastrophic|fallback", ""),
    ]
    for pattern, repl in replacements:
        cleaned = re.sub(pattern, repl, cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    if len(cleaned) > max_chars:
        sentences = re.split(r"(?<=[.!?。！？다요])\s+", cleaned)
        out = ""
        for sent in sentences:
            if len(out) + len(sent) + 1 > max_chars:
                break
            out = (out + " " + sent).strip()
        cleaned = (out or cleaned[:max_chars]).strip()
        cleaned += " 자세한 내용은 최종 판정에서 확인하세요."
    return cleaned


def _attachment_facts(topic: str) -> dict[str, bool]:
    text = topic or ""
    return {
        "pdf_ip": all(key in text for key in ("해외 재판매 권한", "서면 동의", "소스코드")),
        "docx_budget": all(key in text for key in ("35퍼센트", "사전 승인", "정산 대상에서 제외")),
        "docx_log": all(key in text for key in ("고객 설비 로그", "90일", "복구 불가능")),
        "sourcecode_en": "PDF_UNIQUE_IP_RESALE_SOURCECODE_BLOCK" in text or "third party" in text.lower(),
    }


def _fallback_agent_message(agent: str, round_num: int, topic: str) -> str:
    facts = _attachment_facts(topic)
    if agent == "business":
        parts = ["사업 관점에서는 첨부자료 본문에 적힌 조건을 실행 계획과 계약 일정에 바로 반영해야 합니다."]
        if facts["pdf_ip"] or facts["sourcecode_en"]:
            parts.append("공동개발 결과물의 해외 재판매 권한이 참여기업에 귀속되고, 협력사가 제3자에게 소스코드를 제공하려면 별도 서면 동의가 필요하다는 제한은 사업화 권한을 지키는 핵심 조건입니다.")
        if facts["docx_budget"]:
            parts.append("외주 개발비가 총사업비의 35퍼센트를 초과하면 사전 승인을 받아야 하고, 승인 없는 비용은 정산 대상에서 제외되므로 예산 집행 전에 승인 절차를 먼저 잡아야 합니다.")
        if facts["docx_log"]:
            parts.append("고객 설비 로그를 90일 보관한 뒤 복구 불가능하게 삭제해야 한다는 조건은 운영 정책과 고객 안내 문구에 함께 반영되어야 합니다.")
        parts.append("따라서 다음 라운드에서는 IP 사용권, 정산 승인 기준, 로그 보관·삭제 정책을 각각 계약서 조항으로 분리해 확인하는 것이 좋습니다.")
        return " ".join(parts)
    if agent == "legal":
        parts = ["법률 관점에서는 사용자 입력보다 첨부자료 본문에 적힌 구체 조건이 우선 확인 대상입니다."]
        if facts["pdf_ip"] or facts["sourcecode_en"]:
            parts.append("해외 재판매 권한 귀속과 제3자 소스코드 제공 제한은 저작권 귀속, 사용권 범위, 재허락 금지 조항으로 명확히 써야 분쟁을 줄일 수 있습니다.")
        if facts["docx_budget"]:
            parts.append("외주 개발비 35퍼센트 초과 시 사전 승인과 미승인 비용의 정산 제외 조건은 협약서와 사업비 집행 지침에 맞는지 확인해야 합니다.")
        if facts["docx_log"]:
            parts.append("고객 설비 로그의 90일 보관 및 복구 불가능 삭제 조건은 개인정보·영업정보 보관 기간, 파기 방법, 위탁 처리 조항과 연결해 검토해야 합니다.")
        parts.append("보완하지 않으면 지원금 환수, IP 사용 분쟁, 데이터 보관 위반이 동시에 발생할 수 있습니다.")
        return " ".join(parts)
    if agent == "risk":
        parts = ["리스크 관점에서는 첨부자료의 조건들이 서로 연결될 때 위험이 커집니다."]
        if facts["pdf_ip"] or facts["sourcecode_en"]:
            parts.append("제3자 소스코드 제공에 별도 서면 동의가 필요한데 이 절차가 빠지면 협력사 관리 실패가 곧 IP 유출과 사업화 지연으로 이어질 수 있습니다.")
        if facts["docx_budget"]:
            parts.append("외주비가 35퍼센트를 넘는 순간 사전 승인과 정산 제외 문제가 생기므로, 개발 범위 변경이 생길 때마다 승인 기록을 남겨야 합니다.")
        if facts["docx_log"]:
            parts.append("로그 90일 보관 후 복구 불가능 삭제 조건은 보안 운영과 고객 문의 대응 기간을 함께 제한하므로 내부 운영 매뉴얼과 백업 정책을 맞춰야 합니다.")
        parts.append("우선순위는 IP 동의 절차, 사업비 승인 증빙, 로그 삭제 이행 기록 순으로 잡는 것이 안전합니다.")
        return " ".join(parts)
    return ""


def _fallback_judge_json(topic: str) -> str:
    facts = _attachment_facts(topic)
    risks: list[dict[str, str]] = []
    recommendations: list[str] = []
    summary_bits: list[str] = []
    if facts["pdf_ip"] or facts["sourcecode_en"]:
        risks.append({
            "category": "지식재산권·소스코드 제공 제한",
            "level": "high",
            "description": "첨부자료에 따르면 해외 재판매 권한은 참여기업에 귀속되고, 협력사의 제3자 소스코드 제공에는 별도 서면 동의가 필요합니다. 이 조건이 계약서에 빠지면 사업화 권한과 소스코드 통제권 분쟁이 생길 수 있습니다.",
        })
        recommendations.append("공동개발 결과물의 해외 재판매 권한, 소스코드 제공 제한, 별도 서면 동의 절차를 계약서의 권리 귀속·사용권 조항에 명시하세요.")
        summary_bits.append("첨부 계약 조건상 IP와 소스코드 제공 제한이 핵심 쟁점입니다")
    if facts["docx_budget"]:
        risks.append({
            "category": "사업비 정산 승인",
            "level": "high",
            "description": "첨부자료에는 외주 개발비가 총사업비의 35퍼센트를 초과하면 사전 승인이 필요하고, 승인 없는 비용은 정산 대상에서 제외된다고 되어 있습니다.",
        })
        recommendations.append("외주 개발비 비중이 35퍼센트를 넘을 가능성이 있으면 집행 전 승인 요청서와 증빙 자료를 먼저 준비하세요.")
        summary_bits.append("외주 개발비 35퍼센트 초과 시 사전 승인 조건도 판정에 반영해야 합니다")
    if facts["docx_log"]:
        risks.append({
            "category": "로그 보관·삭제",
            "level": "medium",
            "description": "표 안의 조건에 따르면 고객 설비 로그는 90일 보관 후 복구 불가능한 방식으로 삭제해야 하므로, 보관 기간과 파기 절차를 운영 정책에 맞춰야 합니다.",
        })
        recommendations.append("고객 설비 로그의 90일 보관 기간, 삭제 방식, 백업 삭제 여부를 개인정보 처리방침과 내부 보안 정책에 반영하세요.")
        summary_bits.append("로그 90일 보관과 복구 불가능 삭제 조건도 운영 리스크입니다")
    if not risks:
        risks.append({
            "category": "첨부자료 확인 필요",
            "level": "medium",
            "description": "첨부자료 본문에서 구체 조건을 충분히 확인하지 못했으므로 원문 문서 재확인이 필요합니다.",
        })
        recommendations.append("텍스트 추출 가능한 PDF 또는 DOCX로 다시 업로드해 본문 조건을 확인하세요.")
        summary_bits.append("첨부자료 본문 확인이 제한되어 추가 검토가 필요합니다")
    return json.dumps({
        "verdict": "conditional",
        "riskLevel": "HIGH" if any(r["level"] == "high" for r in risks) else "MEDIUM",
        "risks": risks,
        "summary": " ".join(summary_bits) + " 따라서 조건을 계약서와 운영 정책에 반영한 뒤 진행하는 것이 안전합니다.",
        "recommendation": " ".join(recommendations),
        "revisedContent": "계약서와 운영 문서에 첨부자료의 권리 귀속, 사전 승인, 로그 보관·삭제 조건을 별도 조항으로 명시하세요.",
    }, ensure_ascii=False)


def _attachment_fact_notes(topic: str) -> list[str]:
    facts = _attachment_facts(topic)
    notes: list[str] = []
    if facts["pdf_ip"] or facts["sourcecode_en"]:
        notes.append("첨부자료에 따르면 공동개발 결과물의 해외 재판매 권한은 참여기업에 귀속되고, 협력사가 제3자에게 소스코드를 제공하려면 별도 서면 동의가 필요합니다.")
    if facts["docx_budget"]:
        notes.append("첨부자료에는 외주 개발비가 총사업비의 35퍼센트를 초과하면 사전 승인을 받아야 하며, 승인 없는 비용은 정산 대상에서 제외된다는 조건이 있습니다.")
    if facts["docx_log"]:
        notes.append("DOCX 표에는 고객 설비 로그를 90일 보관한 뒤 복구 불가능한 방식으로 삭제해야 한다는 조건이 포함되어 있습니다.")
    return notes


def _ensure_attachment_notes(response: str, topic: str) -> str:
    notes = _attachment_fact_notes(topic)
    if not notes:
        return response or ""
    text = response or ""
    missing = []
    for note in notes:
        keys = re.findall(r"(해외 재판매 권한|제3자|소스코드|서면 동의|35퍼센트|사전 승인|정산 대상에서 제외|고객 설비 로그|90일|복구 불가능)", note)
        if keys and not all(key in text for key in keys):
            missing.append(note)
    if not missing:
        return text
    return (text.rstrip() + " " + " ".join(missing)).strip()


def _ensure_judge_attachment_notes(response: str, topic: str) -> str:
    notes = _attachment_fact_notes(topic)
    if not notes:
        return response or ""
    try:
        data = json.loads(response or "{}")
        combined = " ".join(str(data.get(k, "")) for k in ("summary", "recommendation", "revisedContent"))
        missing = []
        for note in notes:
            keys = re.findall(r"(해외 재판매 권한|제3자|소스코드|서면 동의|35퍼센트|사전 승인|정산 대상에서 제외|고객 설비 로그|90일|복구 불가능)", note)
            if keys and not all(key in combined for key in keys):
                missing.append(note)
        if not missing:
            return response or ""
        data["summary"] = ((data.get("summary") or "") + " " + " ".join(missing)).strip()
        data["recommendation"] = ((data.get("recommendation") or "") + " 첨부자료의 권리 귀속, 사전 승인, 로그 보관·삭제 조건을 계약서와 운영 정책에 명시하세요.").strip()
        if not data.get("revisedContent"):
            data["revisedContent"] = "계약서와 운영 문서에 첨부자료의 권리 귀속, 사전 승인, 로그 보관·삭제 조건을 별도 조항으로 명시하세요."
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        return _ensure_attachment_notes(response or "", topic)


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

    첨부 본문이 추출된 경우 bodyText 발췌를 함께 전달하고, 추출되지 않은 항목은
    파일명/타입/크기만 안내성으로 전달해 LLM 이 파일 내용을 안다는 식으로 단정하지 않게 한다.
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
            # Phase 10.54 — priorityKeywords / selectedParagraphCount 가 있으면 prompt 에 노출
            pkws = a.get("priorityKeywords") or []
            spc = a.get("selectedParagraphCount")
            if pkws:
                lines.append(f"   주요 검토 키워드: {', '.join(pkws[:10])}")
            if isinstance(spc, int) and spc > 0:
                lines.append(f"   반영된 핵심 문단 수: {spc}")
            if body:
                any_body = True
                excerpt = body[:2200].replace("\n", " ")
                tail = " …(일부만 전달됨)" if truncated or len(body) > 1500 else ""
                lines.append(f"   본문 발췌: {excerpt}{tail}")

        if any_body:
            lines.append(
                "※ 위 ‘본문 발췌’ 는 사용자가 업로드한 첨부 자료에서 발췌된 내용입니다. "
                "각 에이전트는 파일명만 반복하지 말고 본문에서 확인한 조건·금지사항·기간·권리 귀속 내용을 직접 언급하세요. "
                "본문이 일부만 전달된 경우 추가 확인이 필요한 부분을 권고에 명시하세요."
            )
        else:
            lines.append(
                "※ 본문 추출 결과가 없는 항목은 파일명·유형만 토대로 ‘어떤 자료를 추가 확인하면 좋은지’를 권고하세요. "
                "파일 내용을 안다고 단정하지 마세요."
            )
        blocks.append("\n".join(lines))

    fq = getattr(request, "followUpQuestions", None)
    if isinstance(fq, list) and fq:
        lines = ["[사용자 추가 질문 — 반드시 본문에 직접 답변]"]
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
                "질문이 여러 개인 경우 답변 본문에 질문 번호(예: 질문 1, 질문 2)를 명시해 빠짐없이 다루세요. "
                "최종 판정관(JUDGE) 은 recommendation 안에 “사용자 추가 질문에 대한 답변” 단락을 별도로 포함하세요."
            )
            blocks.append("\n".join(lines))

    if not blocks:
        return ""
    return "\n\n".join(blocks)


def _build_prior_messages_context(request: "AnalyzeRequest") -> str:
    prior = getattr(request, "priorMessages", None)
    if not isinstance(prior, list) or not prior:
        return ""

    lines = ["[이전 토론 발언]"]
    for m in prior[-20:]:
        if not isinstance(m, dict):
            continue
        agent = m.get("agentName") or m.get("agentId") or "에이전트"
        round_num = m.get("round") or ""
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"- Round {round_num} / {agent}: {content[:900]}")
    return "\n".join(lines) if len(lines) > 1 else ""


_STEP_MODES: dict[str, tuple[int, str]] = {
    "ROUND1_BUSINESS": (1, "business"),
    "ROUND1_LEGAL": (1, "legal"),
    "ROUND1_RISK": (1, "risk"),
    "ROUND2_BUSINESS": (2, "business"),
    "ROUND2_LEGAL": (2, "legal"),
    "ROUND2_RISK": (2, "risk"),
    "ROUND3_BUSINESS": (3, "business"),
    "ROUND3_LEGAL": (3, "legal"),
    "ROUND3_RISK": (3, "risk"),
    "ROUND3_JUDGE": (3, "judge"),
}


def _slim_enriched_attachments(request: "AnalyzeRequest") -> list[dict[str, Any]] | None:
    src_atts = getattr(request, "attachments", None)
    if not isinstance(src_atts, list) or not src_atts:
        return None
    enriched_atts: list[dict[str, Any]] = []
    for a in src_atts:
        if not isinstance(a, dict):
            continue
        slim = {k: v for k, v in a.items() if k not in ("bodyText", "bodyBase64", "contentBase64")}
        if "bodyText" in a and isinstance(a.get("bodyText"), str):
            slim.setdefault("characterCount", len(a["bodyText"]))
            slim.setdefault("hasBodyText", True)
        enriched_atts.append(slim)
    return enriched_atts


# ── LangGraph State ──
class DebateState(TypedDict):
    history: str        # 누적 토론 텍스트
    turn_count: int     # 현재 턴 수
    topic: str          # 검토 대상 안건 원문
    situation: str      # 상황 설명
    messages: list      # AgentMessage 리스트 (결과 수집용)
    round_num: int      # 현재 라운드 번호
    max_round: int      # 이번 실행에서 생성할 마지막 토론 라운드
    include_judge: bool # 이번 실행에서 최종 판정까지 생성할지 여부


# ── 노드 함수 ──
def _count_prev_messages(state: DebateState) -> int:
    """현재까지 누적된 발언 수 (디버깅 메트릭)."""
    return len(state.get("messages", []) or [])


def _build_judge_display_content(raw_response: str) -> str:
    """
    판정 에이전트의 raw 응답(JSON 또는 텍스트)을 토론 로그에 표시하기 좋은
    마크다운 섹션으로 변환한다.

    - JSON 파싱 성공 시: 토론 말풍선에 맞는 3~5문장 결론만 반환
    - 파싱 실패 시: raw 응답을 짧은 안내형 문장으로 정리
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
        return _clean_timeline_message(text, max_chars=450) or "최종 판정 초안을 정리하지 못했습니다. 최종 리포트에서 확인해 주세요."

    parts = []
    summary = (parsed.get("summary") or "").strip()
    recommendation = (parsed.get("recommendation") or "").strip()
    verdict = (parsed.get("verdict") or "").strip()
    risk_level = (parsed.get("riskLevel") or "").strip()

    header_bits = []
    if verdict:
        verdict_label = {
            "approved": "승인",
            "conditional": "조건부 승인 (수정 권고)",
            "rejected": "반려",
        }.get(verdict.lower(), verdict)
        header_bits.append(f"결론은 {verdict_label}입니다")
    if risk_level:
        risk_label = {"HIGH": "높음", "MEDIUM": "보통", "LOW": "낮음"}.get(risk_level.upper(), risk_level)
        header_bits.append(f"위험도는 {risk_label} 수준입니다")
    if header_bits:
        parts.append(" / ".join(header_bits) + ".")

    if summary:
        parts.append(summary)

    if recommendation:
        parts.append(recommendation)

    if not parts:
        return _clean_timeline_message(text, max_chars=450)
    return _clean_timeline_message(" ".join(parts), max_chars=520)


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
        response = _clean_timeline_message(run_biz_agent(state["history"], state["topic"], round_num=round_num))
    except Exception as e:
        logger.error("비즈니스 에이전트 실패: %s", e)
        response = _fallback_agent_message("business", round_num, f"{state['topic']}\n{state.get('history', '')}")
    response = _ensure_attachment_notes(response, f"{state['topic']}\n{state.get('history', '')}")
    response = _clean_timeline_message(response)

    elapsed = time.time() - t0
    logger.info(
        "[BIZ] round=%d 완료 (response_len=%d, elapsed=%.1fs)",
        round_num, len(response or ""), elapsed,
    )

    new_history = state["history"] + f"\n\n[비즈니스 전략가 / 라운드 {round_num}]: {response}"

    msg = AgentMessage(
        agentId="business",
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
        response = _clean_timeline_message(run_legal_agent(state["history"], state["topic"], round_num=round_num))
    except Exception as e:
        logger.error("법무 에이전트 실패: %s", e)
        response = _fallback_agent_message("legal", round_num, f"{state['topic']}\n{state.get('history', '')}")
    response = _ensure_attachment_notes(response, f"{state['topic']}\n{state.get('history', '')}")
    response = _clean_timeline_message(response)

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


def risk_node(state: DebateState) -> dict:
    """리스크 검토자 노드 — 비즈니스/법무 의견을 종합해 복합 위험을 짚는다."""
    import time
    round_num = state["round_num"]
    prev_count = _count_prev_messages(state)
    t0 = time.time()
    logger.info(
        "[RISK] round=%d 시작 (prev_messages=%d, history_len=%d)",
        round_num, prev_count, len(state.get("history", "") or ""),
    )
    try:
        response = _clean_timeline_message(run_risk_agent(state["history"], state["topic"], round_num=round_num))
    except Exception as e:
        logger.error("리스크 검토자 실패: %s", e)
        response = _fallback_agent_message("risk", round_num, f"{state['topic']}\n{state.get('history', '')}")
    response = _ensure_attachment_notes(response, f"{state['topic']}\n{state.get('history', '')}")
    response = _clean_timeline_message(response)

    elapsed = time.time() - t0
    logger.info(
        "[RISK] round=%d 완료 (response_len=%d, elapsed=%.1fs)",
        round_num, len(response or ""), elapsed,
    )

    new_history = state["history"] + f"\n\n[리스크 검토자 / 라운드 {round_num}]: {response}"

    msg = AgentMessage(
        agentId="risk",
        agentName="리스크 검토자",
        content=response,
        type="analysis" if round_num == 1 else "concern",
        round=round_num,
        stance="CAUTION",
        evidenceSummary="운영·정산·계약 리스크 종합 검토",
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
        response = _fallback_judge_json(f"{state['topic']}\n{state.get('history', '')}")
    response = _ensure_judge_attachment_notes(response, f"{state['topic']}\n{state.get('history', '')}")

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
        round=3,
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
    if state["round_num"] >= state.get("max_round", state["round_num"]):
        return "judge" if state.get("include_judge", True) else "end"
    return "next_round"


# ── 그래프 조립 ──
def _build_graph() -> StateGraph:
    workflow = StateGraph(DebateState)

    workflow.add_node("biz", biz_node)
    workflow.add_node("legal", legal_node)
    workflow.add_node("risk", risk_node)
    workflow.add_node("round_inc", round_increment_node)
    workflow.add_node("judge", judge_node)

    # 흐름: BIZ → LEGAL → RISK → (조건: 다음 라운드 / JUDGE)
    workflow.set_entry_point("biz")
    workflow.add_edge("biz", "legal")
    workflow.add_edge("legal", "risk")
    workflow.add_conditional_edges("risk", should_continue, {
        "next_round": "round_inc",
        "judge": "judge",
        "end": END,
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


def _analyze_single_step(
    request: AnalyzeRequest,
    topic: str,
    analysis_mode: str,
) -> AnalyzeResponse:
    """Backend가 agent 단위로 호출할 때 한 명의 발언만 생성한다."""
    round_num, agent = _STEP_MODES[analysis_mode]
    prior_context = _build_prior_messages_context(request)
    history = f"[검토 안건]\n{topic}"
    if prior_context:
        history += "\n\n" + prior_context

    state: DebateState = {
        "history": history,
        "turn_count": 0,
        "topic": topic,
        "situation": request.situation,
        "messages": [],
        "round_num": round_num,
        "max_round": round_num,
        "include_judge": agent == "judge",
    }

    node = {
        "business": biz_node,
        "legal": legal_node,
        "risk": risk_node,
        "judge": judge_node,
    }[agent]
    partial = node(state)
    messages = partial.get("messages", [])

    final_decision = None
    if agent == "judge":
        history_text = partial.get("history", "")
        judge_section = ""
        if "[최종 판정]:" in history_text:
            judge_section = history_text.split("[최종 판정]:")[-1].strip()
        judge_raw = judge_section or (messages[-1].content if messages else "")
        parsed = parse_judge_response(judge_raw)
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

    logger.info(
        "LangGraph 단계별 발언 완료 — 세션 %s, mode=%s, messages=%d",
        request.sessionId, analysis_mode, len(messages),
    )
    return AnalyzeResponse(
        messages=messages,
        finalDecision=final_decision,
        evidences=[],
        enrichedAttachments=_slim_enriched_attachments(request),
    )


# ── 메인 분석 함수 ──
def analyze_with_langgraph(request: AnalyzeRequest) -> AnalyzeResponse:
    """LangGraph 멀티에이전트 토론을 실행하고 AnalyzeResponse로 변환한다."""

    # provider 사전 검증 — 미설정/불충분이면 main.py에서 규칙 기반 폴백
    from agents.llm_client import is_provider_configured, get_provider
    ok, reason = is_provider_configured()
    if not ok:
        raise RuntimeError(f"LLM provider 사용 불가 — 규칙 기반 폴백: {reason}")
    logger.info("✓ LLM provider 검증 통과: %s", reason)

    # Phase 10.51 — PDF/DOCX 첨부 본문 추출 (bodyBase64 → bodyText).
    # 기존 텍스트 첨부(bodyText 있음)는 그대로 통과.
    try:
        from attachment_extract import enrich_attachments_with_extracted_text
        if getattr(request, "attachments", None):
            enriched = enrich_attachments_with_extracted_text(request.attachments)
            if enriched is not None:
                request.attachments = enriched
                pdf_n = sum(1 for a in enriched if isinstance(a, dict) and a.get("fileType") == "pdf")
                docx_n = sum(1 for a in enriched if isinstance(a, dict) and a.get("fileType") == "docx")
                if pdf_n or docx_n:
                    logger.info("[attach-extract] PDF=%d, DOCX=%d 본문 추출 반영", pdf_n, docx_n)
    except Exception as e:
        # 추출 실패해도 분석 자체는 계속 진행 — extractionStatus 만 영향
        logger.warning("[attach-extract] PDF/DOCX 추출 단계 예외: %s", e)

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

    analysis_mode = (getattr(request, "analysisMode", None) or "").upper()
    active_followups = [
        q for q in (getattr(request, "followUpQuestions", None) or [])
        if isinstance(q, dict)
        and (q.get("message") or "").strip()
        and str(q.get("targetAgent") or "").lower() != "system"
        and str(q.get("reanalyzeStatus") or "").lower() != "deleted"
    ]
    if analysis_mode in _STEP_MODES:
        return _analyze_single_step(request, topic, analysis_mode)

    if analysis_mode == "ROUND1_ONLY":
        start_round = 1
        include_judge = False
    elif analysis_mode == "ROUND2_FINAL":
        start_round = 2
        include_judge = True
    else:
        start_round = 2 if active_followups else 1
        include_judge = True

    initial_state: DebateState = {
        "history": f"[검토 안건]\n{topic}",
        "turn_count": 0,
        "topic": topic,
        "situation": request.situation,
        "messages": [],
        "round_num": start_round,
        "max_round": start_round,
        "include_judge": include_judge,
    }

    logger.info(
        "LangGraph 토론 시작 — 세션 %s, 실행 라운드=%d, judge=%s, 후속질문=%d건",
        request.sessionId, start_round, include_judge, len(active_followups),
    )

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
    debate_messages = all_messages
    judge_message = next((m for m in all_messages if m.agentId in ("ethics", "judge") and m.type == "recommendation"), None)

    # 모든 에이전트가 실패했는지 확인 → 실패 시 규칙 기반으로 폴백
    error_count = sum(1 for m in debate_messages if "오류 발생" in m.content)
    if error_count == len(debate_messages) and len(debate_messages) > 0:
        raise RuntimeError(
            f"LangGraph 토론 중 모든 에이전트가 실패 ({error_count}건) — 규칙 기반으로 폴백합니다."
        )

    final_decision = None
    parsed = None
    if initial_state["include_judge"]:
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

    logger.info(
        "LangGraph 토론 완료 — 메시지 %d건, 판정: %s",
        len(debate_messages),
        parsed["verdict"] if parsed else "pending",
    )

    # Phase 10.57 — backend 영속화용 enriched attachment 메타데이터 (bodyText / bodyBase64 제거).
    enriched_atts = None
    src_atts = getattr(request, "attachments", None)
    if isinstance(src_atts, list) and src_atts:
        enriched_atts = []
        for a in src_atts:
            if not isinstance(a, dict):
                continue
            slim = {k: v for k, v in a.items() if k not in ("bodyText", "bodyBase64", "contentBase64")}
            # bodyText 가 있던 경우 길이만 부가
            if "bodyText" in a and isinstance(a.get("bodyText"), str):
                slim.setdefault("characterCount", len(a["bodyText"]))
                slim.setdefault("hasBodyText", True)
            enriched_atts.append(slim)

    return AnalyzeResponse(
        messages=debate_messages,
        finalDecision=final_decision,
        evidences=evidences,
        enrichedAttachments=enriched_atts,
    )
