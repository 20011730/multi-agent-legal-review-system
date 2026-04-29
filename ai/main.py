import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from schemas import AnalyzeRequest, AnalyzeResponse, EvidenceItem
from agents import run_debate
from services.evidence_service import collect_evidences

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(title="Legal Review AI Server (LLM)", version="1.0.0")

_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0", "model": "phi3.5", "type": "LLM-based"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(request: AnalyzeRequest):
    messages, final_decision = run_debate(
        content=request.content,
        situation=request.situation,
        review_type=request.reviewType,
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
