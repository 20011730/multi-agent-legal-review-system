"""
검색된 법령/판례 결과를 관련성 기준으로 랭킹한다.
"""


def rank_evidences(
    evidences: list[dict],
    keywords: list[str],
    review_type: str,
    max_results: int = 5,
) -> list[dict]:
    """
    검색 결과를 관련성 점수 기반으로 정렬하고 상위 N개를 반환한다.

    점수 산정 기준:
    - 제목에 키워드 포함: +10점/키워드
    - 요약에 키워드 포함: +5점/키워드
    - 검토 유형과 관련된 법령: +15점
    - 법령(LAW)은 판례(CASE)보다 기본 가산: +5점
    """
    # 검토 유형별 관련 법령 매핑
    related_law_names: dict[str, list[str]] = {
        "marketing": ["표시", "광고", "공정거래", "소비자", "전자상거래"],
        "press": ["자본시장", "증권", "공시", "금융투자"],
        "contract": ["민법", "약관", "계약", "상법"],
        "policy": ["근로기준", "노동", "취업규칙", "산업안전"],
        "communication": ["정보통신", "개인정보", "데이터"],
        "decision": ["상법", "주주", "이사", "독점규제"],
    }

    type_related = related_law_names.get(review_type, [])
    scored = []

    for ev in evidences:
        score = 0
        title = ev.get("title", "")
        summary = ev.get("summary", "")

        # 키워드 매칭 점수
        for kw in keywords:
            if kw in title:
                score += 10
            if kw in summary:
                score += 5

        # 검토 유형 관련 법령 보너스
        for related in type_related:
            if related in title:
                score += 15
                break

        # 소스 타입 보너스
        if ev.get("sourceType") == "LAW":
            score += 5

        scored.append((score, ev))

    # 점수 내림차순 정렬
    scored.sort(key=lambda x: x[0], reverse=True)

    # 상위 결과에 relevanceReason 추가
    results = []
    for score, ev in scored[:max_results]:
        ev_copy = dict(ev)
        ev_copy["relevanceScore"] = score
        ev_copy["relevanceReason"] = _build_relevance_reason(ev, keywords, type_related)
        results.append(ev_copy)

    return results


def _build_relevance_reason(
    evidence: dict,
    keywords: list[str],
    type_related: list[str],
) -> str:
    """관련성 사유 텍스트를 생성한다."""
    title = evidence.get("title", "")
    reasons = []

    # 매칭된 키워드 찾기
    matched_keywords = [kw for kw in keywords if kw in title]
    if matched_keywords:
        reasons.append(f"검토 내용의 키워드 '{', '.join(matched_keywords)}'와 관련")

    # 법령 유형 관련성
    matched_type = [r for r in type_related if r in title]
    if matched_type:
        reasons.append(f"검토 유형 관련 법령 ({', '.join(matched_type)})")

    source_type = evidence.get("sourceType", "")
    if source_type == "LAW":
        reasons.append("관련 법령")
    elif source_type == "CASE":
        reasons.append("관련 판례")

    return ". ".join(reasons) if reasons else "검색 결과 기반 참고 자료"
