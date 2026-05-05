"""ChromaDB 기반 법령 RAG 검색 유틸리티."""

import logging
import os

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

logger = logging.getLogger(__name__)

CHROMA_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
EMBED_MODEL = "jhgan/ko-sroberta-multitask"

_vectorstore = None


def _get_vectorstore() -> Chroma | None:
    global _vectorstore
    if _vectorstore is not None:
        return _vectorstore
    if not os.path.exists(CHROMA_DIR):
        logger.warning("ChromaDB 없음 (%s) — RAG 비활성화. build_chroma_db.py를 먼저 실행하세요.", CHROMA_DIR)
        return None
    try:
        # local_files_only=True: 캐시된 모델만 사용, HuggingFace 네트워크 요청 차단
        embedding = HuggingFaceEmbeddings(
            model_name=EMBED_MODEL,
            model_kwargs={"local_files_only": True},
        )
        _vectorstore = Chroma(persist_directory=CHROMA_DIR, embedding_function=embedding)
        logger.info("ChromaDB 로드 완료 (%s)", CHROMA_DIR)
    except Exception as e:
        logger.error("ChromaDB 로드 실패: %s", e)
        return None
    return _vectorstore


def retrieve(query: str, k: int = 3) -> str:
    """
    쿼리와 관련된 법령 조문을 ChromaDB에서 검색한다.
    ChromaDB가 없으면 빈 문자열을 반환해 기존 흐름을 유지한다.
    """
    vs = _get_vectorstore()
    if vs is None:
        return ""

    try:
        docs = vs.similarity_search(query, k=k)
    except Exception as e:
        logger.warning("RAG 검색 실패: %s", e)
        return ""

    parts = []
    for doc in docs:
        meta = doc.metadata
        law_name = meta.get("law_name_kr", "")
        article_no = meta.get("article_no", "")
        parts.append(f"[{law_name} {article_no}]\n{doc.page_content}")

    return "\n\n".join(parts)
