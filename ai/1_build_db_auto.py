# 1_build_db_auto.py
# 법제처 API → 법령 검색 → ID → 본문 → 조문/호/목 파싱 → RAG 저장

import os
import requests
import xml.etree.ElementTree as ET
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma

# 🔥 무료 embedding 
from langchain_community.embeddings import HuggingFaceEmbeddings

#1_build_db_auto.py

load_dotenv()

#구조 확인하고 싶을때 : http://www.law.go.kr/DRF/lawService.do?OC=hyejin&target=law&type=XML&ID=000308
#법 구조 : 조문 → 항 → 호 → 목
# ✅ 1. 법령 검색 → ID
def get_law_id(law_name):
    api_key = os.getenv("MOGL_API_KEY")

    url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {
        "OC": api_key,
        "target": "law",
        "type": "XML",
        "query": law_name
    }

    print(f"📡 법령 검색 중: {law_name}")
    # 수정된 부분: API 연결 및 응답 오류 처리 추가
    try:
        response = requests.get(url, params=params)
        print("status:", response.status_code)
        
        if response.status_code != 200:
            print(f"🚨 API 응답 오류: 정상적인 상태 코드가 아닙니다. (코드: {response.status_code})")
            return None
            
    except Exception as e:
        print(f"🚨 API 연결 오류 발생 (법령 본문 조회): 서버가 연결을 끊었거나 네트워크 문제가 있습니다.\n상세 내용: {e}")
        print("response.status_code :" + response.status_code)
        return None

    root = ET.fromstring(response.content)

    for elem in root.iter():
        if elem.tag == "법령ID" and elem.text:
            print(f"✅ 법령ID 발견: {elem.text}")
            return elem.text

    print("❌ 법령ID 못 찾음")
    return None


# ✅ 2. 본문 가져오기 + 완벽 파싱
def fetch_law_by_id(law_id):
    api_key = os.getenv("MOGL_API_KEY")

    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {
        "OC": api_key,
        "target": "law",
        "type": "XML",
        "ID": law_id
    }

    print("📡 법령 본문 조회 중...")
    response = requests.get(url, params=params)
    print("status:", response.status_code)

    root = ET.fromstring(response.content)

    articles = []

    for item in root.findall(".//조문단위"):
        article_no = item.findtext("조문번호", default="")
        title = item.findtext("조문제목", default="")
        content = item.findtext("조문내용", default="")

        full_text = content if content else ""

        # 🔥 호 + 목까지 완전 파싱
        for ho in item.findall(".//호"):
            ho_num = ho.findtext("호번호", default="")
            ho_text = ho.findtext("호내용", default="")

            if ho_text:
                full_text += f"\n{ho_num} {ho_text}"

            # 🔥 목 추가 (핵심)
            for mok in ho.findall(".//목"):
                mok_num = mok.findtext("목번호", default="")
                mok_text = mok.findtext("목내용", default="")

                if mok_text:
                    full_text += f"\n  {mok_num} {mok_text}"

        if full_text.strip():
            articles.append({
                "text": f"제{article_no}조 {title}\n{full_text}",
                "article": f"제{article_no}조",
                "law_id": law_id
            })

    print(f"✅ 조문 수집 완료: {len(articles)}개")
    return articles


# ✅ 3. RAG 구축 (수정)
def build_auto_rag(law_name):
    # 1. 법령ID 찾기 & 본문 가져오기
    law_id = get_law_id(law_name)
    if not law_id: return
    articles = fetch_law_by_id(law_id)
    if not articles: return

    # 2. 텍스트 분할
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=50)
    texts = []
    metadatas = []

    for article in articles:
        chunks = text_splitter.split_text(article["text"])
        for chunk in chunks:
            texts.append(chunk)
            metadatas.append({
                "law_name": law_name, "article": article["article"], "law_id": article["law_id"]
            })

    # 🌟 추가: 수동 판례 데이터(legal_docs.txt) 같이 넣기
    file_path = "data/legal_docs.txt"
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            case_text = f.read()
            # 판례도 적당히 잘라서 넣기
            case_chunks = text_splitter.split_text(case_text)
            for chunk in case_chunks:
                texts.append(chunk)
                metadatas.append({"law_name": "대법원 판례", "article": "크롤링 판례", "law_id": "none"})

    # 🌟 수정: 한국어 특화 무료 임베딩 모델로 교체!
    embedding = HuggingFaceEmbeddings(
        model_name="jhgan/ko-sroberta-multitask"
    )

    vectorstore = Chroma.from_texts(
        texts=texts, embedding=embedding, persist_directory="./chroma_db", metadatas=metadatas
    )
    print(f"\n🎉 '{law_name}' 및 판례 데이터 RAG 구축 완료! (총 {len(texts)}개 청크)")


# ✅ 실행
if __name__ == "__main__":
    build_auto_rag("부정경쟁방지")