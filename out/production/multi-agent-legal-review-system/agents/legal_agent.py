"""
RAG 기반 법무 에이전트.
Chroma DB에서 관련 법령/판례를 검색하여 법적 리스크를 분석합니다.
원본: ai_hyejin_retry 브랜치 agents.py의 run_legal_agent
"""

import os
import logging
from agents.gemini_client import generate_with_retry

logger = logging.getLogger(__name__)

# RAG 검색기는 lazy init (Chroma DB가 없을 수 있으므로)
_retriever = None


def _get_retriever():
    """Chroma DB 검색기를 lazy 초기화한다."""
    global _retriever
    if _retriever is not None:
        return _retriever

    try:
        from langchain_huggingface import HuggingFaceEmbeddings
        from langchain_community.vectorstores import Chroma

        chroma_dir = os.getenv("CHROMA_DB_DIR", "./chroma_db")
        if not os.path.exists(chroma_dir):
            logger.warning("Chroma DB 디렉토리가 없습니다: %s — RAG 없이 동작합니다.", chroma_dir)
            return None

        embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
        vectorstore = Chroma(persist_directory=chroma_dir, embedding_function=embedding)
        _retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
        logger.info("Chroma DB 검색기 초기화 완료")
        return _retriever
    except Exception as e:
        logger.error("Chroma DB 초기화 실패: %s — RAG 없이 동작합니다.", e)
        return None


def run_legal_agent(context_history: str, current_issue: str) -> str:
    """법무 에이전트: RAG로 관련 법령을 검색하고 법적 리스크를 분석한다."""
    # RAG 컨텍스트 수집
    rag_context = ""
    retriever = _get_retriever()
    if retriever:
        try:
            docs = retriever.invoke(current_issue)
            rag_context = "\n".join([doc.page_content for doc in docs])
            logger.info("RAG 검색 결과 %d건", len(docs))
        except Exception as e:
            logger.error("RAG 검색 실패: %s", e)

    system_instruction = f"""당신은 기업의 법적 리스크를 철저히 분석하는 수석 사내 변호사입니다.
차분하고 논리적인 태도로 법적 위험 요소를 지적하세요.

답변 시 반드시 다음을 포함하세요:
1. 관련 법률 조항 및 위반 가능성
2. 실제 판례나 제재 사례 (알고 있는 경우)
3. 위반 시 예상되는 법적 결과 (과징금, 시정명령 등)

{f'[검색된 법령/판례]{chr(10)}{rag_context}' if rag_context else '[참고 법령 데이터 없음 — 일반 법률 지식으로 답변하세요]'}

중요: 답변은 한국어로, 300자 이상 작성하세요."""

    prompt = f"검토 대상 안건:\n{current_issue}\n\n현재까지의 토론 내용:\n{context_history}\n\n법적 관점에서 분석해주세요."

    return generate_with_retry(system_instruction, prompt, temperature=0.7)
