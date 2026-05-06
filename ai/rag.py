"""법제처 API 실시간 검색 유틸리티 (임시 — ChromaDB 구축 전까지 사용)."""

import logging
import os
import time
import threading
import httpx
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

API_KEY = os.getenv("LAW_API_KEY", "minijn")
_cache: dict[str, str] = {}
_lock = threading.Lock()


def _get_vectorstore():
    pass


def _fetch(query: str, k: int) -> str:
    search_url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {"OC": API_KEY, "target": "law", "type": "XML", "query": query, "display": k}

    with httpx.Client(timeout=10) as client:
        res = client.get(search_url, params=params)
        res.raise_for_status()

        root = ET.fromstring(res.content)
        law_ids, law_names = [], []
        for law in root.findall(".//법령"):
            law_id = law.findtext("법령ID", default="")
            law_name = law.findtext("법령명한글", default="")
            if law_id:
                law_ids.append(law_id)
                law_names.append(law_name)

        if not law_ids:
            return ""

        parts = []
        for law_id, law_name in zip(law_ids[:2], law_names[:2]):
            detail_url = "http://www.law.go.kr/DRF/lawService.do"
            params2 = {"OC": API_KEY, "target": "law", "type": "XML", "ID": law_id}
            detail_res = client.get(detail_url, params=params2)
            detail_res.raise_for_status()

            detail_root = ET.fromstring(detail_res.content)
            for article in detail_root.findall(".//조문단위")[:2]:
                article_no = article.findtext("조문번호", default="")
                content = article.findtext("조문내용", default="")
                if content:
                    parts.append(f"[{law_name} 제{article_no}조]\n{content}")

    return "\n\n".join(parts)


def retrieve(query: str, k: int = 3) -> str:
    """쿼리 키워드로 법제처 API에서 법령 조문을 실시간 검색한다."""
    if query in _cache:
        return _cache[query]

    with _lock:
        if query in _cache:
            return _cache[query]

        for attempt in range(3):
            try:
                result = _fetch(query, k)
                _cache[query] = result
                return result
            except Exception as e:
                if attempt < 2:
                    time.sleep(1)
                else:
                    logger.warning("법제처 API 검색 실패: %s", e)
                    _cache[query] = ""
                    return ""
