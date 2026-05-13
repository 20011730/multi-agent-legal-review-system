"""
ai/generate_rag 보조 도구 공통 설정.

환경변수 기반으로 DB 접속 정보와 법제처 API OC 값을 로드한다.
실제 값은 루트 `.env` 파일 또는 셸 환경변수에서 가져오며, 코드에는 절대 하드코딩하지 않는다.

사용법:
    from config import DB_CONFIG, LAW_API_OC, CHROMA_DB_DIR

루트 `.env` 예시 (실제 값은 직접 설정):
    LAW_API_OC=<발급받은_국가법령정보센터_OC>
    DB_NAME=legalreview
    DB_USER=legalreview
    DB_PASSWORD=<로컬_DB_비밀번호>
    DB_HOST=localhost
    DB_PORT=5432
    CHROMA_DB_DIR=./chroma_data
"""

import os

# python-dotenv가 설치되어 있으면 .env 자동 로드 (optional)
try:
    from dotenv import load_dotenv
    # 우선순위: ai/generate_rag/.env → 루트 .env (둘 다 .gitignore 대상)
    _here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_here, ".env"))
    load_dotenv(os.path.join(_here, "..", "..", ".env"))
except ImportError:
    # 의존성 없으면 OS 환경변수만 사용
    pass


# ── 법제처 Open API ──
LAW_API_OC = os.getenv("LAW_API_OC", "")
"""국가법령정보센터 OC 값. 미설정 시 API 호출 시 명시적 에러로 fail-fast."""


# ── PostgreSQL ──
DB_CONFIG = {
    "dbname":   os.getenv("DB_NAME", "legalreview"),
    "user":     os.getenv("DB_USER", "legalreview"),
    "password": os.getenv("DB_PASSWORD", ""),
    "host":     os.getenv("DB_HOST", "localhost"),
    "port":     os.getenv("DB_PORT", "5432"),
}


# ── ChromaDB (PersistentClient용 로컬 디렉터리 — Docker ChromaDB와 별개) ──
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_data")


# ── E5 임베딩 모델 ──
E5_MODEL_NAME = os.getenv("E5_MODEL_NAME", "intfloat/multilingual-e5-base")


def require_law_api_oc() -> str:
    """LAW_API_OC가 비어있으면 즉시 RuntimeError. 스크립트 시작부에서 호출 권장."""
    if not LAW_API_OC:
        raise RuntimeError(
            "LAW_API_OC 환경변수가 설정되지 않았습니다. "
            "루트 .env 파일에 LAW_API_OC=<발급받은_OC값>을 추가하세요."
        )
    return LAW_API_OC


def require_db_password() -> None:
    """DB_PASSWORD가 비어있으면 즉시 경고 (psycopg2가 unix socket으로 통과할 수도 있어 강제 X)."""
    if not DB_CONFIG["password"]:
        import warnings
        warnings.warn(
            "DB_PASSWORD 환경변수가 비어 있습니다. "
            "PostgreSQL이 password 인증을 요구한다면 .env에 DB_PASSWORD를 설정하세요.",
            stacklevel=2,
        )
