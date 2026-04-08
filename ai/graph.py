import os
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

# agents.py에서 함수 가져오기 
from agents import run_expander_agent, run_legal_agent, run_case_agent, run_synthesizer_agent

# RAG 세팅 (전역 로드)
embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embedding)
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 1. 상태(State) 정의
class AgentState(TypedDict):
    user_query: str
    agendas: str
    debate_history: str  # 에이전트 간 토론 누적
    max_turns: int       # 💡 사용자가 설정하는 최대 토론 횟수
    turn_count: int      # 💡 현재 진행된 턴 수
    final_solution: str

# 2. 노드(Node) 정의
def expander_node(state: AgentState):
    print("\n🔍 [Agent 1] 질의 해부 및 핵심 안건 도출 중...")
    agendas = run_expander_agent(state["user_query"])
    print("✅ 안건 도출 완료\n" + "-" * 40)
    # 초기화: 토론 기록 비우고, 턴 카운트 0으로 시작
    return {"agendas": agendas, "debate_history": "", "turn_count": 0}

def case_node(state: AgentState):
    print(f"\n📈 [Agent 3] 실전 사례 분석가 - {state['turn_count'] + 1}차 사례 분석 및 우회 전략 수립 중...")
    response = run_case_agent(state["agendas"], state["debate_history"], retriever)
    new_history = state["debate_history"] + f"\n\n[실전 사례 분석가]:\n{response}"
    return {"debate_history": new_history}

def legal_node(state: AgentState):
    print(f"\n🧑‍⚖️ [Agent 2] 보수적 법무관 - {state['turn_count'] + 1}차 법리 검토 및 반박 중...")
    response = run_legal_agent(state["agendas"], state["debate_history"], retriever)
    new_history = state["debate_history"] + f"\n\n[보수적 법무관]:\n{response}"
    
    # 💡 법무관의 방어(턴)가 끝나면 turn_count를 1 증가시킴
    return {"debate_history": new_history, "turn_count": state["turn_count"] + 1}

def synthesizer_node(state: AgentState):
    print("\n⚖️ [Agent 4] 최종 조율자 - 최고 경영진 리포트 작성 중...\n")
    final_solution = run_synthesizer_agent(state["user_query"], state["debate_history"])
    return {"final_solution": final_solution}

# 3. 라우팅 조건 함수 (동적 횟수 제어)
def should_continue(state: AgentState):
    # 현재 턴 수가 사용자가 입력한 최대 턴 수(max_turns)에 도달했는지 확인
    if state["turn_count"] >= state["max_turns"]:
        return "synthesizer" # 목표 횟수 도달 시 최종 조율자로 이동
    return "case"            # 아직 도달하지 않았다면 사례 분석가로 돌아가서 다시 토론

# 4. LangGraph 조립 (Workflow)
workflow = StateGraph(AgentState)

workflow.add_node("expander", expander_node)
workflow.add_node("case", case_node)
workflow.add_node("legal", legal_node)
workflow.add_node("synthesizer", synthesizer_node)

# 흐름 정의: 질의 확장 -> 사례 분석 -> 법무 검토
workflow.set_entry_point("expander")
workflow.add_edge("expander", "case")
workflow.add_edge("case", "legal")

# 💡 조건부 엣지 추가: 법무 검토가 끝나면 should_continue 로직에 따라 이동
workflow.add_conditional_edges(
    "legal", 
    should_continue, 
    {
        "case": "case",               # 루프 반복
        "synthesizer": "synthesizer"  # 루프 탈출
    }
)

workflow.add_edge("synthesizer", END)

app = workflow.compile()

# 5. 메인 실행부
if __name__ == "__main__":
    print("🚀멀티 에이전트 검토 시스템 시작")
    
    # 💡 사용자로부터 질문과 토론 횟수를 동적으로 입력받음
    initial_query = input("\n👉 검토할 비즈니스 질문을 입력하세요: ")
    if not initial_query.strip():
        initial_query = "초기 유저 확보를 위해 경쟁사들의 리뷰 데이터를 크롤링 해도 되나요?"
        print(f"기본 질문으로 진행합니다: {initial_query}")
        
    try:
        turns_input = input("👉 토론 횟수(Max Turns)를 숫자로 입력하세요 (예: 2): ")
        max_turns = int(turns_input)
    except ValueError:
        print("숫자가 입력되지 않아 기본값(2)으로 설정합니다.")
        max_turns = 2
        
    print("\n" + "=" * 60)
    
    # 초기 상태(State) 주입
    initial_state = {
        "user_query": initial_query,
        "agendas": "",
        "debate_history": "",
        "max_turns": max_turns,
        "turn_count": 0,
        "final_solution": ""
    }
    
    # 그래프 실행
    result = app.invoke(initial_state)
    
    print("=" * 60)
    print("✨ [최종 결과 리포트] ✨\n")
    print(result["final_solution"])