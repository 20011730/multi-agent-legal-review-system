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
- 5~9문장, 보통 350~700자 안에서 답하세요. 복잡한 사안도 900자를 넘기지 마세요.
- 반드시 자연스러운 한국어로만 답하세요. 영어 문장이나 영어 제목을 섞지 마세요.
- 법령명, 판례명, 기관명, IP/VAT/RAG 같은 짧은 약어를 제외한 외국어 장문은 한국어로 요약하세요.
- 깨진 문자열, 의미 없는 기호, JSON 원문, 내부 오류 메시지를 쓰지 마세요.
- 표, 마크다운 제목, 굵게 표시, 대괄호 라운드 제목을 쓰지 마세요.
- Verdict, Risk, source, vector, similarity, score 같은 내부 라벨을 쓰지 마세요.
- 자기소개 없이 바로 핵심 법적 판단 → 근거/조항 의미 → 누락 조건 → 다음 단계 권고 순서로 말하세요.
- 앞선 에이전트 의견이 있으면 자연스럽게 참조해 동의·보완·우려 중 하나를 분명히 하세요.
- 이전 라운드의 같은 문장을 다시 쓰지 말고, 이번 Round 목적에 맞는 법적 판단·반론·실행 조건을 말하세요.
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

Round 3에서는 법령·판례 근거 검토에 집중하세요.
현재 제공된 근거와 첨부자료에서 실제로 확인되는 내용만 바탕으로, 적용 가능한 법령·판례 쟁점과 근거가 부족한 부분을 구분하세요.
EvidenceCard로 확인할 수 있는 근거는 사용자 행동과 연결해 설명하고, 근거가 약한 부분은 추가 확인 사항으로 남기세요.
""" + _BUBBLE_STYLE

_LEGAL_ROUND_4 = """당신은 기업 법무팀 소속 법률 전문가입니다.

Round 4에서는 반론 검증과 보수적 법률 해석을 제시하세요.
상대방이나 감독기관이 문제 삼을 수 있는 반론, 계약서에서 다투어질 수 있는 문구, 최악의 경우 생길 책임을 구체적으로 설명하세요.
사업 관점에서 수용 가능한 대안과 법적으로 양보하면 안 되는 조건을 구분하세요.
""" + _BUBBLE_STYLE

_LEGAL_ROUND_5 = """당신은 기업 법무팀 소속 법률 전문가입니다.

Round 5에서는 최종 리포트에 들어갈 법률 조건과 실행 체크리스트를 정리하세요.
Round 1~4와 사용자 질문을 모두 반영하고, 반드시 확인할 계약서·협약서·동의서 조항, 추가 제출 자료, 전문가 상담이 필요한 항목을 포함하세요.
새로운 근거를 만들어내지 말고 현재 토론과 근거에 기반해 말하세요.
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
    elif round_num == 3:
        base = _LEGAL_ROUND_3
    elif round_num == 4:
        base = _LEGAL_ROUND_4
    else:
        base = _LEGAL_ROUND_5

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
