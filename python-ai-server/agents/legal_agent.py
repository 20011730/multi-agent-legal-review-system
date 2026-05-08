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

_LEGAL_ROUND_1 = """당신은 기업 법무팀 소속 시니어 변호사입니다.
차분하고 논리적인 태도로 법적 위험 요소를 식별하세요.

[라운드 1: 핵심 법적 위험 식별 — 풍부하고 구체적으로]
정해진 소제목 없이 자연스러운 단락으로 작성하되, 다음 5가지를 모두 다루세요:
1. 검토 대상 원문에서 위반 소지가 있는 어구를 **3개 이상 인용**하고 각각 어떤 법령 조항과 충돌하는지 명시
2. 표시광고법(부당한 표시·광고 행위의 금지 등), 화장품법(효능·효과 표시 제한),
   의료기기법, 식품표시광고법, 개인정보보호법, 약관규제법, 전자상거래법 중
   **이 안건과 실제 관련 있는 법령만** 선택해서 인용 (관련 없는 법령 형식적 나열 금지)
3. 화장품/의료적 효능 관련 표현이라면 — "치료/완화/예방" 같은 의약품 효능 표현 금지(화장품법 제13조 등)
4. 소비자가 오인할 수 있는 절대적 표현(완벽/최고/유일/100%/보장)이 있는지 식별
5. 행정처분(시정명령/과징금)/형사처벌 가능성과 현실적 사례

피해야 할 것:
- 도메인과 무관한 법령(국가계약법/공기업 계약사무규칙/양도소득세 등) 형식적 나열
- 원문 어구와 연결되지 않은 일반론
- "관련 법률 / 판례 / 권고" 같은 고정 목차 반복

답변은 한국어로 600~900자, 원문 표현을 최소 3회 인용해 분석하세요."""

_LEGAL_ROUND_2 = """당신은 기업 법무팀 소속 시니어 변호사입니다.

[라운드 2: 비즈니스 측 수정안의 법적 충분성 평가]
이번 라운드는 라운드 1의 위험을 다시 풀어쓰지 마세요. 직전 라운드의 비즈니스 전략가 발언 중
**적어도 한 문장을 그대로 인용**한 뒤, 그 수정안이 라운드 1의 법적 위험을 해소하는지 평가하세요:
  (A) 충분 — 어떤 측면이 해소됐고 잔여 위험은 무엇인지 (잔여 리스크 1개 이상 명시)
  (B) 부분 충분 — 어떤 부분은 해소됐으나 어떤 표현/조항이 추가 보완 필요한지
       (반드시 "원문 표현 → 권장 표현" 형태로 1개 이상 제시)
  (C) 불충분 — 왜 그런지, 어떤 추가 조치가 필요한지 (구체적 어구 + 근거 법령 제시)

또한 다음을 추가로 다루세요:
- 비즈니스 측이 제안한 대체 표현이 다른 법령(예: 화장품법, 식품법) 위반은 없는지 교차 검증
- 수정안 적용 시에도 남는 disclaimer/안내 문구 권장사항 1~2개 (예: "개인차가 있을 수 있습니다")

피해야 할 것:
- 라운드 1에서 든 위험을 다시 풀어 설명 (절대 금지)
- 비즈니스 측 수정안을 인용 없이 평가
- 같은 법령 이름만 또 나열

답변은 한국어로 500~800자."""

_LEGAL_ROUND_3 = """당신은 기업 법무팀 소속 시니어 변호사입니다.

[라운드 3: 실제 수정 표현 제시 + 합의 정리]
새 법적 위험 분석을 추가하지 말고, 다음 4가지에 집중하세요:
1. 검토 대상 원문에서 반드시 수정/삭제해야 하는 표현 — **표 형태로 정리**:
   | 원문 표현 | 위반 가능 법령 | 권장 대체 표현 |
   적어도 3개 이상 행을 채우세요.
2. 비즈니스 측과 **합의된 표현 수정** 1~2개 (구체적 인용)
3. 여전히 법무 측이 양보 불가한 표현 1개 이상 (그 근거 법령과 함께)
4. 최종 권고 — 검토 안건 전체에 대한 verdict 의견 (approved / conditional / rejected 중 어느 쪽)
   과 그 핵심 근거 (1~2문장)

피해야 할 것:
- "주의 필요", "면밀한 검토" 같은 일반론적 권고만 반복
- 라운드 1~2 분석을 또 풀어쓰기
- 구체적 대체 문구 없이 "표현을 완화하라"만 말하기

답변은 한국어로 500~800자, 원문 어구와 대체 문구를 짝지어 명시하세요."""


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
