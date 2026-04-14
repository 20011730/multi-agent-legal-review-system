"""
Gemini API 클라이언트 공통 모듈.
재시도 로직과 클라이언트 초기화를 중앙에서 관리한다.
"""

import os
import time
import logging
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

MODEL_ID = os.getenv("GEMINI_MODEL", "gemini-2-flash")
MAX_RETRIES = int(os.getenv("GEMINI_MAX_RETRIES", "3"))
RETRY_BASE_DELAY = 2  # seconds

_client = None


def get_client() -> genai.Client:
    """Gemini 클라이언트를 싱글턴으로 반환한다."""
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY 또는 GOOGLE_API_KEY 환경변수가 설정되지 않았습니다.")
        _client = genai.Client(api_key=api_key)
    return _client


def generate_with_retry(
    system_instruction: str,
    prompt: str,
    temperature: float = 0.7,
) -> str:
    """Gemini API를 호출하되, 일시적 에러(503) 시에만 재시도한다.
    일일 할당량 초과(PerDay quota)는 재시도해도 소용없으므로 즉시 실패 처리한다.
    """
    client = get_client()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=temperature,
                ),
            )
            return response.text
        except Exception as e:
            error_str = str(e)

            # 일일 할당량 초과 → 재시도 불가, 즉시 실패
            if "PerDay" in error_str or "per day" in error_str.lower():
                logger.error("Gemini 일일 할당량 초과 — 즉시 실패: %s", error_str[:150])
                raise

            # 분당 할당량 초과 또는 서버 과부하 → 재시도 가능
            is_retryable = any(code in error_str for code in ["503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"])

            if is_retryable and attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))  # exponential backoff: 2, 4, 8초
                logger.warning(
                    "Gemini API 일시적 오류 (시도 %d/%d) — %d초 후 재시도: %s",
                    attempt, MAX_RETRIES, delay, error_str[:100],
                )
                time.sleep(delay)
            else:
                raise
