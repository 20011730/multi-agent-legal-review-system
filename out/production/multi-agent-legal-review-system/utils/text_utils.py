"""
텍스트에서 키워드 추출 및 전처리 유틸리티.
"""

import re

# 검토 유형별 검색 키워드 매핑
REVIEW_TYPE_KEYWORDS: dict[str, list[str]] = {
    "marketing": ["표시광고", "광고", "소비자보호", "과장광고", "부당광고", "공정거래"],
    "press": ["공시", "자본시장", "증권", "보도자료", "기업공시", "금융투자"],
    "contract": ["계약", "약관", "민법", "계약해지", "손해배상", "약관규제"],
    "policy": ["근로기준", "취업규칙", "사내규정", "노동", "인사", "근로조건"],
    "communication": ["정보통신", "개인정보", "개인정보보호", "정보통신망", "데이터"],
    "decision": ["상법", "이사회", "선관주의", "경영판단", "주주", "기업지배"],
}

# 법률 도메인 불용어 (검색에서 제외)
STOP_WORDS = {
    "있습니다", "합니다", "입니다", "하는", "되는", "위한", "대한", "통한",
    "으로", "에서", "까지", "부터", "에게", "이는", "것은", "수가",
    "그리고", "하지만", "따라서", "또한", "그러나", "때문에",
    "매우", "정말", "아주", "굉장히", "상당히",
}


def extract_keywords(
    content: str,
    situation: str,
    review_type: str,
    max_keywords: int = 5,
) -> list[str]:
    """
    입력 텍스트에서 검색에 사용할 핵심 키워드를 추출한다.

    1. 검토 유형에 맞는 도메인 키워드를 기본으로 포함
    2. 원문 + 상황설명에서 명사/핵심어를 추출
    3. 불용어 제거 후 빈도 기반 정렬
    """
    keywords = []

    # 1. 검토 유형별 기본 키워드 (상위 2개)
    type_keywords = REVIEW_TYPE_KEYWORDS.get(review_type, [])
    keywords.extend(type_keywords[:2])

    # 2. 원문 + 상황설명에서 키워드 추출
    combined = f"{situation} {content}"
    extracted = _extract_noun_like_tokens(combined)

    # 3. 중복 제거하며 추가
    seen = set(keywords)
    for kw in extracted:
        if kw not in seen and len(kw) >= 2:
            keywords.append(kw)
            seen.add(kw)
        if len(keywords) >= max_keywords:
            break

    return keywords


def _extract_noun_like_tokens(text: str) -> list[str]:
    """
    간단한 규칙 기반 명사/핵심어 추출.
    형태소 분석기 없이도 동작하도록 패턴 기반으로 처리한다.
    """
    # 한글 단어 추출 (2글자 이상)
    tokens = re.findall(r"[가-힣]{2,}", text)

    # 불용어 제거
    tokens = [t for t in tokens if t not in STOP_WORDS]

    # 빈도 계산
    freq: dict[str, int] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1

    # 빈도 내림차순 정렬
    sorted_tokens = sorted(freq.keys(), key=lambda x: freq[x], reverse=True)

    return sorted_tokens


def build_search_queries(
    keywords: list[str],
    review_type: str,
) -> list[str]:
    """
    키워드를 검색 쿼리로 변환한다.
    여러 쿼리를 생성해서 다양한 결과를 확보한다.
    """
    queries = []

    # 쿼리 1: 검토 유형 키워드 기반
    type_keywords = REVIEW_TYPE_KEYWORDS.get(review_type, [])
    if type_keywords:
        queries.append(type_keywords[0])

    # 쿼리 2: 추출 키워드 중 상위 2개 조합
    content_keywords = [k for k in keywords if k not in type_keywords]
    if content_keywords:
        queries.append(content_keywords[0])

    # 쿼리 3: 유형 + 내용 조합
    if type_keywords and content_keywords:
        queries.append(f"{type_keywords[0]} {content_keywords[0]}")

    return queries
