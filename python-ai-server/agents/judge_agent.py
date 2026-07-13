"""
판정 에이전트 (CEO 역할).
법무와 비즈니스의 토론 결과를 종합하여 최종 판정을 내립니다.
원본: ai_hyejin_retry 브랜치 agents.py의 run_judge_agent

이 에이전트의 출력은 JSON 형식으로 파싱하여 FinalDecision 스키마에 매핑됩니다.
"""

import json
import logging
import re
from agents.llm_client import generate_with_retry  # provider=ollama (default)

logger = logging.getLogger(__name__)


def _has_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(k in text for k in keywords)


def _risk_exists(risks: list[dict], category_keywords: tuple[str, ...]) -> bool:
    hay = " ".join(
        f"{r.get('category', '')} {r.get('description', '')}"
        for r in risks
        if isinstance(r, dict)
    )
    return _has_any(hay, category_keywords)


def _fallback_decision(reason: str) -> dict:
    return {
        "verdict": "conditional",
        "riskLevel": "MEDIUM",
        "risks": [
            {
                "category": "최종 판정 형식 보정",
                "level": "medium",
                "description": "최종 판정관 응답이 요구 JSON 형식을 완전히 만족하지 않아, 토론 기록과 사용자 질문을 기준으로 보수적인 조건부 판정으로 보정했습니다.",
            }
        ],
        "summary": "최종 판정 응답 형식이 일부 맞지 않아 원문을 그대로 노출하지 않고 보수적인 조건부 검토로 정리했습니다. 토론 로그와 EvidenceCard를 함께 확인한 뒤 외주 계약, 권리 귀속, 개인정보 처리, 정산 증빙 조건을 다시 점검해야 합니다.",
        "recommendation": (
            "AI 응답 형식 보정 안내: 최종 판정 JSON을 안정적으로 해석하지 못해 보수적인 fallback 판정을 사용했습니다.\n\n"
            "즉시 수정 항목:\n"
            "- 계약서에 소스코드·산출물 귀속, 검수 기준, 비용 정산 증빙, 개인정보 처리위탁 범위를 명시하세요.\n"
            "- 부가가치세·세금계산서·지원사업비 집행 기준은 회계/세무 담당자와 집행 전 확인하세요.\n\n"
            "추후 보완 항목:\n"
            "- 재위탁 제한, 접근 권한, 보관 기간, 파기 절차, 지원금 환수 사유를 별도 조항으로 정리하세요.\n\n"
            "전문가 확인 질문:\n"
            "- 매입세액 공제 가능성과 사업비 정산 가능 항목이 동시에 충족되는지 확인이 필요합니다."
        ),
        "revisedContent": "계약서에는 산출물·소스코드 귀속, 검수 기준, 개인정보 처리위탁·재위탁 제한, 세금계산서와 계좌이체 등 정산 증빙 제출 의무를 별도 조항으로 명시합니다.",
        "_fallbackUsed": True,
        "_fallbackReason": reason,
    }


def _append_section_once(text: str, heading: str, bullets: list[str]) -> str:
    if heading in text or not bullets:
        return text
    body = "\n".join(f"- {b}" for b in bullets)
    return (text.rstrip() + f"\n\n{heading}:\n{body}").strip()


def _enrich_decision_from_context(result: dict, context_text: str) -> dict:
    """기존 FinalDecision DTO를 깨지 않고 주요 토론 쟁점을 risks/recommendation에 접어 넣는다."""
    context = context_text or ""
    risks = result.get("risks")
    if not isinstance(risks, list):
        risks = []
    normalized_risks: list[dict] = [r for r in risks if isinstance(r, dict)]

    def add_risk_if_relevant(
        detect_keywords: tuple[str, ...],
        category: str,
        level: str,
        description: str,
        category_keywords: tuple[str, ...],
    ) -> None:
        if _has_any(context, detect_keywords) and not _risk_exists(normalized_risks, category_keywords):
            normalized_risks.append({
                "category": category,
                "level": level,
                "description": description,
            })

    add_risk_if_relevant(
        ("지원금", "사업비", "정산", "환수", "증빙", "비용 불인정"),
        "지원금 정산·환수",
        "high",
        "지원사업비로 외주비나 부가가치세를 집행하려면 협약상 집행 가능 항목, 세금계산서, 계좌이체, 검수자료가 맞아야 합니다. 증빙이 누락되면 비용 불인정 또는 환수 위험이 커집니다.",
        ("지원금", "정산", "환수", "증빙"),
    )
    add_risk_if_relevant(
        ("외주", "용역", "개발자", "프리랜서", "위탁 계약"),
        "외주 계약 범위",
        "medium",
        "외주 개발 범위, 납품물, 검수 기준, 지연 책임이 불명확하면 결과물 인도와 대금 지급 시점에서 분쟁이 발생할 수 있습니다.",
        ("외주", "용역", "검수"),
    )
    add_risk_if_relevant(
        ("소스코드", "지식재산", "저작권", "산출물", "IP", "귀속"),
        "소스코드·지식재산권 귀속",
        "high",
        "소스코드와 산출물의 소유권·사용권·2차 활용 범위가 빠지면 서비스 운영, 유지보수, 지원사업 결과물 활용에서 권리 분쟁이 생길 수 있습니다.",
        ("소스코드", "지식재산", "저작권", "산출물", "IP"),
    )
    add_risk_if_relevant(
        ("개인정보", "처리위탁", "위탁", "재위탁", "접근 권한", "파기", "보관 기간"),
        "개인정보 처리위탁·재위탁",
        "high",
        "외주사가 개인정보에 접근한다면 위탁 목적, 접근 권한, 보관 기간, 파기, 재위탁 제한을 계약과 운영 절차에 명시해야 합니다.",
        ("개인정보", "처리위탁", "재위탁"),
    )
    add_risk_if_relevant(
        ("부가가치세", "부가세", "VAT", "매입세액", "세금계산서", "원천징수"),
        "부가가치세·매입세액 공제",
        "medium",
        "세금계산서 수취와 사업 관련성이 확인되지 않으면 매입세액 공제나 사업비 정산에서 다툼이 생길 수 있습니다. 조세 심판례와 세무 전문가 확인이 필요합니다.",
        ("부가가치세", "부가세", "VAT", "매입세액", "세금계산서"),
    )
    add_risk_if_relevant(
        ("일정", "마감", "지연", "납기"),
        "일정 지연",
        "medium",
        "검수 기준과 납기, 보완 횟수가 불명확하면 지원사업 마감과 결과보고 일정이 밀릴 수 있습니다.",
        ("일정", "마감", "지연", "납기"),
    )

    result["risks"] = normalized_risks[:10]
    if any(str(r.get("level", "")).lower() == "high" for r in result["risks"]):
        result["riskLevel"] = "HIGH"
    elif result.get("riskLevel") not in ("HIGH", "MEDIUM", "LOW"):
        result["riskLevel"] = "MEDIUM"

    recommendation = str(result.get("recommendation") or "").strip()
    immediate: list[str] = []
    later: list[str] = []
    docs: list[str] = []
    expert: list[str] = []
    checklist: list[str] = []

    if _has_any(context, ("소스코드", "지식재산", "산출물", "IP", "저작권")):
        immediate.append("소스코드·산출물 귀속, 사용권, 유지보수 접근권, 제3자 제공 제한을 계약 조항에 추가")
        docs.append("산출물 목록, 저장소 접근 권한, 오픈소스 사용 내역, 인수인계 기준")
    if _has_any(context, ("개인정보", "처리위탁", "재위탁", "파기", "보관 기간", "접근 권한")):
        immediate.append("개인정보 처리위탁 범위, 접근 권한, 재위탁 제한, 보관·파기 절차를 위탁계약 조항으로 분리")
        docs.append("개인정보 처리 흐름도, 위탁업무 목록, 접근 권한표, 파기 확인 양식")
    if _has_any(context, ("검수", "인도", "납품", "완료 기준")):
        immediate.append("검수 기준, 보완 횟수, 인도 형식, 지연 시 책임을 일정표와 함께 명시")
        checklist.append("검수 완료 기준과 결과물 인수 확인서를 서면으로 남김")
    if _has_any(context, ("지원금", "사업비", "정산", "환수", "증빙", "비용 불인정")):
        immediate.append("지원사업비 집행 가능 항목과 정산 증빙 제출 목록을 협약·운영지침과 대조")
        docs.append("세금계산서, 견적서, 계약서, 검수확인서, 계좌이체 내역, 결과보고 자료")
        checklist.append("증빙 누락 시 비용 불인정·환수 가능성을 사전에 사업 담당자에게 확인")
    if _has_any(context, ("부가가치세", "부가세", "VAT", "매입세액", "세금계산서")):
        expert.append("부가가치세 매입세액 공제 가능 여부와 지원사업비로 VAT를 집행할 수 있는지 세무 전문가에게 확인")
        checklist.append("세금계산서 공급자·공급받는 자, 공급가액, VAT, 지급일, 사업 관련성을 대조")
    if _has_any(context, ("재위탁", "접근 권한", "파기")):
        later.append("재위탁 승인 절차, 접근 로그 보관, 파기 증빙 제출 절차를 운영 매뉴얼에 반영")
    if _has_any(context, ("법령", "판례", "조세 심판례", "Evidence", "근거")):
        expert.append("최종 계약 체결 전 관련 법령·일반 판례·조세 심판례가 현재 사실관계에 그대로 적용되는지 확인")

    if not immediate:
        immediate.append("토론에서 확인된 핵심 쟁점을 계약서·운영 문서·증빙 목록에 반영")
    if not later:
        later.append("분쟁 발생 시 대응할 수 있도록 승인 기록, 검수 기록, 커뮤니케이션 내역을 보관")
    if not docs:
        docs.append("계약서, 견적서, 세금계산서, 검수확인서, 관련 승인 내역")
    if not expert:
        expert.append("법무·세무 전문가에게 핵심 조항과 정산 가능성을 최종 확인")
    if not checklist:
        checklist.append("계약 체결 전 권리 귀속, 비용 집행, 개인정보 처리, 증빙 제출 항목을 한 번 더 대조")

    recommendation = _append_section_once(recommendation, "즉시 수정 항목", immediate[:5])
    recommendation = _append_section_once(recommendation, "추후 보완 항목", later[:4])
    recommendation = _append_section_once(recommendation, "필수 증빙자료", docs[:6])
    recommendation = _append_section_once(recommendation, "전문가 확인 질문", expert[:4])
    recommendation = _append_section_once(recommendation, "실행 체크리스트", checklist[:5])
    result["recommendation"] = recommendation

    revised = str(result.get("revisedContent") or "").strip()
    if len(revised) < 80 and _has_any(context, ("외주", "소스코드", "개인정보", "정산", "부가가치세", "검수")):
        result["revisedContent"] = (
            "외주 계약서 보완안: 외주사는 산출물·소스코드의 인도 범위, 사용권·귀속 관계, 검수 기준과 보완 절차를 명확히 합니다. "
            "개인정보를 처리하는 경우 처리위탁 목적, 접근 권한, 보관 기간, 파기, 재위탁 제한을 별도 조항으로 두고, "
            "사업비 정산을 위해 계약서, 세금계산서, 계좌이체 내역, 검수확인서, 결과물 제출 기록을 보관합니다. "
            "부가가치세와 매입세액 공제 가능 여부는 집행 전 세무 전문가와 사업 담당기관에 확인합니다."
        )

    return result


def run_judge_agent(context_history: str, current_issue: str) -> str:
    """판정 에이전트: 양측 주장을 종합하여 최종 결정을 내린다. JSON 형식으로 응답."""
    system_instruction = """당신은 법무와 비즈니스 부서의 토론을 듣고 최종 결정을 내리는 의사결정자입니다.

판정 원칙:
0. 반드시 자연스러운 한국어로만 작성하세요. JSON key는 아래 형식을 유지하되, 값에는 영어 문장이나 영어 제목을 섞지 마세요.
   법령명, 기관명, 제품명, IP/VAT/RAG 같은 짧은 약어를 제외한 외국어 장문은 한국어로 요약하고, 깨진 문자열이나 의미 없는 기호는 출력하지 마세요.
1. Round 1~5와 라운드 사이 사용자 질문 1~4를 모두 반영하세요. 양측 주장의 단순 요약/이어붙이기는 금지. 토론 과정에서 발생한 충돌점을 명시하고
   어느 쪽 주장이 더 설득력 있는지, 또는 양쪽을 어떻게 절충할지 판단하세요.
2. summary는 2~4문장으로 토론의 핵심 충돌점 + 결론을 담아 작성하세요. 단순 한 줄 요약 금지.
3. recommendation은 "전문가 검토 필요"처럼 책임을 미루지 말고, 사용자가 바로 반영할 수 있는
   구체적 행동을 제시하세요. 반드시 아래 소제목을 포함하세요:
   "즉시 수정 항목", "추후 보완 항목", "필수 증빙자료", "전문가 확인 질문", "실행 체크리스트".
4. risks는 토론에서 실제 거론된 위험만 포함. 더미 카테고리("일반 위험" 등) 금지.
   각 risk의 description은 "어떤 법령/관행에 의해 어떤 결과가 예상되는지" 1~2문장.
5. 토론에 evidence(법령/판례 인용)가 등장했다면 risks 또는 recommendation에서 어떤 쟁점과
   연결되는지 명시하세요.
6. 첨부자료 본문이 제공된 경우 파일명만 반복하지 말고, 본문에서 확인한 특약·정산 조건·보관 기간·권리 귀속 내용을 summary, risks, recommendation 중 관련 위치에 직접 반영하세요.
7. recommendation에는 사용자 추가 질문 1~4에 대한 직접 답변을 빠짐없이 포함하세요.
8. 다음 쟁점이 토론 또는 사용자 질문에 등장했다면 반드시 risks 또는 recommendation 중 하나에 반영하세요:
   지원금 정산, 외주 계약, 소스코드 귀속, 지식재산권, 개인정보 처리위탁, 재위탁 제한,
   검수 기준, 일정 지연, VAT/부가가치세/매입세액 공제, 증빙 누락, 환수 가능성.

[★ revisedContent 작성 규칙 — 가장 중요] 보수적·안전한 표현으로 작성하세요:
- 효능/효과를 단정하는 표현 절대 금지: "정상으로 되돌려 줍니다", "치료합니다", "낫게 합니다",
  "100% 효과", "완벽히 차단", "유효 성분 농도가 높아" 등은 객관 측정/임상 근거 없으면 사용 금지.
- 의약품적 표현 금지(화장품·식품 등 비의약품 안건의 경우): 치료/예방/완화/면역/회복 등.
- 절대적·최상급 표현 금지: 최고/유일/최초/완벽/모든 등 → "주요/일부/대표" 등 상대적 표현.
- 소비자 오인 가능성이 있는 표현은 반드시 disclaimer 추가:
  "* 사용감은 개인차가 있을 수 있으며, 의약품이 아닙니다." 같은 안내 문구 포함 검토.
- 가능하면 측정 가능한 객관 근거(임상 데이터/제3자 인증/구체 수치)가 있을 때만 효과를 명시.
- 원문에서 어떤 어구를 어떤 보수적 표현으로 바꿨는지 짝지어 보이게 작성하세요.

반드시 아래 JSON 형식만 출력하세요. 다른 텍스트(설명, ``` 블록 외 텍스트)는 포함하지 마세요.

{
  "verdict": "approved 또는 conditional 또는 rejected",
  "riskLevel": "HIGH 또는 MEDIUM 또는 LOW",
  "risks": [
    {"category": "위험 카테고리명", "level": "high/medium/low", "description": "1~2문장 설명"}
  ],
  "summary": "토론 핵심 충돌점 + 결론 (2~4문장)",
  "recommendation": "즉시 수정 항목/추후 보완 항목/필수 증빙자료/전문가 확인 질문/실행 체크리스트를 포함한 실행 권고",
  "revisedContent": "보수적·안전한 수정 문안 또는 계약 조항 보완안",
  "keyIssues": ["핵심 쟁점"],
  "immediateActions": ["즉시 수정 항목"],
  "laterActions": ["추후 보완 항목"],
  "requiredDocuments": ["필수 증빙자료"],
  "expertQuestions": ["전문가 확인 질문"],
  "checklist": ["실행 체크리스트"],
  "evidenceReferences": ["근거 연결 요약"]
}

verdict 기준:
- approved: 법적 리스크가 낮고 그대로 실행 가능 (revisedContent는 빈 값 허용)
- conditional: 일부 표현 수정 후 실행 가능 (revisedContent 필수)
- rejected: 법적 리스크가 높아 실행 불가 (revisedContent는 안전한 대안 또는 빈 값)

중요: 반드시 유효한 JSON만 출력하세요. 코드 블록(```json...```)은 허용됩니다."""

    prompt = (
        f"검토 대상 안건 원문:\n{current_issue}\n\n"
        f"--- 라운드 1~5 전체 토론 내용과 사용자 개입 기록 ---\n{context_history}\n\n"
        f"위 토론에서 비즈니스 전략가와 법률 전문가가 합의한 부분/충돌하는 부분을 식별하고,\n"
        f"검토 대상 원문 표현 중 어떤 어구를 어떻게 수정해야 하는지 구체적으로 제시하되\n"
        f"수정 문안은 반드시 보수적·안전한 표현으로 작성해주세요.\n"
        f"최종 판정을 JSON으로 내려주세요."
    )

    return generate_with_retry(system_instruction, prompt, temperature=0.4)


def parse_judge_response(raw_text: str, context_text: str = "") -> dict:
    """판정 에이전트의 JSON 응답을 파싱한다. 실패 시 기본값을 반환."""
    try:
        # ```json ... ``` 블록 추출
        text = raw_text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        elif text.startswith("{") and not text.endswith("}"):
            end = text.rfind("}")
            if end > 0:
                text = text[: end + 1]

        result = json.loads(text)

        # 필수 필드 검증
        required = ["verdict", "riskLevel", "summary", "recommendation"]
        for field in required:
            if field not in result:
                raise ValueError(f"MISSING_REQUIRED_FIELDS:{field}")

        # verdict 값 정규화
        verdict = result["verdict"].lower().strip()
        if verdict not in ("approved", "conditional", "rejected"):
            verdict = "conditional"
        result["verdict"] = verdict

        # riskLevel 정규화
        risk = result["riskLevel"].upper().strip()
        if risk not in ("HIGH", "MEDIUM", "LOW"):
            risk = "MEDIUM"
        result["riskLevel"] = risk

        # risks 기본값
        if "risks" not in result or not isinstance(result["risks"], list):
            result["risks"] = []

        # revisedContent 기본값
        if "revisedContent" not in result:
            result["revisedContent"] = ""

        result["_fallbackUsed"] = False
        result["_fallbackReason"] = ""
        return _enrich_decision_from_context(result, context_text)

    except Exception as e:
        reason = "MISSING_REQUIRED_FIELDS" if "MISSING_REQUIRED_FIELDS" in str(e) else "JSON_PARSE_FAILED"
        preview = re.sub(r"\s+", " ", (raw_text or ""))[:180]
        logger.error("FINAL_VERDICT_FALLBACK_USED reason=%s detail=%s raw_preview=%s", reason, e, preview)
        return _enrich_decision_from_context(_fallback_decision(reason), context_text)
