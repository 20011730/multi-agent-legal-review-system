"""
규칙 기반 법률 검토 분석 모듈.
추후 로컬 LLM 또는 외부 모델 호출로 교체 가능하도록 분리.
"""

import logging
import re
from schemas import AnalyzeRequest, AnalyzeResponse, AgentMessage, FinalDecision, RiskItem, EvidenceItem
from services.evidence_service import collect_evidences

logger = logging.getLogger(__name__)


# 위험 표현 패턴 사전
RISK_PATTERNS = {
    "exaggeration": {
        "patterns": [r"1위", r"최고", r"최초", r"유일", r"압도적", r"2배", r"3배", r"\d+배",
                     r"넘버원", r"No\.?\s*1", r"독보적"],
        "label": "과장 표현",
    },
    "urgency": {
        "patterns": [r"한정", r"지금 구매", r"서둘러", r"놓치면", r"후회", r"마감 임박",
                     r"선착순", r"조기[ ]?마감", r"오늘만"],
        "label": "긴급성 조성 표현",
    },
    "comparison": {
        "patterns": [r"타사", r"경쟁사", r"구시대", r"유물", r"뒤처진", r"열등",
                     r"비교 불가", r"상대 안 됨"],
        "label": "비교/비하 표현",
    },
    "free_discount": {
        "patterns": [r"무료", r"공짜", r"할인\s*\d+%", r"사은품", r"경품", r"증정"],
        "label": "무료/할인 표현",
    },
}

# 검토 유형별 법률 참조
REVIEW_TYPE_LAWS = {
    "marketing": "표시·광고의 공정화에 관한 법률",
    "press": "자본시장법 및 공시 규정",
    "contract": "민법 및 약관의 규제에 관한 법률",
    "policy": "근로기준법 및 사내 규정 관련 법령",
    "communication": "정보통신망법 및 개인정보보호법",
    "decision": "상법 및 이사의 선관주의 의무",
}


def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """입력 데이터를 분석하여 3라운드 토론 결과와 최종 판정을 생성한다."""
    content = request.content
    review_type = request.reviewType
    situation = request.situation

    # 1. 법령/판례 근거 수집 (실패해도 분석은 계속 진행)
    evidences_raw = []
    try:
        evidences_raw = collect_evidences(content, situation, review_type, max_results=5)
        logger.info("법령/판례 근거 %d건 수집 완료", len(evidences_raw))
    except Exception as e:
        logger.error("법령/판례 근거 수집 실패 (분석은 계속 진행): %s", e)

    # evidence dict -> EvidenceItem 변환
    evidence_items = [
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

    # 2. 위험 표현 탐지
    detected = _detect_risks(content)
    risk_score = _calculate_risk_score(detected)
    law_ref = REVIEW_TYPE_LAWS.get(review_type, "관련 법령")

    # 실제 검색된 법령명이 있으면 law_ref를 보강
    law_titles = [ev.get("title", "") for ev in evidences_raw if ev.get("sourceType") == "LAW"]
    if law_titles:
        law_ref = law_titles[0]  # 가장 관련도 높은 법령명 사용

    # 3. 메시지 생성 (3라운드 × 3에이전트) — evidence 정보 반영
    messages = _generate_messages(content, situation, review_type, detected, law_ref, evidences_raw)

    # 4. 최종 판정 생성
    final_decision = _generate_final_decision(content, detected, risk_score, law_ref)

    return AnalyzeResponse(messages=messages, finalDecision=final_decision, evidences=evidence_items)


def _detect_risks(content: str) -> dict[str, list[str]]:
    """원문에서 위험 표현을 탐지한다."""
    detected = {}
    for category, info in RISK_PATTERNS.items():
        found = []
        for pattern in info["patterns"]:
            matches = re.findall(pattern, content, re.IGNORECASE)
            found.extend(matches)
        if found:
            detected[category] = found
    return detected


def _calculate_risk_score(detected: dict) -> int:
    """탐지된 위험 요소 수에 따라 점수 산정 (0~100)."""
    total = sum(len(v) for v in detected.values())
    category_count = len(detected)
    return min(100, total * 15 + category_count * 10)


def _get_risk_level(score: int) -> str:
    if score >= 60:
        return "HIGH"
    elif score >= 30:
        return "MEDIUM"
    return "LOW"


def _get_verdict(score: int) -> str:
    if score >= 60:
        return "conditional"
    elif score >= 30:
        return "conditional"
    return "approved"


def _generate_messages(
    content: str,
    situation: str,
    review_type: str,
    detected: dict,
    law_ref: str,
    evidences: "list[dict] | None" = None,
) -> list[AgentMessage]:
    """3라운드 × 3에이전트 = 9개 메시지 생성."""
    messages = []
    evidences = evidences or []

    detected_labels = [RISK_PATTERNS[k]["label"] for k in detected]
    detected_examples = []
    for v in detected.values():
        detected_examples.extend(v[:2])

    example_str = ", ".join(f"'{e}'" for e in detected_examples[:4]) if detected_examples else "특이 표현 없음"
    label_str = ", ".join(detected_labels) if detected_labels else "주요 위험 요소 미탐지"

    # 근거 참조 문자열 생성
    law_evidences = [ev for ev in evidences if ev.get("sourceType") == "LAW"]
    case_evidences = [ev for ev in evidences if ev.get("sourceType") == "CASE"]
    law_citation = law_evidences[0]["title"] if law_evidences else law_ref
    case_citation = f" 관련 판례: {case_evidences[0]['title']}({case_evidences[0].get('referenceId', '')})" if case_evidences else ""

    review_type_kr = {
        "marketing": "마케팅·광고 문구",
        "press": "보도자료·공시",
        "contract": "계약서·약관",
        "policy": "사내 규정·정책",
        "communication": "대외 커뮤니케이션",
        "decision": "경영 의사결정",
    }.get(review_type, review_type)

    has_exaggeration = "exaggeration" in detected
    has_urgency = "urgency" in detected
    has_comparison = "comparison" in detected
    has_discount = "free_discount" in detected

    # ── 라운드 1: 초기 분석 ──
    messages.append(AgentMessage(
        agentId="legal", agentName="법률 전문가",
        content=f"{law_citation}을 기준으로 분석하겠습니다. "
                f"제출된 {review_type_kr}에서 {example_str} 등의 표현이 확인됩니다. "
                f"{'객관적 근거 자료 없이 사용된 비교·과장 표현은 법적 분쟁 소지가 있습니다.' if has_exaggeration else '법률적 검토를 진행합니다.'}"
                f"{case_citation}",
        type="analysis", round=1,
        stance="CON" if has_exaggeration else "NEUTRAL",
        evidenceSummary=f"{law_citation} 위반 가능성 검토 필요"
    ))

    messages.append(AgentMessage(
        agentId="risk", agentName="리스크 관리자",
        content=f"리스크 관점에서 검토합니다. "
                f"{'비교 표현이 특정 경쟁사를 암시할 수 있어 경쟁사 대응 리스크가 존재합니다. ' if has_comparison else ''}"
                f"{'긴급성 조성 표현이 소비자 기만으로 간주될 수 있습니다. ' if has_urgency else ''}"
                f"탐지된 위험 요소: {label_str}.",
        type="analysis", round=1,
        stance="CON" if detected else "NEUTRAL",
        evidenceSummary=f"위험 요소 {len(detected)}개 카테고리 탐지"
    ))

    messages.append(AgentMessage(
        agentId="ethics", agentName="윤리 검토자",
        content=f"윤리적 관점에서 검토합니다. "
                f"{'경쟁사에 대한 비하 표현은 기업 이미지에 부정적 영향을 줄 수 있습니다. ' if has_comparison else ''}"
                f"{'소비자의 합리적 판단을 방해하는 압박적 표현이 포함되어 있습니다. ' if has_urgency else ''}"
                f"{'과장된 주장은 소비자 신뢰를 저하시킬 수 있습니다.' if has_exaggeration else '전반적인 윤리적 적절성을 평가합니다.'}",
        type="concern", round=1,
        stance="CON" if (has_comparison or has_urgency) else "NEUTRAL",
        evidenceSummary="소비자 신뢰 및 기업 윤리 관점 검토"
    ))

    # ── 라운드 2: 심화 검토 ──
    messages.append(AgentMessage(
        agentId="legal", agentName="법률 전문가",
        content=f"{'과장 광고에 해당할 가능성이 있습니다. ' if has_exaggeration else ''}"
                f"{'비교 광고 시 객관적 검증 자료가 반드시 필요합니다. 공정거래위원회 제재 사례에 비추어 볼 때 시정명령 및 과징금 부과 가능성이 있습니다.' if has_exaggeration else f'{law_citation} 관련 세부 조항을 검토한 결과, 일부 표현의 법적 적절성 확인이 필요합니다.'}"
                f"{'할인·사은품 관련 표현의 상세 조건이 명시되어야 합니다.' if has_discount else ''}"
                f"{case_citation}",
        type="concern", round=2,
        stance="CON" if has_exaggeration else "NEUTRAL",
        evidenceSummary="법적 제재 가능성 및 시정 조치 리스크"
    ))

    messages.append(AgentMessage(
        agentId="risk", agentName="리스크 관리자",
        content=f"{'허위 희소성 강조는 소비자 기만으로 간주될 수 있으며, 소비자 불만 및 환불 요구 증가 가능성이 있습니다. ' if has_urgency else ''}"
                f"{'과장된 성능 주장으로 인한 제품 신뢰도 하락 리스크가 있습니다. ' if has_exaggeration else ''}"
                f"재무적 관점에서 {'과징금 및 시정명령' if has_exaggeration else '잠재적 법적 비용'}을 고려해야 합니다.",
        type="concern", round=2,
        stance="CON" if (has_urgency or has_exaggeration) else "NEUTRAL",
        evidenceSummary="재무적 리스크 및 소비자 반발 가능성"
    ))

    messages.append(AgentMessage(
        agentId="ethics", agentName="윤리 검토자",
        content=f"소비자 자율성 존중 관점에서 심화 검토합니다. "
                f"{'압박적 표현은 소비자의 합리적 판단을 방해할 수 있습니다. ' if has_urgency else ''}"
                f"ESG 경영 측면에서 {'소비자 중심적 커뮤니케이션으로의 전환이 필요합니다.' if detected else '현재 내용은 대체로 적절하나 일부 개선 여지가 있습니다.'}",
        type="analysis", round=2,
        stance="CON" if has_urgency else "NEUTRAL",
        evidenceSummary="ESG 경영 관점 및 소비자 자율성 검토"
    ))

    # ── 라운드 3: 최종 권고 ──
    legal_recs = []
    if has_exaggeration:
        legal_recs.append("성능 비교 데이터의 출처를 명시하고 '당사 기준' 등 한정 표현을 추가하세요")
    if has_comparison:
        legal_recs.append("경쟁사 비하 표현을 삭제하고 자사 강점 중심으로 수정하세요")
    if has_discount:
        legal_recs.append("할인 및 사은품 관련 상세 조건을 명시하세요")
    if not legal_recs:
        legal_recs.append("현재 내용의 법적 적절성을 최종 확인하세요")

    messages.append(AgentMessage(
        agentId="legal", agentName="법률 전문가",
        content=f"법적 안전성 확보를 위해 다음을 권고합니다: {' '.join(f'{i+1}) {r}' for i, r in enumerate(legal_recs))}",
        type="recommendation", round=3,
        stance="CON" if detected else "PRO",
        evidenceSummary="법적 안전성 확보 권고사항"
    ))

    risk_recs = []
    if has_urgency:
        risk_recs.append("긴박감 조성 표현을 완화하고 실제 조건을 구체화하세요")
    if has_exaggeration:
        risk_recs.append("과장 표현을 객관적 데이터 기반 표현으로 교체하세요")
    risk_recs.append("사후 소비자 불만 대응 프로세스를 사전에 준비하세요")

    messages.append(AgentMessage(
        agentId="risk", agentName="리스크 관리자",
        content=f"리스크 완화 방안: {' '.join(f'{i+1}) {r}' for i, r in enumerate(risk_recs))}",
        type="recommendation", round=3,
        stance="CON" if detected else "PRO",
        evidenceSummary="리스크 완화 및 대응 방안"
    ))

    ethics_recs = ["자사 제품의 강점을 긍정적으로 표현하세요 (비교 대신 절대적 가치 강조)"]
    if has_urgency:
        ethics_recs.append("소비자 선택권을 존중하는 톤앤매너를 적용하세요")
    ethics_recs.append("공정하고 투명한 커뮤니케이션 원칙을 준수하세요")

    messages.append(AgentMessage(
        agentId="ethics", agentName="윤리 검토자",
        content=f"윤리적 개선 방안: {' '.join(f'{i+1}) {r}' for i, r in enumerate(ethics_recs))}",
        type="recommendation", round=3,
        stance="CON" if detected else "PRO",
        evidenceSummary="윤리적 커뮤니케이션 개선 권고"
    ))

    return messages


def _generate_final_decision(
    content: str,
    detected: dict,
    risk_score: int,
    law_ref: str,
) -> FinalDecision:
    """최종 판정 생성."""
    risk_level = _get_risk_level(risk_score)
    verdict = _get_verdict(risk_score)

    # 리스크 항목 생성
    risks = []
    if "exaggeration" in detected:
        risks.append(RiskItem(
            category="법률 리스크", level="high",
            description=f"{law_ref} 위반 가능성 (거짓·과장 표현)"
        ))
    else:
        risks.append(RiskItem(
            category="법률 리스크", level="low",
            description="주요 법적 위반 요소 미탐지"
        ))

    if "urgency" in detected or "free_discount" in detected:
        risks.append(RiskItem(
            category="소비자 리스크", level="medium",
            description="소비자 기만 또는 압박 마케팅 우려"
        ))
    else:
        risks.append(RiskItem(
            category="소비자 리스크", level="low",
            description="소비자 관련 리스크 낮음"
        ))

    if "comparison" in detected:
        risks.append(RiskItem(
            category="평판 리스크", level="medium",
            description="경쟁사 비하 표현으로 인한 브랜드 이미지 손상 가능성"
        ))
    else:
        risks.append(RiskItem(
            category="평판 리스크", level="low",
            description="평판 관련 리스크 낮음"
        ))

    risks.append(RiskItem(
        category="경쟁 리스크",
        level="medium" if "comparison" in detected else "low",
        description="경쟁사 분쟁 가능성" if "comparison" in detected else "경쟁 관련 리스크 낮음"
    ))

    # 요약
    detected_count = sum(len(v) for v in detected.values())
    if detected_count > 0:
        summary = (
            f"검토 대상 문구에서 {detected_count}개의 위험 표현이 탐지되었습니다. "
            f"리스크 수준은 {risk_level}이며, "
            f"{'수정 후 사용을 권고합니다.' if verdict == 'conditional' else '재검토가 필요합니다.'}"
        )
    else:
        summary = "검토 대상 문구에서 주요 위험 요소가 탐지되지 않았습니다. 사용 가능합니다."

    # 권고사항
    rec_parts = []
    if "exaggeration" in detected:
        rec_parts.append("과장 표현을 객관적 근거 기반 표현으로 교체하세요")
    if "comparison" in detected:
        rec_parts.append("경쟁사 비하 표현을 삭제하세요")
    if "urgency" in detected:
        rec_parts.append("긴박감 조성 표현을 완화하세요")
    if "free_discount" in detected:
        rec_parts.append("할인/사은품 조건을 명확히 명시하세요")
    if not rec_parts:
        rec_parts.append("현재 내용을 유지해도 됩니다")
    recommendation = ". ".join(rec_parts) + "."

    # 수정 문구 생성
    revised = _generate_revised_content(content, detected)

    return FinalDecision(
        verdict=verdict,
        riskLevel=risk_level,
        risks=risks,
        summary=summary,
        recommendation=recommendation,
        revisedContent=revised,
    )


def _generate_revised_content(content: str, detected: dict) -> str:
    """원문의 위험 표현을 완화한 수정 문구를 생성한다."""
    revised = content

    # 과장 표현 완화
    replacements = {
        r"업계\s*1위\s*(제품\s*)?보다\s*": "자체 테스트 기준 기존 대비 ",
        r"(\d+)배\s*빠른": r"약 \1배 향상된",
        r"최고의": "우수한",
        r"유일한": "차별화된",
        r"압도적(인|으로)?": "뛰어난",
        r"독보적(인|으로)?": "경쟁력 있는",
    }

    # 비교/비하 표현 제거
    removals = {
        r"타사\s*제품은\s*[^.]*유물[^.]*\.?\s*": "",
        r"타사\s*제품은\s*[^.]*뒤처진[^.]*\.?\s*": "",
        r"타사\s*제품은\s*[^.]*열등[^.]*\.?\s*": "",
        r"비교\s*불가[^.]*\.?\s*": "",
    }

    # 긴급성 표현 완화
    urgency_replacements = {
        r"한정\s*수량이므로\s*서둘러\s*주문하세요": "재고 소진 시까지 제공됩니다 (상세 조건 참조)",
        r"지금\s*구매하시면": "구매 시",
        r"이\s*기회를\s*놓치면\s*후회합니다!?": "",
        r"서둘러\s*주문하세요\.?": "",
        r"놓치면\s*후회[^.]*\.?\s*": "",
        r"마감\s*임박!?\s*": "",
    }

    for pattern, replacement in {**replacements, **removals, **urgency_replacements}.items():
        revised = re.sub(pattern, replacement, revised, flags=re.IGNORECASE)

    # 불필요한 연속 공백/느낌표 정리
    revised = re.sub(r"!+", ".", revised)
    revised = re.sub(r"\.{2,}", ".", revised)
    revised = re.sub(r"\s{2,}", " ", revised)
    revised = revised.strip()

    if revised == content:
        revised = content + "\n\n(검토 결과 수정 권고 사항 없음)"

    return revised
