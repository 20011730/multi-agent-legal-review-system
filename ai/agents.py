import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
#agents.py
#에이전트 프롬프트 및 로직 업데이트


# 1. 환경 변수 강제 로드
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("🚨 .env 파일에 API 키가 없습니다!")

client = genai.Client(api_key=api_key)
MODEL_ID = "gemini-2.5-flash"

# --- 🤖 [Agent 1] 질문 해부학자 (Query Expander) ---
def run_expander_agent(user_query: str):
    system_instruction = """당신은 스타트업 창업자의 모호한 질문 속에서 숨겨진 비즈니스 및 법률적 리스크를 찾아내는 '질의 확장 전문가'입니다.
    창업자의 질문이 들어오면 다음 단계를 거쳐 질문을 해부하고, 후속 에이전트들이 검토해야 할 핵심 안건(Agenda) 3가지를 도출하세요.
    1. 핵심 의도: 사용자가 달성하고자 하는 비즈니스 목표
    2. 숨은 리스크: 해당 목표 달성 시 따라오는 법적/윤리적 쟁점
    3. 구체적 안건 3가지 (글머리 기호로 명확히 작성)"""

    prompt = f"창업자의 초기 질문:\n{user_query}\n\n이 질문을 해부하여 핵심 안건을 도출해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.3) # 정확도를 위해 온도 낮춤
    )
    return response.text

# --- 🤖 [Agent 2] 보수적 법무관 (Strict Legal Reviewer) ---
def run_legal_agent(agendas: str, retriever):
    # 안건을 바탕으로 RAG 검색 수행
    docs = retriever.invoke(agendas)
    rag_context = "\n".join([doc.page_content for doc in docs])

    system_instruction = f"""당신은 스타트업의 규제 위반을 막는 '가장 보수적인 사내 변호사'입니다.
    전달받은 안건과 아래 [검색된 법령/판례]를 바탕으로 오직 '법적 팩트와 최악의 리스크'만을 검토합니다.
    1. 타협하지 말고 규제 위반 소지가 있는 부분을 날카롭게 지적하세요.
    2. 반드시 제공된 데이터베이스의 조항과 판례를 근거로 들어 답변하세요.
    
    [검색된 법령/판례]
    {rag_context}"""

    prompt = f"검토해야 할 핵심 안건:\n{agendas}\n\n위 안건에 대한 보수적인 법적 리스크를 검토해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.1)
    )
    return response.text

# --- 🤖 [Agent 3] 실전 사례 분석가 (Case Analyst) ---
def run_case_agent(agendas: str, retriever):
    docs = retriever.invoke(agendas + " 분쟁 사례 타기업")
    rag_context = "\n".join([doc.page_content for doc in docs])

    system_instruction = f"""당신은 동종 업계 스타트업들의 선례와 리스크 감수 전략을 꿰뚫고 있는 '실전 비즈니스 전략가'입니다.
    1. 전달받은 안건과 관련된 타 기업들의 실제 사례를 분석하세요.
    2. 해당 기업들이 어떻게 처벌받았는지, 혹은 어떻게 법망을 피했는지 실무적 관점에서 비교 분석하세요.
    
    [참조 데이터]
    {rag_context}"""

    prompt = f"분석할 안건:\n{agendas}\n\n위 안건에 대해 타 기업의 실전 사례를 분석해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.5)
    )
    return response.text

# --- 🤖 [Agent 4] 최종 조율자 (CEO / Synthesizer) ---
def run_synthesizer_agent(legal_review: str, case_analysis: str):
    system_instruction = """당신은 이 멀티 에이전트 토론의 의장이자, 창업자의 멘토인 '스타트업 CEO'입니다.
    법무관의 의견과 사례 분석가의 의견을 종합하여 최종 결론을 내립니다.
    1. 절충안 제시: 법적 안전을 챙기면서도 비즈니스 속도를 늦추지 않을 현실적인 'Action Plan(A안, B안)'을 제안하세요.
    2. 눈높이 번역: 모든 설명은 이제 막 창업한 초보자도 이해할 수 있도록 일상적인 비유를 사용하세요.
    3. 어려운 법률 용어(예: 부정경쟁방지법, 가처분 등)가 등장하면 반드시 괄호 안에 한 줄 설명을 덧붙이세요."""

    prompt = f"[보수적 법무 검토]\n{legal_review}\n\n[실전 사례 분석]\n{case_analysis}\n\n이를 종합하여 최종 타협안을 쉬운 용어로 정리해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.7)
    )
    return response.text