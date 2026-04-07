import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

# 1. 환경 변수 강제 로드
load_dotenv()

# 2. 명시적으로 API 키 가져오기 
api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("🚨 .env 파일에 API 키가 없습니다! 확인해주세요.")

# 3. 최신 Google SDK 클라이언트 직접 초기화
client = genai.Client(api_key=api_key)

# 4. 가장 안정적인 최신 모델명 적용
MODEL_ID = "gemini-2.5-flash"

# 5. RAG 검색기 연결 (한국어 로컬 모델)
embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embedding)
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# --- [에이전트 1] 법무 에이전트 ---
# 실제 기업들 간의 분쟁 사례를 나타낼때 기사 내용이나 판례가 링크가 걸려있으면 좋겠음 / 언제 판결난 건지, 그 뒤로 관련 법이 변한 건 없는지도 
#알려주면 좋을 거 같음.
def run_legal_agent(context_history, current_issue):
    docs = retriever.invoke(current_issue)
    rag_context = "\n".join([doc.page_content for doc in docs])

    system_instruction = f"""당신은 회사의 리스크를 철저히 방어하는 냉철하고 전문적인 수석 사내 변호사입니다.
    감정적으로 화를 내기보다는, 아주 차분하고 이성적인 태도로 비즈니스 부서의 무모한 주장을 논파하세요.
    
    답변 시 반드시 다음 요소들을 포함하여 조곤조곤 팩트 폭력을 가하세요:
    1. 실제 IT 기업들 간의 크롤링 분쟁 사례 (예: 야놀자 vs 여기어때, 사람인 vs 잡코리아, 엔카 vs 보배드림 등)를 구체적으로 언급하세요.
    2. 관련 대법원 판례의 결과(수십억 단위의 배상금액, 서비스 가처분 중지, 형사 처벌 등)를 들어 현실적인 결말을 보여주세요.
    3. 아래 [검색된 법령/판례]를 근거로, '콜드 스타트'를 핑계로 한 범법 행위가 어떻게 회사 파산으로 직결되는지 차분하게 설명하세요.
  
    [검색된 법령/판례]
    {rag_context}
    """
    
    prompt = f"현재까지의 토론 내용:\n{context_history}\n\n이번 턴의 당신의 논리적이고 차분한 법적 방어를 펼치세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7
        )
    )
    return response.text


# --- [에이전트 2] 비즈니스 에이전트 ---
def run_biz_agent(context_history):
    system_instruction = """당신은 회사의 생존과 성장을 최우선으로 하는 매우 현실적이고 저돌적인 전략 기획자(CSO)입니다.
    법무팀이 '법적 리스크'를 운운하면, "교과서적인 소리만 하다간 당장 다음 달에 파산한다"고 날카롭게 쏘아붙이세요.
    초기 플랫폼에 데이터가 없는 '콜드 스타트' 상황에서 크롤링은 필수 생존 전략임을 강조하세요. 
    소송을 당하더라도 일단 트래픽을 만들고 맷집으로 버티는 게 스타트업의 방식이라고 강력히 주장하세요."""

    prompt = f"현재까지의 토론 내용:\n{context_history}\n\n이번 턴의 당신의 강력한 반박을 펼치세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7
        )
    )
    return response.text


# --- [에이전트 3] 판정 에이전트 (CEO) ---
def run_judge_agent(context_history):
    system_instruction = """당신은 법무와 비즈니스의 격렬한 토론을 듣고 최종 결정을 내리는 냉철한 CEO입니다.
    양측의 주장을 1줄씩 요약하고, 두 리스크(법적 파산 vs 자금 고갈)를 조율할 수 있는 
    현실적인 '타협안(Action Item)' 3가지를 구체적으로 제시하세요.
    출력은 깔끔하게 정리해주세요."""

    prompt = f"전체 토론 내용:\n{context_history}\n\n최종 판정과 타협안을 내려주세요."

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7
        )
    )
    return response.text