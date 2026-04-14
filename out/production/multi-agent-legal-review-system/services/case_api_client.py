"""
국가법령정보센터 Open API - 판례 검색 클라이언트.
http://www.law.go.kr/DRF/lawSearch.do?target=prec 엔드포인트를 사용한다.
"""

import os
import logging
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── 설정 ────────────────────────────────────────────────────
# CASE_API_BASE_URL: 기본값 사용 시 .env 에 설정하지 않아도 됨
# CASE_API_KEY:      미설정 시 LAW_API_KEY를 공유. 둘 다 없으면 판례 검색 건너뜀 (fallback)
BASE_URL = os.getenv("CASE_API_BASE_URL", "http://www.law.go.kr/DRF/lawSearch.do")
TIMEOUT = 10.0  # seconds


def get_api_key() -> Optional[str]:
    """환경변수에서 API 인증키를 가져온다. CASE_API_KEY 우선, 없으면 LAW_API_KEY 사용."""
    return os.getenv("CASE_API_KEY") or os.getenv("LAW_API_KEY")


def search_cases(query: str, display: int = 5, page: int = 1) -> list[dict]:
    """
    판례를 키워드로 검색한다.

    Args:
        query: 검색 키워드
        display: 결과 수 (기본 5, 최대 100)
        page: 페이지 번호

    Returns:
        판례 검색 결과 리스트. 각 항목은 dict:
        {
            "sourceType": "CASE",
            "title": "사건명",
            "referenceId": "사건번호",
            "articleOrCourt": "법원명",
            "summary": "판시사항 요약",
            "url": "판례상세링크",
            "metadata": { ... }
        }
    """
    api_key = get_api_key()
    if not api_key:
        logger.warning("LAW_API_KEY 환경변수가 설정되지 않았습니다. 판례 검색을 건너뜁니다.")
        return []

    params = {
        "OC": api_key,
        "target": "prec",
        "type": "XML",
        "query": query,
        "display": display,
        "page": page,
    }

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.get(BASE_URL, params=params)
            resp.raise_for_status()

        return _parse_case_xml(resp.text)

    except httpx.TimeoutException:
        logger.error("판례 검색 API 타임아웃: query=%s", query)
        return []
    except httpx.HTTPStatusError as e:
        logger.error("판례 검색 API HTTP 에러: %s", e)
        return []
    except Exception as e:
        logger.error("판례 검색 중 오류 발생: %s", e)
        return []


def _parse_case_xml(xml_text: str) -> list[dict]:
    """판례 검색 XML 응답을 파싱한다."""
    results = []
    try:
        root = ET.fromstring(xml_text)

        for item in root.findall(".//prec") or root.findall(".//PrecSearch"):
            case_name = _text(item, "사건명")
            case_number = _text(item, "사건번호")
            judgment_date = _text(item, "선고일자")
            court_name = _text(item, "법원명")
            case_type = _text(item, "사건종류명")
            link = _text(item, "판례상세링크")

            if not case_name:
                continue

            url = f"https://www.law.go.kr{link}" if link and not link.startswith("http") else (link or "")

            summary_parts = []
            if case_type:
                summary_parts.append(case_type)
            if judgment_date:
                summary_parts.append(f"선고일: {judgment_date}")
            if court_name:
                summary_parts.append(court_name)

            results.append({
                "sourceType": "CASE",
                "title": case_name,
                "referenceId": case_number or "",
                "articleOrCourt": court_name or "",
                "summary": " | ".join(summary_parts) if summary_parts else case_name,
                "url": url,
                "metadata": {
                    "judgmentDate": judgment_date,
                    "caseType": case_type,
                    "caseNumber": case_number,
                },
            })

    except ET.ParseError as e:
        logger.error("판례 XML 파싱 실패: %s", e)

    return results


def _text(element: ET.Element, tag: str) -> str:
    """XML 요소에서 텍스트를 안전하게 추출한다."""
    child = element.find(tag)
    return child.text.strip() if child is not None and child.text else ""
