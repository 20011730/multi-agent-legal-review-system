# 1_build_db_auto.py
# 법제처 API를 호출하여 법령을 가져온 뒤, OpenAI를 통해 벡터화하여 저장
import os
import requests
import xml.etree.ElementTree as ET
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

load_dotenv()

def fetch_law_from_mogl(law_name):
    """법제처 API를 통해 특정 법령의 전문을 가져옵니다."""
    api_key = os.getenv("MOGL_API_KEY")
    # 법령 일련번호를 먼저 찾아야 하지만, 여기서는 검색어로 직접 호출하는 예시입니다.
    # 실제 운영 시에는 법령ID를 검색하는 단계가 선행되는 것이 좋습니다.
    url = f"http://www.law.go.kr/DRF/lawService.do?OC={api_key}&target=law&type=XML&query={law_name}"
    
    print(f"📡 '{law_name}' 데이터를 법제처에서 가져오는 중...")
    response = requests.get(url)
    print(response.status_code)
    #제대로 API 호출했는지 확인 
    if response.status_code != 200:
        print("❌ API 호출 실패")
        return None
    
    # XML 파싱 (조항 텍스트만 추출)
    root = ET.fromstring(response.content)
    articles = []
    #잘 가져왔는지 확인
    print(len(articles))

    for item in root.findall(".//조문"):
        article_title = item.find("조문내용").text if item.find("조문내용") is not None else ""
        article_full = ""
        for content in item.findall(".//항내용"):
            article_full += content.text + "\n"
        
        if article_title:
            articles.append(f"{article_title}\n{article_full}")
    
    return "\n\n".join(articles)

def build_auto_rag(law_name):
    # 1. 법령 데이터 수집
    law_text = fetch_law_from_mogl(law_name)
    if not law_text: return

    # 2. 텍스트 분할
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=50)
    chunks = text_splitter.split_text(law_text)
    print(f"✅ 수집 완료: {len(chunks)}개의 조항 조각 생성")

    # 3. 벡터 DB 적재
    persist_directory = "./chroma_db"
    vectorstore = Chroma.from_texts(
        texts=chunks,
        embedding=OpenAIEmbeddings(model="text-embedding-3-small"),
        persist_directory=persist_directory,
        metadatas=[{"source": law_name} for _ in chunks] # 메타데이터 자동 부여
    )
    print(f"✅ '{law_name}' RAG 구축 완료!")

if __name__ == "__main__":
    # 시나리오 2에 필요한 '부정경쟁방지법' 자동 구축
    build_auto_rag("부정경쟁방지 및 영업비밀보호에 관한 법률")