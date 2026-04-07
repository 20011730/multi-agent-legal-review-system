import os
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

#2_test_retriever.py
# .env 파일에서 환경변수 로드
load_dotenv()

def test_retriever(query: str):
    print(f"🔍 창업자(에이전트)의 질문: {query}\n")
    
    # 1. 저장된 로컬 DB 불러오기
    persist_directory = "./chroma_db"
    vectorstore = Chroma(
        persist_directory=persist_directory, 
        embedding_function=OpenAIEmbeddings(model="text-embedding-3-small")
    )

    # 2. 검색기 세팅 (가장 연관성 높은 조항 3개를 가져오도록 설정)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    retrieved_docs = retriever.invoke(query)

    # 3. 결과 출력
    print("--- 📑 에이전트에게 전달될 검색 결과(RAG) ---")
    for i, doc in enumerate(retrieved_docs):
        print(f"\n[참조 문서 {i+1}]")
        print(doc.page_content)
        print("-" * 50)

if __name__ == "__main__":
    # 시나리오 2 (타사 데이터 무단 크롤링) 관련 테스트 질문
    test_query = "경쟁사 웹사이트의 리뷰 데이터를 무단으로 크롤링해서 우리 서비스 초기 데이터로 쓰면 법에 걸리나요?"
    test_retriever(test_query)