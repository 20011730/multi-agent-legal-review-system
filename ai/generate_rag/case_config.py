"""
ai/generate_rag — 판례(case) RAG 확장 전용 공통 설정.

법령(law) 흐름의 ``config.py`` 와 동일한 환경변수 정책을 따른다:
- 민감값은 코드에 하드코딩하지 않고 ``.env`` / OS 환경변수에서 로드한다.
- 기본값은 항상 **안전한 쪽** (dry-run, 소규모, 기존 컬렉션 비건드림) 으로 둔다.

사용 예
-------
    from case_config import (
        CASE_API_OC,
        CASES_COLLECTION,
        CASE_KEYWORDS,
        CASE_RATE_LIMIT_MS,
        CASES_OUTPUT_DIR,
        describe_case_target,
    )

루트 ``.env`` 또는 ``ai/generate_rag/.env`` 예시 (실제 값은 직접 설정, 본 문서엔 평문 금지)
::

    # 국가법령정보센터 OPEN API — 법령과 동일 OC 사용 가능
    LAW_API_OC=<발급받은_OC>

    # 판례 수집 출력 디렉터리 (.gitignore 처리됨)
    CASES_OUTPUT_DIR=./cases_data

    # Chroma 판례 컬렉션 이름
    CASES_COLLECTION=cases_e5

    # 초기 수집 키워드 (콤마 구분). 기본값은 광고/표시/식품/전자상거래/소비자보호/약관/개인정보/통신판매
    CASE_KEYWORDS=광고,표시광고,식품,전자상거래,소비자보호,약관,개인정보,통신판매

    # 호출 사이 지연 (ms). 법제처 API rate limit 보호용.
    CASE_RATE_LIMIT_MS=300
"""

from __future__ import annotations

import os
from typing import List

# python-dotenv가 설치되어 있으면 ``.env`` 자동 로드 (optional)
try:
    from dotenv import load_dotenv
    _here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_here, ".env"))
    load_dotenv(os.path.join(_here, "..", "..", ".env"))
except ImportError:
    pass


# ── 법제처 API (법령과 동일 OC 재사용) ───────────────────────────────
CASE_API_OC: str = os.getenv("LAW_API_OC", "")
"""법제처 OC. 미설정이면 dry-run만 가능. 실제 수집 시도하면 RuntimeError."""

CASE_API_SEARCH_URL: str = os.getenv(
    "CASE_API_SEARCH_URL",
    "http://www.law.go.kr/DRF/lawSearch.do",
)
CASE_API_SERVICE_URL: str = os.getenv(
    "CASE_API_SERVICE_URL",
    "http://www.law.go.kr/DRF/lawService.do",
)


# ── 출력 디렉터리 (수집 결과 JSON/JSONL) ──────────────────────────────
CASES_OUTPUT_DIR: str = os.getenv("CASES_OUTPUT_DIR", "./cases_data")


# ── Chroma 컬렉션 이름 정책 ────────────────────────────────────────
# 기본값은 ``cases_e5`` — backend RagProperties의 기본값 ``cases``(384차원, 미사용)와
# 분리하여 E5 768차원 임베딩 전용 신규 컬렉션을 둔다.
# 기존 ``laws`` / ``laws_e5`` 컬렉션과는 이름이 다르므로 충돌 가능성 없음.
CASES_COLLECTION: str = os.getenv("CASES_COLLECTION", "cases_e5")

# 안전 가드: 기존 laws 계열 컬렉션 이름은 사용 금지
_FORBIDDEN_COLLECTIONS = {"laws", "laws_e5"}


def require_safe_cases_collection() -> str:
    """``CASES_COLLECTION`` 이 ``laws`` 또는 ``laws_e5`` 라면 즉시 RuntimeError."""
    if CASES_COLLECTION in _FORBIDDEN_COLLECTIONS:
        raise RuntimeError(
            f"CASES_COLLECTION='{CASES_COLLECTION}' 은(는) 법령 컬렉션 이름과 겹칩니다. "
            f"판례 적재 도구는 절대 법령 컬렉션을 수정해서는 안 됩니다. "
            f"CASES_COLLECTION=cases_e5 (기본값) 또는 다른 cases 계열 이름을 사용하세요."
        )
    return CASES_COLLECTION


# ── 초기 수집 키워드 (소규모 시작) ─────────────────────────────────
_DEFAULT_KEYWORDS = "광고,표시광고,식품,전자상거래,소비자보호,약관,개인정보,통신판매"


def _parse_keywords(raw: str) -> List[str]:
    return [k.strip() for k in raw.split(",") if k.strip()]


CASE_KEYWORDS: List[str] = _parse_keywords(os.getenv("CASE_KEYWORDS", _DEFAULT_KEYWORDS))


# ── 호출 사이 지연 (rate-limit 보호) ───────────────────────────────
CASE_RATE_LIMIT_MS: int = int(os.getenv("CASE_RATE_LIMIT_MS", "300"))
CASE_MAX_PAGES: int = int(os.getenv("CASE_MAX_PAGES", "3"))  # 1 페이지 = 100건 기본
CASE_PAGE_SIZE: int = int(os.getenv("CASE_PAGE_SIZE", "100"))


# ── Chroma 접속 모드 (법령 도구의 config.py와 동일 키 사용) ────────────
# CASES_COLLECTION 만 다르고 host/port/모드 키는 동일하게 공유해 일관성 유지.
from config import (  # noqa: E402  — 위 정의를 모두 먼저 두고 가져온다
    CHROMA_CLIENT_MODE,
    CHROMA_DB_DIR,
    CHROMA_HOST,
    CHROMA_PORT,
    E5_MODEL_NAME,
    EMBEDDING_DIMENSION,
)


def describe_case_target() -> str:
    """현재 설정된 판례 적재 대상을 사람이 읽기 좋은 문자열로 반환 (로그용)."""
    if CHROMA_CLIENT_MODE == "http":
        target = f"http://{CHROMA_HOST}:{CHROMA_PORT}"
    else:
        target = f"local file ({CHROMA_DB_DIR})"
    return f"{target} collection={CASES_COLLECTION} dim={EMBEDDING_DIMENSION} model={E5_MODEL_NAME}"


def require_law_api_oc_for_cases() -> str:
    """판례 API 호출에 필요한 OC. 비어있으면 dry-run만 허용."""
    if not CASE_API_OC:
        raise RuntimeError(
            "LAW_API_OC 환경변수가 설정되지 않았습니다. dry-run은 가능하지만 "
            "실제 판례 수집은 OC 발급 후 .env 에 추가해야 합니다."
        )
    return CASE_API_OC
