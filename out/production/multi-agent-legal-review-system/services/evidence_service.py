"""
법령/판례 증거 수집 서비스.
키워드 추출 → 법령/판례 검색 → 랭킹 → 정규화된 evidence 리스트 반환.
"""

import logging

from services.law_api_client import search_laws
from services.case_api_client import search_cases
from utils.text_utils import extract_keywords, build_search_queries
from utils.ranking import rank_evidences

logger = logging.getLogger(__name__)


def collect_evidences(
    content: str,
    situation: str,
    review_type: str,
    max_results: int = 5,
) -> list[dict]:
    """
    검토 대상에 대한 법령/판례 근거를 수집한다.

    Args:
        content: 검토 원문
        situation: 상황 설명
        review_type: 검토 유형 (marketing, contract, etc.)
        max_results: 반환할 최대 결과 수

    Returns:
        정규화된 evidence 리스트:
        [
            {
                "sourceType": "LAW" | "CASE",
                "title": str,
                "referenceId": str,
                "articleOrCourt": str,
                "summary": str,
                "url": str,
                "relevanceReason": str,
                "relevanceScore": int,
                "metadata": dict
            }
        ]
    """
    try:
        # 1. 키워드 추출
        keywords = extract_keywords(content, situation, review_type)
        logger.info("추출된 키워드: %s", keywords)

        # 2. 검색 쿼리 생성
        queries = build_search_queries(keywords, review_type)
        logger.info("검색 쿼리: %s", queries)

        # 3. 법령 + 판례 검색
        all_evidences = []
        seen_titles = set()

        for query in queries:
            # 법령 검색
            laws = search_laws(query, display=3)
            for law in laws:
                if law["title"] not in seen_titles:
                    all_evidences.append(law)
                    seen_titles.add(law["title"])

            # 판례 검색
            cases = search_cases(query, display=3)
            for case in cases:
                if case["title"] not in seen_titles:
                    all_evidences.append(case)
                    seen_titles.add(case["title"])

        logger.info("검색된 전체 증거: %d건 (법령+판례)", len(all_evidences))

        # 4. 랭킹 및 상위 결과 선정
        ranked = rank_evidences(all_evidences, keywords, review_type, max_results)
        logger.info("최종 선정된 증거: %d건", len(ranked))

        return ranked

    except Exception as e:
        logger.error("증거 수집 중 오류 발생: %s", e)
        return []
