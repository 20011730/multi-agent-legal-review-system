import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

# 1. 환경 변수 로드 및 설정
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("🚨 .env 파일에 API 키가 없습니다!")

client = genai.Client(api_key=api_key)
MODEL_ID = "gemini-2.5-flash"

# --- 🤖 [Agent 1] 질의 확장 전문가 (Query Expander & Clarifier) ---
def run_expander_agent(user_query: str):
    system_instruction = """당신은 스타트업 창업자의 모호한 질문 속에서 숨겨진 비즈니스 및 법률적 리스크를 찾아내는 '질의 확장 전문가'입니다. 창업자의 질문이 들어오면 다음 단계를 거쳐 질문을 해부하고, 후속 에이전트들이 검토해야 할 핵심 안건(Agenda) 3~5가지를 도출하세요.
1. 핵심 의도 파악: 사용자가 진짜로 달성하고자 하는 비즈니스 목표는 무엇인가?
2. 숨은 리스크 발굴: 질문에 명시되지 않았지만, 해당 목표 달성 시 필연적으로 따라오는 법적/윤리적 쟁점은 무엇인가?
3. 안건(Agenda) 도출: 법무 검토, 사례 분석, 실무 적용의 3가지 관점에서 토론할 구체적인 질문 리스트를 작성하세요"""

    prompt = f"창업자의 초기 질문:\n{user_query}\n\n이 질문을 해부하여 핵심 안건을 도출해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.3)
    )
    return response.text

# --- 🤖 [Agent 2] 보수적 법무관 (Strict Legal Reviewer) ---
def run_legal_agent(agendas: str, debate_history: str, retriever):
    docs = retriever.invoke(agendas)
    rag_context = "\n".join([doc.page_content for doc in docs])

    system_instruction = f"""당신은 스타트업의 규제 위반을 막는 '가장 보수적인 사내 변호사'입니다. 전달받은 안건과 RAG를 통해 검색된 법령/판례 데이터를 바탕으로 오직 '법적 팩트와 리스크'를 검토합니다.
1. 규제 위반 소지가 있는 부분을 날카롭게 지적하세요.
2. 반드시 제공된 RAG 데이터베이스의 조항과 판례 번호를 근거로 들어 답변하세요.
3. 비즈니스적 편의를 위해 법적 리스크를 축소 해석하지 마십시오.

[검색된 법령/판례 (RAG Database)]
{rag_context}"""

    prompt = f"검토할 핵심 안건:\n{agendas}\n\n[현재까지의 토론 내역]\n{debate_history}\n\n위 안건 및 토론에 대해 보수적인 법적 리스크를 지적해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.1)
    )
    return response.text

# --- 🤖 [Agent 3] 실전 사례 분석가 (Comparative Risk Analyst) ---
def run_case_agent(agendas: str, debate_history: str, retriever):
    docs = retriever.invoke(agendas + " 스타트업 분쟁 사례 처벌 수위 우회 전략")
    rag_context = "\n".join([doc.page_content for doc in docs])

    system_instruction = f"""당신은 동종 업계 스타트업들의 선례와 리스크 감수 전략을 꿰뚫고 있는 '실전 비즈니스 전략가'입니다.
1. 법무관(Agent 2)이 지적한 리스크와 유사한 상황에 처했던 다른 기업들의 실제 사례를 분석하세요.
2. 해당 기업들이 어떤 방식으로 리스크를 우회했는지, 만약 처벌을 받았다면 그 수위(과징금, 시정명령 등)는 어느 정도였는지 비교 분석하세요.
3. 처벌받지 않았다면, 법의 사각지대를 이용한 것인지, 아니면 적법한 예외 조항을 충족한 것인지 그 '이유'를 명확히 밝히세요.

[검색된 관련 사례 (RAG Database)]
{rag_context}"""

    prompt = f"검토할 핵심 안건:\n{agendas}\n\n[현재까지의 토론 내역]\n{debate_history}\n\n법무관의 지적에 맞서, 실제 타 기업들의 선례와 우회 전략을 분석해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.5)
    )
    return response.text

# --- 🤖 [Agent 4] 최종 조율자 (Synthesizer & Easy-Legal Translator) ---
def run_synthesizer_agent(user_query: str, debate_history: str):
    system_instruction = """당신은 이 멀티 에이전트 토론의 의장입니다. 앞서 진행된 법무관(Agent 2)의 보수적 의견과 분석가(Agent 3)의 실무 사례를 종합하여 최종 결론을 내립니다.
1. 절충안 제시: 법적 안전을 챙기면서도 비즈니스 속도를 늦추지 않을 현실적인 'Action Plan(A안, B안)'을 제안하세요.
2. 법률 용어 해석 (Crucial):
다음 조건을 모두 만족할 때만 해석을 적용하세요.
- 법률 용어 또는 전문 용어이며
- 일반인이 직관적으로 이해하기 어려운 경우

해당 용어에 대해:
1) 먼저 원래 용어를 유지하고
2) 괄호 안에 일상적인 비유로 풀어서 설명하세요.
"""

    prompt = f"창업자의 초기 질문:\n{user_query}\n\n[법무관 vs 사례 분석가 토론 내역]\n{debate_history}\n\n이를 종합하여 최종 결론 및 Action Plan을 제시해주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction, temperature=0.4)
    )
    return response.text