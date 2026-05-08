"""
법령/판례 증거 수집 서비스.
키워드 추출 → 법령/판례 검색 (병렬) → 랭킹 → 정규화된 evidence 리스트 반환.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from services.law_api_client import search_laws
from services.case_api_client import search_cases
from utils.text_utils import extract_keywords, build_search_queries
from utils.ranking import rank_evidences

logger = logging.getLogger(__name__)

# 최대 동시 검색 스레드 수
MAX_WORKERS = 6


def _search_laws_safe(query: str, display: int = 3) -> list[dict]:
    """법령 검색 (예외 안전)."""
    try:
        return search_laws(query, display=display)
    except Exception as e:
        logger.warning("법령 검색 실패 (query=%s): %s", query, e)
        return []


def _search_cases_safe(query: str, display: int = 3) -> list[dict]:
    """판례 검색 (예외 안전)."""
    try:
        return search_cases(query, display=display)
    except Exception as e:
        logger.warning("판례 검색 실패 (query=%s): %s", query, e)
        return []


def collect_evidences(
    content: str,
    situation: str,
    review_type: str,
    max_results: int = 5,
) -> list[dict]:
    """
    검토 대상에 대한 법령/판례 근거를 수집한다.
    병렬 검색으로 기존 대비 2~3배 빠르게 수집.

    Args:
        content: 검토 원문
        situation: 상황 설명
        review_type: 검토 유형 (marketing, contract, etc.)
        max_results: 반환할 최대 결과 수

    Returns:
        정규화된 evidence 리스트
    """
    try:
        # 1. 키워드 추출
        keywords = extract_keywords(content, situation, review_type)
        logger.info("추출된 키워드: %s", keywords)

        # 2. 검색 쿼리 생성
        queries = build_search_queries(keywords, review_type)
        logger.info("검색 쿼리: %s", queries)

        # 3. 법령 + 판례 병렬 검색
        all_evidences = []
        seen_titles = set()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {}
            for query in queries:
                # 각 쿼리에 대해 법령 + 판례 동시 검색
                f_law = executor.submit(_search_laws_safe, query, 3)
                f_case = executor.submit(_search_cases_safe, query, 3)
                futures[f_law] = ("law", query)
                futures[f_case] = ("case", query)

            for future in as_completed(futures):
                search_type, query = futures[future]
                try:
                    results = future.result()
                    for item in results:
                        if item["title"] not in seen_titles:
                            all_evidences.append(item)
                            seen_titles.add(item["title"])
                except Exception as e:
                    logger.warning("%s 검색 결과 처리 실패 (query=%s): %s", search_type, query, e)

        logger.info("검색된 전체 증거: %d건 (법령+판례, 병렬)", len(all_evidences))

        # 4. 랭킹 및 상위 결과 선정
        ranked = rank_evidences(all_evidences, keywords, review_type, max_results)
        logger.info("최종 선정된 증거: %d건", len(ranked))

        return ranked

    except Exception as e:
        logger.error("증거 수집 중 오류 발생: %s", e)
        return []
