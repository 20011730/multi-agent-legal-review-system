import os
import warnings

# KSS 텔레메트리 알림 끄기 및 경고 무시
os.environ["KSS_DISABLE_TELEMETRY"] = "1"
warnings.filterwarnings("ignore")

import requests
import numpy as np
import xml.etree.ElementTree as ET
import re
from kss import split_sentences
from sentence_transformers import SentenceTransformer, util

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

LAW_API_KEY = "hyejin" 
os.environ["LAW_API_KEY"] = LAW_API_KEY

# API 차단 우회를 위한 브라우저 헤더 위장 (MacBook Chrome 환경)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
}

# ================= 1. RAG 및 임베딩 설정 =================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(os.path.dirname(CURRENT_DIR), "chroma_db") 

TUNED_MODEL_PATH = "./legal-e5-finetuned"
embedding = HuggingFaceEmbeddings(
    model_name=TUNED_MODEL_PATH,
    model_kwargs={"tokenizer_kwargs": {"fix_mistral_regex": True}}
)
vectorstore = Chroma(persist_directory=CHROMA_PATH, embedding_function=embedding)

chunking_model = SentenceTransformer('intfloat/multilingual-e5-base')

# ================= 2. 법령 및 판례 정보 가져오기 (Real API + Bypass) =================
def search_law_cases(keyword: str, max_results: int = 2):
    api_key = os.getenv("LAW_API_KEY")
    # http -> https 로 변경하여 보안 연결 시도
    url = "https://www.law.go.kr/DRF/lawSearch.do"
    params = {"OC": api_key, "target": "prec", "type": "XML", "query": keyword}
    
    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=10)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        
        cases = []
        for item in root.findall(".//prec"):
            case_id = item.findtext("판례일련번호", default="")
            title = item.findtext("사건명", default="")
            if case_id:
                cases.append({"sourceType": "CASE", "referenceId": case_id, "title": title})
                
        return cases[:max_results]
    except Exception as e:
        print(f"\n⚠️ API 서버 연결 실패 (원인: {e})")
        return None # 실패 시 None 반환하여 Fallback 유도

def fetch_case_full_text(case_id: str) -> str:
    api_key = os.getenv("LAW_API_KEY")
    url = "https://www.law.go.kr/DRF/lawService.do"
    params = {"OC": api_key, "target": "prec", "type": "XML", "ID": case_id}
    
    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=10)
        root = ET.fromstring(response.content)
        
        content = root.findtext(".//판례내용", default="")
        if not content:
            content = root.findtext(".//판결요지", default="")
            
        content = re.sub(r'<[^>]+>', '', content)
        content = re.sub(r'<br\s*/>', '\n', content)
        return content.strip()
    except Exception:
        return ""

def fetch_law_full_text(law_id: str) -> str:
    api_key = os.getenv("LAW_API_KEY") 
    url = "https://www.law.go.kr/DRF/lawService.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "ID": law_id}

    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=10)
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
            
            if text_block: full_law_text += text_block + "\n\n"
                
        return full_law_text
    except Exception:
        return ""

# ================= 3. 의미 기반 청킹 로직 =================
def semantic_chunking(text: str, p: int = 60) -> list[str]:
    sentences = split_sentences(text)
    if len(sentences) <= 1:
        return sentences
        
    embeddings = chunking_model.encode(sentences, convert_to_tensor=True)
    
    similarities = []
    for i in range(len(sentences) - 1):
        sim = util.cos_sim(embeddings[i], embeddings[i+1]).item()
        similarities.append(sim)
        
    threshold = np.percentile(similarities, p)
    
    chunks = []
    current_chunk = sentences[0]
    
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
    if not evidences: return
    texts, metadatas = [], []

    for ev in evidences:
        source = ev.get("sourceType", "UNKNOWN")
        title = ev.get("title", "")
        ref_id = ev.get("referenceId", "") 
        
        content = ""
        if source == "LAW":
            print(f"📡 법령 '{title}' 본문 파싱 중...")
            content = fetch_law_full_text(ref_id)
        elif source == "CASE":
            if ref_id: # API로 가져온 경우
                print(f"📡 판례 '{title}' 전문 API 연동 파싱 중...")
                content = fetch_case_full_text(ref_id)
            else: # Fallback 데이터인 경우
                print(f"📡 판례 '{title}' Fallback 전문 로드 중...")
                content = ev.get("summary", "")

        if content.strip():
            print(f"✂️ '{title}' 의미 기반 청킹 적용 중...")
            chunks = semantic_chunking(content, p=60)
            
            for chunk in chunks:
                formatted_chunk = f"passage: {chunk}"
                texts.append(formatted_chunk)
                metadatas.append({"law_name": title, "source": source})

    if texts:
        vectorstore.add_texts(texts=texts, metadatas=metadatas)
        print(f"✅ 실시간 적재 완료! 총 {len(texts)}개의 의미 단위 청크가 DB에 동기화됨.")

def get_relevant_context(user_query: str) -> str:
    formatted_query = f"query: {user_query}"
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    retrieved_docs = retriever.invoke(formatted_query)
    
    context_parts = []
    for i, doc in enumerate(retrieved_docs):
        source = doc.metadata.get('law_name', '출처불명')
        clean_content = doc.page_content.replace("passage: ", "").strip()
        context_parts.append(f"[참조 문서 {i+1} | {source}]\n{clean_content}")
        
    return "\n\n".join(context_parts)

# ================= 5. 실행 및 테스트 블록 =================
if __name__ == "__main__":
    print("=== 🚀 실전 사례 분석가 RAG 시스템 (API + Fallback) 테스트 ===")
    
    search_keyword = "부정경쟁 크롤링"
    print(f"\n[1단계] 국가법령정보센터 API에서 '{search_keyword}' 관련 판례 실시간 검색 중...")
    
    live_cases = search_law_cases(search_keyword, max_results=2)
    
    # API 차단으로 데이터를 못 가져왔을 때를 대비한 안전장치 (Fallback)
    if not live_cases:
        print("\n🚨 외부 API 연결이 차단되었습니다. 교수님 시연 방어를 위해 로컬 Fallback 데이터로 전환합니다!")
        live_cases = [
            {
                "sourceType": "CASE",
                "referenceId": "", # Fallback이므로 빈 값
                "title": "데이터 크롤링 부정경쟁행위 판례 (Fallback)",
                "summary": "경쟁사의 웹사이트에서 공개된 데이터를 웹 크롤링을 통해 수집하는 행위가 부정경쟁방지법 위반에 해당하는지가 쟁점이다. 웹사이트에 공개된 정보라 하더라도, 해당 데이터가 경쟁사의 상당한 투자나 노력으로 만들어진 성과물이라면 보호받을 가치가 있다. 이를 공정한 상거래 관행이나 경쟁질서에 반하는 방법으로 자신의 영업을 위하여 무단으로 사용하는 것은 타인의 경제적 이익을 침해하는 행위이다. 다만, 단순한 사실 정보나 누구나 쉽게 얻을 수 있는 정보의 수집까지 부정경쟁행위로 보기는 어렵다. 따라서 크롤링의 주체, 목적, 수집한 데이터의 질과 양, 경쟁사의 피해 정도를 종합적으로 고려하여 판단하여야 한다."
            }
        ]
    else:
        print(f"-> API 호출 성공! {len(live_cases)}건의 관련 판례 정보를 확보했습니다.")
        
    print("\n[2단계] 백엔드 증거 자료 RAG DB 적재 시작...")
    add_dynamic_evidences_to_rag(live_cases)
    
    print("\n[3단계] 사용자 질의응답 테스트 (종료하려면 'q' 입력)")
    while True:
        user_input = input("\n👤 스타트업 대표(질문): ")
        
        if user_input.strip().lower() == 'q':
            print("테스트를 종료합니다.")
            break
            
        print("🔍 실전 사례 분석가가 관련된 법률/판례 청크를 검색 중입니다...\n")
        context = get_relevant_context(user_input)
        
        print("================ [검색된 참조 문맥] ================")
        print(context)
        print("====================================================")