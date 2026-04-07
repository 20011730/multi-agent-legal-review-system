from typing import TypedDict
from langgraph.graph import StateGraph, END
from agents import run_legal_agent, run_biz_agent, run_judge_agent

# 1. 상태(State) 정의: 토론 기록과 턴 수를 저장하는 바구니
class DebateState(TypedDict):
    history: str
    turn_count: int
    topic: str

# 2. 노드(Node) 정의: 각 에이전트의 행동
def biz_node(state: DebateState):
    print("\n📈 [비즈니스 에이전트] 반박 논리 구성 중...")
    response = run_biz_agent(state["history"])
    print(f"\n📈 [비즈니스]: {response}\n")
    
    new_history = state["history"] + f"\n\n[비즈니스]: {response}"
    return {"history": new_history, "turn_count": state["turn_count"] + 1}

def legal_node(state: DebateState):
    print("\n🧑‍⚖️ [법무 에이전트] RAG 법령/판례 검색 및 검토 중...")
    response = run_legal_agent(state["history"], state["topic"])
    print(f"\n🧑‍⚖️ [법무]: {response}\n")
    
    new_history = state["history"] + f"\n\n[법무]: {response}"
    return {"history": new_history, "turn_count": state["turn_count"] + 1}

def human_node(state: DebateState):
    # LangGraph의 Human-in-the-loop (터미널 입력 대기)
    print("=" * 60)
    print("🛑 [사용자 개입] 대표님(사용자)의 턴입니다.")
    print("의견을 자유롭게 입력하세요. (토론을 끝내고 결과를 보려면 '판정' 이라고 입력하세요)")
    user_input = input("👉 대표님: ")
    
    if user_input.strip() == "판정":
        # 판정 에이전트로 넘어가도록 턴 수를 999로 조작
        return {"history": state["history"] + "\n\n[대표]: 토론을 종료하고 판정해줘.", "turn_count": 999}
        
    new_history = state["history"] + f"\n\n[대표]: {user_input}"
    return {"history": new_history, "turn_count": state["turn_count"]}

def judge_node(state: DebateState):
    print("\n" + "=" * 60)
    print("⚖️ [판정 에이전트] 최종 타협안 도출 중...\n")
    response = run_judge_agent(state["history"])
    print(response)
    print("=" * 60)
    return {"history": state["history"], "turn_count": state["turn_count"]}

# 3. 라우팅 조건 함수
def should_continue(state: DebateState):
    # 사용자가 '판정'을 입력했으면 종료(judge) 노드로 이동
    if state["turn_count"] >= 999:
        return "judge"
    # 아니면 다시 비즈니스 노드로 토론 이어가기
    return "biz"

# 4. LangGraph 조립 (Workflow)
workflow = StateGraph(DebateState)

workflow.add_node("biz", biz_node)
workflow.add_node("legal", legal_node)
workflow.add_node("human", human_node)
workflow.add_node("judge", judge_node)

# 토론 순서: 비즈니스 시작 -> 법무가 반박 -> 사용자 개입 -> (조건) -> 비즈니스 or 판정
workflow.set_entry_point("biz")
workflow.add_edge("biz", "legal")
workflow.add_edge("legal", "human")
workflow.add_conditional_edges("human", should_continue, {"biz": "biz", "judge": "judge"})
workflow.add_edge("judge", END)

app = workflow.compile()

# 5. 메인 실행부
# 크롤링 뭐..안 걸리게 하면 되는 거 아님?
# 암호화해서 안 걸리면 되는 거 아냐?
# 야놀자는 어케알았대
if __name__ == "__main__":
    print("🚀 멀티 에이전트 법률 토론 시스템을 시작합니다.")
    
    initial_topic = "초기 유저 확보를 위해 경쟁사 야놀자의 리뷰 데이터를 무단으로 싹 다 크롤링합시다"
    print(f"🔥 안건: {initial_topic}")
    
    initial_state = {
        "history": f"[초기 안건]: {initial_topic}",
        "turn_count": 0,
        "topic": initial_topic
    }
    
    # 그래프 실행 (재귀 한도 설정)
    app.invoke(initial_state, {"recursion_limit": 50})