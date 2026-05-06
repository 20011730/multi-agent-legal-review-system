import logging
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from schemas import (
    AnalyzeRequest, AnalyzeResponse, EvidenceItem,
    PhaseOneResponse, ContinueRequest, ContinueResponse,
)
from agents import run_debate, run_debate_phase1, run_debate_phase2
from services.evidence_service import collect_evidences
import rag

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(title="Legal Review AI Server", version="2.0.0")


@app.on_event("startup")
async def startup_event():
    rag._get_vectorstore()


_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0", "model": "phi3.5", "type": "LLM-based"}


# ── 기존 호환 엔드포인트 (ai_only 자동 실행) ──
@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(request: AnalyzeRequest):
    messages, final_decision = run_debate(
        content=request.content,
        situation=request.situation,
        review_type=request.reviewType,
        company_name=request.companyName,
        industry=request.industry,
        context_window=request.contextWindow,
    )
    evidences_raw = collect_evidences(
        content=request.content,
        situation=request.situation,
        review_type=request.reviewType,
    )
    evidences = [EvidenceItem(**ev) for ev in evidences_raw]

    return AnalyzeResponse(
        messages=messages,
        finalDecision=final_decision,
        evidences=evidences,
    )


# ── 인터랙티브 모드: Phase 1 ──
@app.post("/analyze/start", response_model=PhaseOneResponse)
def analyze_start(request: AnalyzeRequest):
    """
    Round 1(병렬) → Round 2(순차) → Round 3(순차) 실행 후 중단.
    반환된 debateSessionId로 /analyze/continue 호출.
    """
    messages, session_id = run_debate_phase1(
        content=request.content,
        situation=request.situation,
        review_type=request.reviewType,
        company_name=request.companyName,
        industry=request.industry,
        context_window=request.contextWindow,
    )
    return PhaseOneResponse(debateSessionId=session_id, messages=messages)


# ── 인터랙티브 모드: Phase 2 ──
@app.post("/analyze/continue", response_model=ContinueResponse)
def analyze_continue(request: ContinueRequest):
    """
    사용자 질문/의견을 받아 Explainer → Round 4 → 권고 → 판정 실행.
    """
    try:
        messages, final_decision = run_debate_phase2(
            session_id=request.debateSessionId,
            user_question=request.userQuestion,
            user_opinion=request.userOpinion,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ContinueResponse(messages=messages, finalDecision=final_decision)
