import os
from dotenv import load_dotenv
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

load_dotenv()

def test_retriever(query: str):
    print(f"🔍 창업자의 질문: {query}\n")
    
    # 1. DB 구축 시 사용했던 것과 "동일한" 무료 임베딩 모델 로드
    embedding = HuggingFaceEmbeddings(
        model_name="jhgan/ko-sroberta-multitask"  # 똑같이 한국어 모델로 맞춰줍니다.
    )

    # 2. 로컬 DB 불러오기
    persist_directory = "./chroma_db"
    vectorstore = Chroma(
        persist_directory=persist_directory, 
        embedding_function=embedding
    )

    # 3. 검색기 세팅 (가장 연관성 높은 3개 가져오기)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    retrieved_docs = retriever.invoke(query)

    # 4. 결과 출력
    print("--- 📑 에이전트에게 전달될 검색 결과(RAG) ---")
    for i, doc in enumerate(retrieved_docs):
        print(f"\n[참조 문서 {i+1} | 출처: {doc.metadata.get('article', '알수없음')}]")
        print(doc.page_content)
        print("-" * 50)

if __name__ == "__main__":
    test_query = "경쟁사 웹사이트의 리뷰 데이터를 무단으로 크롤링해서 우리 서비스 초기 데이터로 쓰면 법에 걸리나요?"
    test_retriever(test_query)