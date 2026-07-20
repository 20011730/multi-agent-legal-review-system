"""
[LEGACY COMPATIBILITY SHIM]

이 파일은 더 이상 Gemini API를 호출하지 않습니다.

본 프로젝트의 LLM 분석 엔진은 자체 RunPod / 로컬 Ollama 서버이며,
실제 호출 로직은 `agents/llm_client.py`의 `generate_with_retry()` 가 담당합니다.
provider 라우팅도 그곳에서 환경변수 `AI_PROVIDER`(default `ollama`)로 이루어집니다.

본 파일은 외부 import 경로 호환을 위해 남겨둔 얇은 re-export shim입니다.
신규 코드는 반드시 다음과 같이 작성해주세요:

    from agents.llm_client import generate_with_retry

기존 `from agents.gemini_client import generate_with_retry` 호출도
이 shim을 통해 자동으로 Ollama provider로 위임됩니다 — 즉,
"gemini_client" 라는 이름이 들어 있어도 Gemini API는 호출되지 않습니다.

향후 본 shim은 모든 호출 경로가 `llm_client`로 정리된 뒤 제거 예정입니다.
"""

from agents.llm_client import generate_with_retry, get_provider, is_provider_configured

__all__ = ["generate_with_retry", "get_provider", "is_provider_configured"]
