import os
import requests
import numpy as np
import xml.etree.ElementTree as ET
from kss import split_sentences
from sentence_transformers import SentenceTransformer, util
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings

LAW_API_KEY = "hyejin"
# 환경 변수에 세팅하여 fetch_law_full_text 내부의 os.getenv가 읽을 수 있도록 처리
os.environ["LAW_API_KEY"] = LAW_API_KEY

# ================= 1. RAG 및 임베딩 설정 =================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(os.path.dirname(CURRENT_DIR), "chroma_db") 

# 파인튜닝된 임베딩 모델 로드 (RunPod 로컬 경로에 맞게 수정)
TUNED_MODEL_PATH = "./legal-e5-finetuned"
embedding = HuggingFaceEmbeddings(model_name=TUNED_MODEL_PATH)
vectorstore = Chroma(persist_directory=CHROMA_PATH, embedding_function=embedding)

# 의미 기반 청킹을 위한 베이스 모델 로드 (논문 기준)
chunking_model = SentenceTransformer('intfloat/multilingual-e5-base')

# ================= 2. 법령 정보 가져오기 =================
def fetch_law_full_text(law_id):
    api_key = os.getenv("LAW_API_KEY") # 발급받은 키 사용
    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "ID": law_id}

    response = requests.get(url, params=params)
    root = ET.fromstring(response.content)
    
    full_law_text = ""
    for item in root.findall(".//조문단위"):
        article_no = item.findtext("조문번호", default="")
        title = item.findtext("조문제목", default="")
        content = item.findtext("조문내용", default="")
        
        text_block = f"제{article_no}조 {title}\n{content}" if content else ""
        
        for ho in item.findall(".//호"):
            ho_num = ho.findtext("호번호", default="")
            ho_text = ho.findtext("호내용", default="")
            if ho_text: text_block += f"\n{ho_num} {ho_text}"
                
            for mok in ho.findall(".//목"):
                mok_num = mok.findtext("목번호", default="")
                mok_text = mok.findtext("목내용", default="")
                if mok_text: text_block += f"\n  {mok_num} {mok_text}"
        
        if text_block:
            full_law_text += text_block + "\n\n"
            
    return full_law_text

# ================= 3. 의미 기반 청킹 로직 =================
def semantic_chunking(text: str, p: int = 60) -> list[str]:
    """문장 간 의미적 연관성을 바탕으로 분할 지점을 결정하는 방식"""
    sentences = split_sentences(text)
    if len(sentences) <= 1:
        return sentences
        
    # E5(Base) 모델을 이용해 각 문장을 임베딩
    embeddings = chunking_model.encode(sentences, convert_to_tensor=True)
    
    similarities = []
    # 인접 문장 간 코사인 유사도 계산
    for i in range(len(sentences) - 1):
        sim = util.cos_sim(embeddings[i], embeddings[i+1]).item()
        similarities.append(sim)
        
    # 하위 p% 구간을 임계값(threshold)으로 설정
    threshold = np.percentile(similarities, p)
    
    chunks = []
    current_chunk = sentences[0]
    
    # 유사도가 해당 임계값보다 낮아지는 지점을 의미적 분할 경계로 활용
    for i, sim in enumerate(similarities):
        if sim < threshold:
            chunks.append(current_chunk)
            current_chunk = sentences[i+1]
        else:
            current_chunk += " " + sentences[i+1]
            
    chunks.append(current_chunk)
    return chunks

# ================= 4. RAG 적재 및 검색 =================
def add_dynamic_evidences_to_rag(evidences: list[dict]):
    """백엔드가 찾은 법령의 ID를 이용해 본문을 파싱하고 시맨틱 청킹 후 RAG에 넣기"""
    if not evidences: return

    texts = []
    metadatas = []

    for ev in evidences:
        source = ev.get("sourceType", "UNKNOWN")
        title = ev.get("title", "")
        
        if source == "LAW":
            law_id = ev.get("referenceId", "")
            print(f"📡 '{title}' 본문(조/항/호/목) 파싱 및 의미 기반 청킹 중...")
            content = fetch_law_full_text(law_id)
        else:
            # 판례(CASE)인 경우 기본 요약을 사용
            content = ev.get("summary", "")

        if content.strip():
            # 랭체인 스플리터 대신 논문의 시맨틱 청킹 적용
            chunks = semantic_chunking(content, p=60)
            
            for chunk in chunks:
                # 파인튜닝된 E5 모델의 포맷팅 제약 반영
                formatted_chunk = f"passage: {chunk}"
                texts.append(formatted_chunk)
                metadatas.append({"law_name": title, "source": source})

    if texts:
        vectorstore.add_texts(texts=texts, metadatas=metadatas)
        print(f"✅ 파싱 및 적재 완료! 총 {len(texts)}개의 의미 단위 청크가 DB에 동기화됨.")


def get_relevant_context(user_query: str) -> str:
    """사용자 질문(user_query)과 가장 유사한 조각을 DB에서 찾아 문자열로 반환합니다."""
    # E5 검색을 위해 질문에 query 접두어 추가
    formatted_query = f"query: {user_query}"
    
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    retrieved_docs = retriever.invoke(formatted_query)
    
    context_parts = []
    for i, doc in enumerate(retrieved_docs):
        source = doc.metadata.get('law_name', '출처불명')
        # 출력 시에는 모델 학습용으로 붙였던 'passage: '를 보기 좋게 제거
        clean_content = doc.page_content.replace("passage: ", "").strip()
        context_parts.append(f"[참조 문서 {i+1} | {source}]\n{clean_content}")
        
    return "\n\n".join(context_parts)

# ================= 5. 실행 및 테스트 블록 =================
if __name__ == "__main__":
    print("=== 🚀 실전 사례 분석가 RAG 시스템 테스트 ===")
    
    # 가상의 백엔드 검색 결과 (크롤링, 부정경쟁방지법 관련 판례 요약)
    # 실제 API 연동 전, 논문의 시맨틱 청킹과 벡터DB 적재를 테스트하기 위한 더미 데이터입니다.
    mock_evidences = [
        {
            "sourceType": "CASE",
            "title": "데이터 크롤링 부정경쟁행위 판례",
            "summary": "경쟁사의 웹사이트에서 공개된 데이터를 웹 크롤링을 통해 수집하는 행위가 부정경쟁방지법 위반에 해당하는지가 쟁점이다. 웹사이트에 공개된 정보라 하더라도, 해당 데이터가 경쟁사의 상당한 투자나 노력으로 만들어진 성과물이라면 보호받을 가치가 있다. 이를 공정한 상거래 관행이나 경쟁질서에 반하는 방법으로 자신의 영업을 위하여 무단으로 사용하는 것은 타인의 경제적 이익을 침해하는 행위이다. 다만, 단순한 사실 정보나 누구나 쉽게 얻을 수 있는 정보의 수집까지 부정경쟁행위로 보기는 어렵다. 따라서 크롤링의 주체, 목적, 수집한 데이터의 질과 양, 경쟁사의 피해 정도를 종합적으로 고려하여 판단하여야 한다."
        }
    ]

    print("\n[1단계] 백엔드 증거 자료 RAG DB 적재 시작...")
    add_dynamic_evidences_to_rag(mock_evidences)
    
    print("\n[2단계] 사용자 질의응답 테스트 (종료하려면 'q' 입력)")
    while True:
        user_input = input("\n👤 사용자 질문: ")
        
        if user_input.strip().lower() == 'q':
            print("테스트를 종료합니다.")
            break
            
        print("🔍 관련된 법률/판례 청크를 검색 중입니다...\n")
        context = get_relevant_context(user_input)
        
        print("================ [검색된 참조 문맥] ================")
        print(context)
        print("====================================================")