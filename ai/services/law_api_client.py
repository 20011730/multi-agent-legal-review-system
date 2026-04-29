"""
국가법령정보센터 Open API - 법령 검색 클라이언트.
http://www.law.go.kr/DRF/lawSearch.do 엔드포인트를 사용한다.
"""

import os
import logging
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── 설정 ────────────────────────────────────────────────────
# LAW_API_BASE_URL: 기본값 사용 시 .env 에 설정하지 않아도 됨
# LAW_API_KEY:      미설정 시 법령 검색을 건너뛰고 빈 리스트를 반환 (fallback)
BASE_URL = os.getenv("LAW_API_BASE_URL", "http://www.law.go.kr/DRF/lawSearch.do")
TIMEOUT = 10.0  # seconds


def get_api_key() -> Optional[str]:
    """환경변수에서 API 인증키를 가져온다."""
    return os.getenv("LAW_API_KEY")


def search_laws(query: str, display: int = 5, page: int = 1) -> list[dict]:
    """
    법령을 키워드로 검색한다.

    Args:
        query: 검색 키워드
        display: 결과 수 (기본 5, 최대 100)
        page: 페이지 번호

    Returns:
        법령 검색 결과 리스트. 각 항목은 dict:
        {
            "sourceType": "LAW",
            "title": "표시·광고의 공정화에 관한 법률",
            "referenceId": "법령일련번호",
            "articleOrCourt": "소관부처명",
            "summary": "법령약칭 / 시행일자 등",
            "url": "법령상세링크",
            "metadata": { ... }
        }
    """
    api_key = get_api_key()
    if not api_key:
        logger.warning("LAW_API_KEY 환경변수가 설정되지 않았습니다. 법령 검색을 건너뜁니다.")
        return []

    params = {
        "OC": api_key,
        "target": "law",
        "type": "XML",
        "query": query,
        "display": display,
        "page": page,
    }

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.get(BASE_URL, params=params)
            resp.raise_for_status()

        return _parse_law_xml(resp.text)

    except httpx.TimeoutException:
        logger.error("법령 검색 API 타임아웃: query=%s", query)
        return []
    except httpx.HTTPStatusError as e:
        logger.error("법령 검색 API HTTP 에러: %s", e)
        return []
    except Exception as e:
        logger.error("법령 검색 중 오류 발생: %s", e)
        return []


def _parse_law_xml(xml_text: str) -> list[dict]:
    """법령 검색 XML 응답을 파싱한다."""
    results = []
    try:
        root = ET.fromstring(xml_text)

        for item in root.findall(".//law") or root.findall(".//LawSearch"):
            law_id = _text(item, "법령일련번호")
            title = _text(item, "법령명한글")
            short_name = _text(item, "법령약칭명")
            dept = _text(item, "소관부처명")
            enforce_date = _text(item, "시행일자")
            proclaim_date = _text(item, "공포일자")
            link = _text(item, "법령상세링크")
            revision_type = _text(item, "제개정구분명")

            if not title:
                continue

            url = f"https://www.law.go.kr{link}" if link and not link.startswith("http") else (link or "")

            summary_parts = []
            if short_name:
                summary_parts.append(f"약칭: {short_name}")
            if revision_type:
                summary_parts.append(revision_type)
            if enforce_date:
                summary_parts.append(f"시행일: {enforce_date}")

            results.append({
                "sourceType": "LAW",
                "title": title,
                "referenceId": law_id or "",
                "articleOrCourt": dept or "",
                "summary": " | ".join(summary_parts) if summary_parts else title,
                "url": url,
                "metadata": {
                    "proclaimDate": proclaim_date,
                    "enforceDate": enforce_date,
                    "revisionType": revision_type,
                    "shortName": short_name,
                },
            })

    except ET.ParseError as e:
        logger.error("법령 XML 파싱 실패: %s", e)

    return results


def _text(element: ET.Element, tag: str) -> str:
    """XML 요소에서 텍스트를 안전하게 추출한다."""
    child = element.find(tag)
    return child.text.strip() if child is not None and child.text else ""
