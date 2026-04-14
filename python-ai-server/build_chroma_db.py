"""
법제처 API → 법령 검색 → 본문 파싱 → Chroma DB 구축.
원본: ai_hyejin_retry 브랜치 1_build_db_auto.py

사용법:
  cd python-ai-server
  python build_chroma_db.py

환경변수:
  MOGL_API_KEY  — 법제처 OPEN API 인증키 (또는 .env 파일에 설정)
"""

import os
import sys
import requests
import xml.etree.ElementTree as ET

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()

CHROMA_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")


def get_law_id(law_name: str) -> str | None:
    """법제처 API로 법령명을 검색하여 법령ID를 반환한다."""
    api_key = os.getenv("MOGL_API_KEY") or os.getenv("LAW_API_KEY")
    if not api_key:
        print("🚨 MOGL_API_KEY 또는 LAW_API_KEY 환경변수가 설정되지 않았습니다.")
        return None

    url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "query": law_name}

    print(f"📡 법령 검색 중: {law_name}")
    try:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code != 200:
            print(f"🚨 API 응답 오류 (코드: {response.status_code})")
            return None
    except Exception as e:
        print(f"🚨 API 연결 오류: {e}")
        return None

    root = ET.fromstring(response.content)
    for elem in root.iter():
        if elem.tag == "법령ID" and elem.text:
            print(f"✅ 법령ID 발견: {elem.text}")
            return elem.text

    print("❌ 법령ID 없음")
    return None


def fetch_law_by_id(law_id: str) -> list[dict]:
    """법령ID로 본문을 조회하여 조문 단위로 파싱한다."""
    api_key = os.getenv("MOGL_API_KEY") or os.getenv("LAW_API_KEY")
    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "ID": law_id}

    print("📡 법령 본문 조회 중...")
    response = requests.get(url, params=params, timeout=30)
    root = ET.fromstring(response.content)

    articles = []
    for item in root.findall(".//조문단위"):
        article_no = item.findtext("조문번호", default="")
        title = item.findtext("조문제목", default="")
        content = item.findtext("조문내용", default="")

        full_text = content if content else ""

        for ho in item.findall(".//호"):
            ho_num = ho.findtext("호번호", default="")
            ho_text = ho.findtext("호내용", default="")
            if ho_text:
                full_text += f"\n{ho_num} {ho_text}"
            for mok in ho.findall(".//목"):
                mok_num = mok.findtext("목번호", default="")
                mok_text = mok.findtext("목내용", default="")
                if mok_text:
                    full_text += f"\n  {mok_num} {mok_text}"

        if full_text.strip():
            articles.append({
                "text": f"제{article_no}조 {title}\n{full_text}",
                "article": f"제{article_no}조",
                "law_id": law_id,
            })

    print(f"✅ 조문 수집 완료: {len(articles)}개")
    return articles


def build_rag(law_names: list[str]):
    """여러 법령을 검색하여 Chroma DB를 구축한다."""
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=50)
    all_texts = []
    all_metadatas = []

    for law_name in law_names:
        law_id = get_law_id(law_name)
        if not law_id:
            continue
        articles = fetch_law_by_id(law_id)
        for article in articles:
            chunks = text_splitter.split_text(article["text"])
            for chunk in chunks:
                all_texts.append(chunk)
                all_metadatas.append({
                    "law_name": law_name,
                    "article": article["article"],
                    "law_id": article["law_id"],
                })

    # 수동 판례 데이터 (있으면 추가)
    case_file = "data/legal_docs.txt"
    if os.path.exists(case_file):
        print(f"📄 판례 데이터 추가: {case_file}")
        with open(case_file, "r", encoding="utf-8") as f:
            case_text = f.read()
        case_chunks = text_splitter.split_text(case_text)
        for chunk in case_chunks:
            all_texts.append(chunk)
            all_metadatas.append({"law_name": "대법원 판례", "article": "판례", "law_id": "none"})

    if not all_texts:
        print("🚨 수집된 텍스트가 없습니다. DB를 생성하지 않습니다.")
        return

    print(f"\n🔧 임베딩 모델 로딩 중 (jhgan/ko-sroberta-multitask)...")
    embedding = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")

    print(f"📦 Chroma DB 생성 중... ({len(all_texts)}개 청크 → {CHROMA_DIR})")
    Chroma.from_texts(
        texts=all_texts,
        embedding=embedding,
        persist_directory=CHROMA_DIR,
        metadatas=all_metadatas,
    )
    print(f"\n🎉 Chroma DB 구축 완료! ({len(all_texts)}개 청크, 저장: {CHROMA_DIR})")


# 기본 법령 목록 (MVP 데모용)
DEFAULT_LAWS = [
    "표시광고의공정화에관한법률",
    "부정경쟁방지및영업비밀보호에관한법률",
    "정보통신망이용촉진및정보보호등에관한법률",
    "개인정보보호법",
]

if __name__ == "__main__":
    laws = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_LAWS
    print(f"🚀 Chroma DB 빌드 시작 — 대상 법령: {laws}")
    build_rag(laws)
