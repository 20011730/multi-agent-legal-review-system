import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import AnalyzeRequest, AnalyzeResponse, AnalyzeStepResponse, ResumeAnalyzeRequest
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
_langgraph_start = None
_langgraph_resume = None
if USE_LANGGRAPH:
    try:
        from langgraph_analyzer import (
            analyze_with_langgraph,
            start_interactive_analysis,
            resume_interactive_analysis,
        )
        _langgraph_analyze = analyze_with_langgraph
        _langgraph_start = start_interactive_analysis
        _langgraph_resume = resume_interactive_analysis
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


@app.post("/analyze/start", response_model=AnalyzeStepResponse)
def analyze_start_endpoint(request: AnalyzeRequest):
    if USE_LANGGRAPH and _langgraph_start:
        try:
            logger.info("LangGraph 단계형 분석 시작 — 세션 %s", request.sessionId)
            return _langgraph_start(request)
        except Exception as e:
            logger.error("LangGraph 단계형 시작 실패: %s", e)
            raise HTTPException(status_code=500, detail=f"LangGraph start 실패: {e}")

    # LangGraph가 꺼져 있으면 기존 분석을 한 번에 수행하고 즉시 완료 응답으로 래핑
    logger.warning("LangGraph 비활성 상태에서 /analyze/start 호출됨 — 즉시 완료 모드로 처리")
    full = rule_based_analyze(request)
    return AnalyzeStepResponse(
        state="COMPLETED",
        analysisPhase="JUDGING",
        messages=full.messages,
        finalDecision=full.finalDecision,
        evidences=full.evidences,
    )


@app.post("/analyze/resume", response_model=AnalyzeStepResponse)
def analyze_resume_endpoint(request: ResumeAnalyzeRequest):
    if USE_LANGGRAPH and _langgraph_resume:
        try:
            logger.info("LangGraph 단계형 분석 재개 — 세션 %s", request.sessionId)
            return _langgraph_resume(request)
        except Exception as e:
            logger.error("LangGraph 단계형 재개 실패: %s", e)
            raise HTTPException(status_code=500, detail=f"LangGraph resume 실패: {e}")
    raise HTTPException(status_code=400, detail="LangGraph 비활성 상태에서는 resume를 사용할 수 없습니다.")
