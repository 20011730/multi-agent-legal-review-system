# 1_build_db_auto.py
# 법제처 API → 법령 검색 → ID 추출 → 본문 가져오기 → 벡터 DB 저장

import os
import requests
import xml.etree.ElementTree as ET
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

load_dotenv()


# ✅ 1. 법령 검색 → ID 가져오기
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
    response = requests.get(url, params=params)
    print("status:", response.status_code)

    if response.status_code != 200:
        print("❌ 검색 API 실패")
        return None

    root = ET.fromstring(response.content)

    # 🔥 디버깅 (한 번만 확인)
    print("🔍 XML 일부 ↓")
    print(response.text[:500])

    # 🔥 핵심: 법령ID 기준으로 찾기 (태그명 무시)
    for elem in root.iter():
        if elem.tag == "법령ID" and elem.text:
            print(f"✅ 법령ID 발견: {elem.text}")
            return elem.text

    print("❌ 법령ID 못 찾음")
    return None


# ✅ 2. 법령ID → 본문 가져오기
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

    if response.status_code != 200:
        print("❌ 본문 API 실패")
        return None

    root = ET.fromstring(response.content)

    articles = []

    for item in root.findall(".//조문단위"):
        title = item.findtext("조문제목", default="")
        content = item.findtext("조문내용", default="")

        full_text = content

        # 항 내용까지 포함
        for clause in item.findall(".//항내용"):
            if clause.text:
                full_text += "\n" + clause.text

        if full_text.strip():
            articles.append({
                "text": f"{title}\n{full_text}",
                "article": title
            })

    print(f"✅ 조문 수집 완료: {len(articles)}개")

    return articles


# ✅ 3. 전체 파이프라인
def build_auto_rag(law_name):
    # 1. 법령ID 찾기
    law_id = get_law_id(law_name)
    if not law_id:
        print("❌ 종료")
        return

    # 2. 본문 가져오기
    articles = fetch_law_by_id(law_id)
    if not articles:
        print("❌ 본문 없음")
        return

    print("📄 샘플 조문 ↓")
    print(articles[0]["text"][:300])

    # 3. 텍스트 분할
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=400,
        chunk_overlap=50
    )

    texts = []
    metadatas = []

    for article in articles:
        chunks = text_splitter.split_text(article["text"])
        for chunk in chunks:
            texts.append(chunk)
            metadatas.append({
                "source": law_name,
                "article": article["article"]
            })

    print(f"✅ 총 chunk 수: {len(texts)}")

    # 4. 벡터 DB 저장
    persist_directory = "./chroma_db"

    vectorstore = Chroma.from_texts(
        texts=texts,
        embedding=OpenAIEmbeddings(model="text-embedding-3-small"),
        persist_directory=persist_directory,
        metadatas=metadatas
    )

    print(f"🎉 '{law_name}' RAG 구축 완료!")


# ✅ 실행
if __name__ == "__main__":
    build_auto_rag("부정경쟁방지")