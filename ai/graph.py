import os
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
#graph.py
# langsmith 확인링크 : https://smith.langchain.com/public/84b9b488-c135-4ebb-b3df-9bb7a9a21f24/r
# State 정의, Agnet 2(법무) Agent(3) 병렬처리
from agents import run_expander_agent, run_legal_agent, run_case_agent, run_synthesizer_agent

# RAG 세팅 (전역 로드)
embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embedding)
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 1. 상태(State) 정의
class AgentState(TypedDict):
    user_query: str
    agendas: str
    legal_review: str
    case_analysis: str
    final_solution: str

# 2. 노드(Node) 정의
def expander_node(state: AgentState):
    print("\n🔍 [질문 해부학자] 창업자의 질문 분석 중...")
    agendas = run_expander_agent(state["user_query"])
    print("✅ 안건 도출 완료")
    return {"agendas": agendas}

def legal_node(state: AgentState):
    print("\n🧑‍⚖️ [보수적 법무관] 법령/판례 기준 검토 중...")
    legal_review = run_legal_agent(state["agendas"], retriever)
    print("✅ 법무 검토 완료")
    return {"legal_review": legal_review}

def case_node(state: AgentState):
    print("\n📈 [실전 사례 분석가] 타 기업 판례 및 리스크 비교 중...")
    case_analysis = run_case_agent(state["agendas"], retriever)
    print("✅ 사례 분석 완료")
    return {"case_analysis": case_analysis}

def synthesizer_node(state: AgentState):
    print("\n⚖️ [최종 조율자] CEO 멘토의 최종 타협안 도출 및 번역 중...\n")
    final_solution = run_synthesizer_agent(state["legal_review"], state["case_analysis"])
    return {"final_solution": final_solution}

# 3. LangGraph 조립 (Workflow)
workflow = StateGraph(AgentState)

workflow.add_node("expander", expander_node)
workflow.add_node("legal", legal_node)
workflow.add_node("case", case_node)
workflow.add_node("synthesizer", synthesizer_node)

# 흐름 정의
workflow.set_entry_point("expander")

# 병렬 처리: expander가 끝나면 legal과 case가 동시에 실행됨
workflow.add_edge("expander", "legal")
workflow.add_edge("expander", "case")

# legal과 case가 모두 끝나야만 synthesizer로 넘어감
workflow.add_edge("legal", "synthesizer")
workflow.add_edge("case", "synthesizer")

workflow.add_edge("synthesizer", END)

app = workflow.compile()

# 4. 메인 실행부
if __name__ == "__main__":
    print("🚀 스타트업 멀티 에이전트 검토 시스템(v1) 테스트")
    
    # 창업자의 질문
    initial_query = "초기 유저 확보를 위해 경쟁사들의 리뷰 데이터를 크롤링 해도 되나요?"
    print(f"👉 사용자: {initial_query}\n")
    print("=" * 60)
    
    initial_state = {
        "user_query": initial_query,
        "agendas": "",
        "legal_review": "",
        "case_analysis": "",
        "final_solution": ""
    }
    
    # 그래프 실행
    result = app.invoke(initial_state)
    
    print("=" * 60)
    print("✨ [최종 결과 리포트] ✨\n")
    print(result["final_solution"])