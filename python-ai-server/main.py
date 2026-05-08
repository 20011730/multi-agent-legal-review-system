import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from schemas import AnalyzeRequest, AnalyzeResponse
from analyzer import analyze as rule_based_analyze

# 환경변수 로드 (.env 파일)
load_dotenv()

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# LangGraph 엔진 사용 여부 (환경변수 USE_LANGGRAPH=true 로 활성화)
USE_LANGGRAPH = os.getenv("USE_LANGGRAPH", "false").lower() == "true"

# LangGraph 모듈 lazy import (의존성 없어도 서버 시작 가능)
_langgraph_analyze = None
if USE_LANGGRAPH:
    try:
        from langgraph_analyzer import analyze_with_langgraph
        from agents.llm_client import get_provider, is_provider_configured
        _langgraph_analyze = analyze_with_langgraph
        ok, reason = is_provider_configured()
        if ok:
            logger.info("✅ LangGraph 엔진 활성화 — provider=%s (%s)", get_provider(), reason)
        else:
            logger.warning("⚠️ LangGraph 활성화됐지만 provider 검증 실패 — 분석 시 규칙 기반 폴백: %s", reason)
    except ImportError as e:
        logger.warning("⚠️ LangGraph 의존성 누락 — 규칙 기반 엔진으로 폴백: %s", e)
        USE_LANGGRAPH = False
    except Exception as e:
        logger.warning("⚠️ LangGraph 초기화 실패 — 규칙 기반 엔진으로 폴백: %s", e)
        USE_LANGGRAPH = False

app = FastAPI(title="Legal Review AI Server", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    law_api_key = os.getenv("LAW_API_KEY")
    provider = (os.getenv("AI_PROVIDER", "ollama") or "ollama").lower()
    ollama_base = os.getenv("OLLAMA_BASE_URL")
    ollama_model = os.getenv("OLLAMA_MODEL")
    return {
        "status": "ok",
        "version": "0.4.0",
        "engine": "langgraph" if USE_LANGGRAPH else "rule-based",
        "provider": provider,
        "ollamaBaseUrl": ollama_base,
        "ollamaModel": ollama_model,
        "lawApiConfigured": bool(law_api_key),
    }


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(request: AnalyzeRequest):
    """
    분석 진입점.

    - LangGraph(Ollama) 우선 시도 → analysisSource="LANGGRAPH_OLLAMA"
    - 실패 시 규칙 기반 fallback → analysisSource="RULE_BASED_FALLBACK", fallbackUsed=true
    - fallback 결과의 첫 번째 메시지에 "AI 호출 실패 — 규칙 기반 대체 결과" 안내를 prepend
      하여 사용자가 실제 LLM 결과로 오해하지 않도록 한다.
    """
    if USE_LANGGRAPH and _langgraph_analyze:
        try:
            logger.info("LangGraph 엔진으로 분석 시작 — 세션 %s", request.sessionId)
            response = _langgraph_analyze(request)
            # langgraph 정상 경로 — 메타데이터 명시
            try:
                response.analysisSource = "LANGGRAPH_OLLAMA"
                response.fallbackUsed = False
                response.errorMessage = None
            except Exception:
                pass  # 응답 형태가 다를 경우 안전 무시
            return response
        except Exception as e:
            err_msg = str(e)[:300]
            logger.error("LangGraph 분석 실패 — 규칙 기반 엔진으로 폴백: %s", err_msg)
            response = _wrap_fallback(rule_based_analyze(request), err_msg)
            return response

    # USE_LANGGRAPH=false 인 경우도 규칙 기반이지만, "fallback"이라 부르진 않음
    # — 단 사용자에게 LLM이 아니라는 사실은 명시
    logger.info("규칙 기반 엔진으로 분석 — 세션 %s", request.sessionId)
    response = rule_based_analyze(request)
    try:
        response.analysisSource = "RULE_BASED"
        response.fallbackUsed = False
    except Exception:
        pass
    return response


def _wrap_fallback(response, error_message: str):
    """
    규칙 기반 fallback 결과에 명시적 표시를 부착.

    1) AnalyzeResponse 메타 필드 (analysisSource / fallbackUsed / errorMessage)
    2) 첫 번째 메시지의 content에 안내 prefix prepend (시스템 메시지 형태)
       → frontend가 메타 필드를 무시해도 사용자에게 안내가 보이도록 이중 보호
    """
    try:
        response.analysisSource = "RULE_BASED_FALLBACK"
        response.fallbackUsed = True
        response.errorMessage = error_message
    except Exception:
        pass

    notice = (
        "⚠️ [AI 분석 실패 — 규칙 기반 대체 결과] "
        "Ollama LLM 호출에 실패하여 자동 분석을 완료하지 못했습니다. "
        "아래 내용은 정식 AI 토론 결과가 아니며, 임시 규칙 기반 응답입니다. "
        "잠시 후 재시도하거나 RunPod/Ollama 상태를 확인해주세요.\n\n"
    )
    try:
        msgs = getattr(response, "messages", None)
        if msgs and len(msgs) > 0:
            msgs[0].content = notice + (msgs[0].content or "")
    except Exception:
        pass
    return response


@app.get("/health/ollama")
def health_ollama():
    """
    deep health check — RunPod/Ollama 실제 도달 가능성과 모델 존재 여부 확인.
    /health 보다 느릴 수 있으므로 별도 endpoint로 분리.
    """
    import httpx
    base = (os.getenv("OLLAMA_BASE_URL") or "").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "")
    if not base:
        return {
            "ollamaReachable": False,
            "modelAvailable": False,
            "reason": "OLLAMA_BASE_URL 미설정",
            "ollamaModel": model,
        }
    url = f"{base}/api/tags"
    try:
        timeout = float(os.getenv("OLLAMA_HEALTH_TIMEOUT", "10"))
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url)
        if resp.status_code != 200:
            return {
                "ollamaReachable": False,
                "modelAvailable": False,
                "reason": f"HTTP {resp.status_code}",
                "ollamaModel": model,
            }
        data = resp.json() or {}
        models = [m.get("name") for m in (data.get("models") or [])]
        available = model in models if model else False
        return {
            "ollamaReachable": True,
            "modelAvailable": available,
            "ollamaModel": model,
            "installedModels": models,
        }
    except Exception as e:
        return {
            "ollamaReachable": False,
            "modelAvailable": False,
            "reason": str(e)[:200],
            "ollamaModel": model,
        }
