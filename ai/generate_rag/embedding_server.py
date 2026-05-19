"""
참조용 E5 임베딩 마이크로서비스.

목적
----
backend의 ExternalEmbeddingService(Spring Boot, Java)가 호출하는 HTTP 임베딩
엔드포인트를 로컬에서 띄워서, Docker ChromaDB의 ``laws_e5`` 컬렉션(768차원,
E5 base 임베딩)을 backend의 검색 흐름에 연결하기 위한 가장 가벼운 어댑터입니다.

본 스크립트는 **개발 보조 도구**이며 운영 흐름의 일부가 아닙니다. 운영 배포는
별도 합의 후 진행하세요.

API 스펙 (backend ExternalEmbeddingService가 가정하는 모양)
------------------------------------------------------------
POST /embed
    body:  {"texts": ["...", "..."]}
    resp:  {"embeddings": [[float, ...], [float, ...]]}

설계 결정
---------
- 요청 본문의 ``mode`` 필드로 prefix를 분기합니다.
    - ``mode="query"``   → 각 텍스트에 ``"query: "`` 부착 (기본값)
    - ``mode="passage"`` → 각 텍스트에 ``"passage: "`` 부착
  E5 모델은 query/passage를 비대칭으로 학습했기 때문에 양쪽이 다른 prefix를 써야 정합성이 맞습니다.
- backend(Spring)의 ``ExternalEmbeddingService``는 현재 ``{"texts":[...]}`` 만 보내고 mode를
  지정하지 않으므로 기본값 ``query`` 가 적용됩니다 — backend는 검색(query) 경로에서만 이 서비스를
  호출하기 때문에 이 default 가 안전합니다.
- 대량 적재(ingestion) 의 ``passage: `` prefix 부착은 ``ai/generate_rag/4-2.insertChromaDB.py``
  가 로컬에서 직접 수행하므로 이 서비스를 거치지 않습니다. 다만 향후 다른 적재 경로가
  이 서비스를 사용한다면 반드시 ``mode="passage"`` 로 요청해야 합니다.
- ``/embed/passage`` 별칭도 제공 (mode를 잊지 않도록 명시적 endpoint).
- normalize_embeddings=True — 컬렉션이 cosine space로 생성되어 있어 동일 정규화 필요.

기동 방법
---------
1) 의존성 (최초 1회):
     pip install fastapi uvicorn sentence-transformers

2) 실행:
     export EMBEDDING_HOST=127.0.0.1
     export EMBEDDING_PORT=9100
     export EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-base
     python ai/generate_rag/embedding_server.py

3) 헬스 체크 (read-only):
     curl -s http://localhost:9100/health
     curl -s -X POST http://localhost:9100/embed \
       -H 'Content-Type: application/json' \
       -d '{"texts":["표시광고법 부당광고"]}'  | python3 -m json.tool

backend 연결
------------
다음 ENV를 동시에 설정한 뒤 backend 재시작:
    APP_RAG_ENABLED=true
    APP_RAG_EMBEDDING_PROVIDER=external
    RAG_EMBEDDING_DIM=768
    RAG_EMBEDDING_EXTERNAL_URL=http://localhost:9100
    RAG_EMBEDDING_EXTERNAL_PATH=/embed
    CHROMA_LAWS_COLLECTION=laws_e5

위 ENV 중 일부만 설정하면 dim mismatch 또는 baseline laws로 회귀하므로 반드시 **네 개 모두**
함께 설정해야 합니다.

주의
----
- 본 서비스가 죽으면 ExternalEmbeddingService는 ``SimpleHashEmbeddingService``(384차원)로
  fallback하며, 그 결과 dimension mismatch로 검색이 실패합니다. 운영 단일화 전에는
  fallback 경로 동작도 함께 점검하세요.
"""

import logging
import os
from typing import List

# ─────────────────────────────────────────────────────────────────────
# FastAPI / Pydantic v2 메모
#   - 본 파일은 `from __future__ import annotations` 를 사용하지 **않습니다**.
#     해당 import 가 있으면 모든 타입 힌트가 ForwardRef(str)로 평가되어 FastAPI 의
#     라우트 시그니처 introspection 시 다음 오류가 발생합니다:
#       PydanticUserError: TypeAdapter[Annotated[ForwardRef('EmbedRequest'), Body(...)]] is not fully defined
#   - Pydantic 모델(EmbedRequest, EmbedResponse)은 반드시 **모듈 레벨**에 정의해야 합니다.
#     함수 내부에 정의하면 FastAPI 가 라우트 파싱 시 클래스를 해석하지 못해
#     동일 ForwardRef 오류 또는 자동 Body 추론 실패(422)로 이어집니다.
# ─────────────────────────────────────────────────────────────────────
from fastapi import Body, FastAPI, HTTPException
from pydantic import BaseModel, Field

LOG = logging.getLogger("e5-embedding-server")


class EmbedRequest(BaseModel):
    """POST /embed, /embed/passage 의 요청 body."""

    texts: List[str] = Field(default_factory=list)
    # "query" (기본) | "passage" — E5 비대칭 prefix 분기용
    mode: str = Field(default="query")


class EmbedResponse(BaseModel):
    """POST /embed, /embed/passage 의 응답."""

    embeddings: List[List[float]]
    model: str
    dimension: int
    mode: str


def _build_app() -> FastAPI:
    """FastAPI 앱 빌드.

    - 모델 클래스(EmbedRequest/EmbedResponse)는 모듈 레벨에 이미 정의되어 있으므로
      라우트 시그니처에서 ForwardRef 해석 문제가 발생하지 않는다.
    - SentenceTransformer 만 lazy import — 컴파일/검사 단계에서 무거운 의존성을 피한다.
    """
    from sentence_transformers import SentenceTransformer

    model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
    LOG.info("[E5] loading model: %s", model_name)
    model = SentenceTransformer(model_name)

    app = FastAPI(title="E5 embedding (query/passage) for backend RAG", version="0.2.1")
    dim = int(model.get_sentence_embedding_dimension())

    def _encode(texts: List[str], mode: str) -> List[List[float]]:
        if not texts:
            raise HTTPException(status_code=400, detail="texts가 비어 있습니다.")
        if mode not in ("query", "passage"):
            raise HTTPException(
                status_code=400,
                detail=f"mode는 'query' 또는 'passage'만 허용됩니다 (받음: {mode!r}).",
            )
        prefix = "query: " if mode == "query" else "passage: "
        prefixed = [f"{prefix}{t or ''}" for t in texts]
        vecs = model.encode(prefixed, normalize_embeddings=True)
        return [v.tolist() for v in vecs]

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "model": model_name,
            "dimension": dim,
            "default_mode": "query",
            "supported_modes": ["query", "passage"],
        }

    # `req: EmbedRequest = Body(...)` 로 명시해 자동 추론 실패 케이스를 차단.
    # (Body 어노테이션이 없어도 모듈 레벨 정의면 일반적으로 정상 동작하지만,
    #  명시함으로써 FastAPI 버전 차이에 영향받지 않게 한다.)
    @app.post("/embed", response_model=EmbedResponse)
    def embed(req: EmbedRequest = Body(...)):
        embs = _encode(req.texts, req.mode)
        return EmbedResponse(embeddings=embs, model=model_name, dimension=dim, mode=req.mode)

    @app.post("/embed/passage", response_model=EmbedResponse)
    def embed_passage(req: EmbedRequest = Body(...)):
        # mode 필드 무시 — 이 endpoint는 항상 passage prefix
        embs = _encode(req.texts, "passage")
        return EmbedResponse(embeddings=embs, model=model_name, dimension=dim, mode="passage")

    return app


def main():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    try:
        import uvicorn  # noqa: WPS433 — 런타임 의존
    except ImportError as e:
        raise SystemExit(
            "uvicorn / fastapi / sentence-transformers 가 필요합니다. "
            "pip install fastapi uvicorn sentence-transformers 후 다시 실행하세요."
        ) from e

    host = os.getenv("EMBEDDING_HOST", "127.0.0.1")
    port = int(os.getenv("EMBEDDING_PORT", "9100"))
    LOG.info("[E5] serving on http://%s:%d", host, port)
    uvicorn.run(_build_app(), host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
