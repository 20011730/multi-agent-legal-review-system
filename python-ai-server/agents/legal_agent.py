"""
법무 에이전트.
관련 법령/판례를 (선택적으로) 검색하여 법적 리스크를 분석한다.

라운드별 system_instruction 분기:
  라운드 1 — 핵심 법적 위험 식별
  라운드 2 — 비즈니스 측 수정안의 법적 충분성 평가
  라운드 3 — 실제 수정 표현을 구체적으로 제시

Chroma DB 정책 (선택 기능):
  - python-ai-server 내부 로컬 RAG: ./chroma_db (없으면 비활성, 일반 법률 지식으로 답변)
  - backend evidence 흐름은 별개로 동작 (Spring Boot의 LegalRetrievalService → /verdict 화면 표시)
  - 따라서 ./chroma_db 부재는 치명적 오류가 아님
"""

import os
import logging
from agents.llm_client import generate_with_retry  # provider=ollama (default)

logger = logging.getLogger(__name__)

# RAG 검색기는 lazy init (Chroma DB가 없을 수 있으므로)
_retriever = None
_retriever_init_attempted = False


def _get_retriever():
    """Chroma DB 검색기를 lazy 초기화한다. 없으면 None — 정상 동작."""
    global _retriever, _retriever_init_attempted
    if _retriever_init_attempted:
        return _retriever
    _retriever_init_attempted = True

    chroma_dir = os.getenv("CHROMA_DB_DIR", "./chroma_db")
    if not os.path.exists(chroma_dir):
        logger.info(
            "[INFO] Chroma DB 디렉토리(%s)가 없어 Python 내부 로컬 RAG는 비활성화됩니다. "
            "Backend evidence 주입은 별도로 동작합니다 (선택 기능 — 정상).",
            chroma_dir,
        )
        return None

    try:
        from langchain_huggingface import HuggingFaceEmbeddings
        from langchain_community.vectorstores import Chroma

        embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
        vectorstore = Chroma(persist_directory=chroma_dir, embedding_function=embedding)
        _retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
        logger.info("Chroma DB 검색기 초기화 완료 (path=%s)", chroma_dir)
        return _retriever
    except Exception as e:
        logger.warning("Chroma DB 초기화 실패 — Python 내부 RAG 비활성화: %s", e)
        return None


# ────────────────────── 라운드별 system_instruction ──────────────────────

_BUBBLE_STYLE = """
[출력 형식 — 메신저 토론 말풍선]
- 4~7문장, 1100자 이하로만 답하세요.
- 반드시 한국어로만 답하세요. 영어 문장이나 영어 제목을 섞지 마세요.
- 표, 마크다운 제목, 굵게 표시, 대괄호 라운드 제목을 쓰지 마세요.
- Verdict, Risk, source, vector, similarity, score 같은 내부 라벨을 쓰지 마세요.
- 자기소개 없이 바로 핵심 법적 판단 → 구체적 이유 → 다음 에이전트가 고려할 점 순서로 말하세요.
- 앞선 에이전트 의견이 있으면 자연스럽게 참조해 동의·보완·우려 중 하나를 분명히 하세요.
- 개인정보 동의, 처리위탁, 지원금 정산, 외주 계약, 지식재산권처럼 사안에 나온 구체 쟁점을 최소 1개 포함하세요.
- 첨부자료 본문이 제공된 경우 파일명만 말하지 말고, 본문에서 확인한 특약·조건·기간·권리 귀속 내용을 법적 판단에 직접 연결하세요.
- 확인해야 할 계약서·협약서·동의서 조항과 사용자가 바로 취할 행동을 최소 1개 포함하세요.
- 단순히 "확인해야 합니다"를 반복하지 말고, 보완하지 않으면 어떤 법적·계약상 문제가 생기는지 설명하세요.
- 법령/판례는 꼭 필요한 경우 1개만 짧게 언급하고, 긴 보고서는 쓰지 마세요.
"""

_LEGAL_ROUND_1 = """당신은 기업 법무팀 소속 법률 전문가입니다.

Round 1에서는 가장 중요한 법적 위험 1~2개만 짧게 짚으세요.
원문 또는 상황에서 문제가 되는 지점을 한 문장으로 연결하고, 왜 조심해야 하는지 설명하세요.
""" + _BUBBLE_STYLE

_LEGAL_ROUND_2 = """당신은 기업 법무팀 소속 법률 전문가입니다.

Round 2에서는 사용자 후속 질문이 있으면 "사용자 질문을 반영하면..."으로 시작해 답하세요.
삭제된 질문은 언급하지 말고, 현재 prompt에 남아 있는 질문만 반영하세요.
비즈니스 측 의견 중 수용 가능한 부분과 여전히 보완해야 할 법적 조건을 짧게 구분하세요.
""" + _BUBBLE_STYLE

_LEGAL_ROUND_3 = """당신은 기업 법무팀 소속 법률 전문가입니다.

Round 3에서는 최종 판단 전에 법무 관점의 결론을 4~7문장으로 정리하세요.
Round 1·2와 사용자 추가 질문을 모두 반영하고, 반드시 수정해야 할 조건 1개, 남는 법적 위험 1개, 확인해야 할 계약서·협약서·동의서 조항 1개를 포함하세요.
새로운 쟁점 나열은 금지하고, 최종 판정관이 결론을 낼 때 참고할 법적 우선순위를 분명히 말하세요.
""" + _BUBBLE_STYLE


def run_legal_agent(context_history: str, current_issue: str, round_num: int = 1) -> str:
    """법무 에이전트: 라운드별 다른 prompt + (선택) RAG 컨텍스트로 분석/평가/종합한다."""
    # RAG 컨텍스트 수집 (선택 — chroma_db 미존재 시 빈 문자열)
    rag_context = ""
    retriever = _get_retriever()
    if retriever is not None:
        try:
            docs = retriever.invoke(current_issue)
            rag_context = "\n".join([doc.page_content for doc in docs])
            logger.debug("Python 내부 RAG 검색 결과 %d건", len(docs))
        except Exception as e:
            logger.warning("Python 내부 RAG 검색 실패 — RAG 없이 진행: %s", e)

    # 라운드별 system_instruction
    if round_num <= 1:
        base = _LEGAL_ROUND_1
    elif round_num == 2:
        base = _LEGAL_ROUND_2
    else:
        base = _LEGAL_ROUND_3

    rag_block = (
        f"\n\n[참고 법령/판례 (Python 내부 RAG)]\n{rag_context}"
        if rag_context else
        "\n\n[참고: Python 내부 RAG 데이터 없음 — 일반 법률 지식 + backend evidence 흐름으로 보강됨]"
    )
    system_instruction = base + rag_block

    prompt = (
        f"검토 대상 안건:\n{current_issue}\n\n"
        f"--- 직전까지의 토론 내용 ---\n{context_history}\n\n"
        f"위 라운드 {round_num} 지침에 따라 응답하세요."
    )

    return generate_with_retry(system_instruction, prompt, temperature=0.6)
