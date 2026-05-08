"""
LLM provider 라우터.

기본 provider는 **ollama**(자체 RunPod/로컬 Ollama 서버).
agents/biz_agent.py, legal_agent.py, judge_agent.py 는 이 모듈의
`generate_with_retry(system_instruction, prompt, temperature)` 한 함수만 호출하므로
provider 교체는 본 파일만 수정하면 된다.

환경변수:
    AI_PROVIDER       : "ollama" (default) | "gemini"
    OLLAMA_BASE_URL   : RunPod proxy URL 또는 http://localhost:11434
    OLLAMA_MODEL      : 사용 모델 (예: "llama3.1:8b", "qwen2.5:7b")
    OLLAMA_TIMEOUT    : 호출 timeout(초). 기본 300
    OLLAMA_MAX_RETRIES: 일시적 오류 재시도 횟수. 기본 3

선택(provider=gemini일 때만):
    GEMINI_API_KEY 또는 GOOGLE_API_KEY
    GEMINI_MODEL (default gemini-2.5-flash)
"""

import os
import time
import logging

import httpx

logger = logging.getLogger(__name__)

# ── 공용 ──
_PROVIDER = (os.getenv("AI_PROVIDER", "ollama") or "ollama").lower()
MAX_RETRIES = int(os.getenv("OLLAMA_MAX_RETRIES", os.getenv("GEMINI_MAX_RETRIES", "3")))
# 재시도 백오프 — RunPod proxy의 cold-start / 일시적 502에 대응하려면 첫 시도 후 충분한 대기 필요
RETRY_BASE_DELAY = float(os.getenv("OLLAMA_RETRY_BASE_DELAY", "2"))
RETRY_MAX_DELAY = float(os.getenv("OLLAMA_RETRY_MAX_DELAY", "20"))

# ── Ollama 설정 ──
OLLAMA_BASE_URL = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "600"))

# 재시도해야 하는 일시적 서버/네트워크 상태 코드
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _summarize_html_or_text(body: str, max_len: int = 160) -> str:
    """502 등 응답이 HTML로 올 때 한 줄 요약. 태그 제거 + 공백 정리 + 길이 절단."""
    if not body:
        return ""
    import re
    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len] + ("…" if len(text) > max_len else "")

# ── Gemini 설정 (optional fallback) ──
GEMINI_MODEL_ID = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
_gemini_client = None  # lazy init


def get_provider() -> str:
    return _PROVIDER


# ─────────────────────────────────────────────────────────────────────
#                              Ollama
# ─────────────────────────────────────────────────────────────────────

def _generate_ollama(system_instruction: str, prompt: str, temperature: float) -> str:
    """
    POST {OLLAMA_BASE_URL}/api/chat
    body: {model, messages:[{role,content}], stream:false, options:{temperature}}
    response: {"message": {"content": "..."}, ...}

    재시도 정책:
      - 502/503/504/500/429 → 일시적 오류로 보고 backoff 후 재시도 (최대 OLLAMA_MAX_RETRIES)
      - 4xx (400/401/403/404 등) → 설정 오류로 즉시 실패 (재시도 안 함)
      - timeout / 네트워크 에러 → 일시적으로 보고 재시도
      - backoff: min(RETRY_BASE_DELAY * 2^(n-1), RETRY_MAX_DELAY)
    """
    url = f"{OLLAMA_BASE_URL}/api/chat"
    body = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        "stream": False,                             # 단일 JSON 응답 (스트리밍 처리 안 함)
        "options": {"temperature": float(temperature)},
    }

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
                resp = client.post(url, json=body)

            # 4xx — 설정/요청 자체 오류. 재시도 무의미 → 즉시 실패
            if 400 <= resp.status_code < 500:
                summary = _summarize_html_or_text(resp.text)
                logger.error(
                    "Ollama HTTP %d (재시도 안 함) — 설정/요청 오류. URL=%s/api/chat, model=%s, body=%s",
                    resp.status_code, OLLAMA_BASE_URL, OLLAMA_MODEL, summary,
                )
                raise RuntimeError(
                    f"Ollama HTTP {resp.status_code} (설정/요청 오류): {summary}"
                )

            # 5xx / 429 — 일시적 오류, 재시도 대상
            if resp.status_code in _RETRYABLE_STATUS_CODES:
                summary = _summarize_html_or_text(resp.text)
                raise RuntimeError(f"Ollama HTTP {resp.status_code} (일시적): {summary}")

            # 그 외 비정상 응답
            if resp.status_code >= 300:
                summary = _summarize_html_or_text(resp.text)
                raise RuntimeError(f"Ollama HTTP {resp.status_code}: {summary}")

            data = resp.json()
            # /api/chat 표준 응답
            msg = data.get("message") or {}
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                return content
            # 일부 빌드는 top-level "response" — fallback
            top = data.get("response")
            if isinstance(top, str) and top.strip():
                return top
            raise RuntimeError(f"Ollama 응답 비정상 (content 없음): {str(data)[:160]}")

        except (httpx.TimeoutException, httpx.NetworkError, RuntimeError) as e:
            # RuntimeError 중 4xx은 위에서 raise하지 않고 즉시 fall-through로 함수 종료해야 하므로 분리:
            err_str = str(e)
            is_4xx = err_str.startswith("Ollama HTTP 4")
            if is_4xx:
                # 4xx 메시지는 재시도하지 않고 그대로 상위로 전파
                raise

            last_err = e
            if attempt < MAX_RETRIES:
                delay = min(RETRY_BASE_DELAY * (2 ** (attempt - 1)), RETRY_MAX_DELAY)
                logger.warning(
                    "Ollama 일시적 오류 (시도 %d/%d) — %.1f초 후 재시도: %s",
                    attempt, MAX_RETRIES, delay, err_str[:160],
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Ollama 호출 최종 실패 (시도 %d회, last_error=%s)",
                    MAX_RETRIES, err_str[:200],
                )
                raise

    raise last_err or RuntimeError("Ollama 호출 실패 (원인 불명)")


# ─────────────────────────────────────────────────────────────────────
#                       Gemini (optional, 기본 비활성)
# ─────────────────────────────────────────────────────────────────────

def _get_gemini_client():
    """Gemini SDK 지연 import — google-genai 미설치 환경에서도 import 에러 없이 동작."""
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client
    try:
        from google import genai  # type: ignore
    except Exception as e:
        raise RuntimeError(f"google-genai 패키지 미설치 — provider=gemini 사용 불가: {e}")
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY/GOOGLE_API_KEY 미설정 — provider=gemini 사용 불가")
    _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _generate_gemini(system_instruction: str, prompt: str, temperature: float) -> str:
    from google.genai import types  # type: ignore
    client = _get_gemini_client()

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=float(temperature),
                ),
            )
            return response.text
        except Exception as e:
            last_err = e
            error_str = str(e)
            if "PerDay" in error_str or "per day" in error_str.lower():
                logger.error("Gemini 일일 할당량 초과 — 즉시 실패: %s", error_str[:150])
                raise
            is_retryable = any(c in error_str for c in ["503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"])
            if is_retryable and attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning("Gemini 일시적 오류 (시도 %d/%d) — %d초 후 재시도: %s",
                               attempt, MAX_RETRIES, delay, error_str[:100])
                time.sleep(delay)
            else:
                raise
    raise last_err or RuntimeError("Gemini 호출 실패 (원인 불명)")


# ─────────────────────────────────────────────────────────────────────
#                            Public API
# ─────────────────────────────────────────────────────────────────────

def generate_with_retry(
    system_instruction: str,
    prompt: str,
    temperature: float = 0.7,
) -> str:
    """
    LLM 호출 단일 진입점. AI_PROVIDER에 따라 ollama / gemini로 라우팅.

    기존 agents/*.py가 이 함수를 import하므로 시그니처 유지가 핵심.
    """
    if _PROVIDER == "gemini":
        return _generate_gemini(system_instruction, prompt, temperature)
    # default: ollama
    return _generate_ollama(system_instruction, prompt, temperature)


def is_provider_configured() -> tuple[bool, str]:
    """현재 provider 설정이 유효한지 + 사유. langgraph 사전 검증용."""
    if _PROVIDER == "ollama":
        if not OLLAMA_BASE_URL:
            return False, "OLLAMA_BASE_URL 미설정"
        return True, f"ollama provider — base={OLLAMA_BASE_URL}, model={OLLAMA_MODEL}"
    if _PROVIDER == "gemini":
        if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
            return False, "GEMINI_API_KEY/GOOGLE_API_KEY 미설정"
        return True, f"gemini provider — model={GEMINI_MODEL_ID}"
    return False, f"알 수 없는 AI_PROVIDER='{_PROVIDER}' (ollama/gemini 중 선택)"
