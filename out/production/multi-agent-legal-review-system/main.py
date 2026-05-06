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
        _langgraph_analyze = analyze_with_langgraph
        logger.info("✅ LangGraph 엔진 활성화됨 (Gemini + RAG)")
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
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    return {
        "status": "ok",
        "version": "0.3.0",
        "engine": "langgraph" if USE_LANGGRAPH else "rule-based",
        "lawApiConfigured": bool(law_api_key),
        "geminiApiConfigured": bool(gemini_key),
    }


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(request: AnalyzeRequest):
    # LangGraph 엔진이 활성화되어 있으면 우선 사용, 실패 시 규칙 기반으로 폴백
    if USE_LANGGRAPH and _langgraph_analyze:
        try:
            logger.info("LangGraph 엔진으로 분석 시작 — 세션 %s", request.sessionId)
            return _langgraph_analyze(request)
        except Exception as e:
            logger.error("LangGraph 분석 실패 — 규칙 기반 엔진으로 폴백: %s", e)

    logger.info("규칙 기반 엔진으로 분석 — 세션 %s", request.sessionId)
    return rule_based_analyze(request)
