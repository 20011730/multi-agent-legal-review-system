"""
법제처 API → 법령 본문 수집 → ChromaDB 구축.

사용법:
  cd ai
  python build_chroma_db.py

환경변수:
  LAW_API_KEY   — 법제처 OPEN API 인증키
  CHROMA_DB_DIR — ChromaDB 저장 경로 (기본: ./chroma_db)
"""

import os
import sys
import requests
import xml.etree.ElementTree as ET

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()

CHROMA_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
EMBED_MODEL = "jhgan/ko-sroberta-multitask"


def search_law_id(law_name: str) -> str | None:
    """법령명으로 법제처 API를 검색해 법령ID를 반환한다."""
    api_key = os.getenv("LAW_API_KEY")
    if not api_key:
        print("LAW_API_KEY 환경변수가 없습니다.")
        return None

    url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "query": law_name}

    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  검색 API 오류 ({law_name}): {e}")
        return None

    root = ET.fromstring(res.content)
    for elem in root.iter():
        if elem.tag == "법령ID" and elem.text:
            return elem.text

    print(f"  법령ID 없음: {law_name}")
    return None


def fetch_law_text(law_id: str, law_name: str) -> list[dict]:
    """법령ID로 조문 단위 본문을 가져온다."""
    api_key = os.getenv("LAW_API_KEY")
    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {"OC": api_key, "target": "law", "type": "XML", "ID": law_id}

    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  본문 API 오류 ({law_id}): {e}")
        return []

    root = ET.fromstring(res.content)
    articles = []

    for item in root.findall(".//조문단위"):
        article_no = item.findtext("조문번호", default="")
        title = item.findtext("조문제목", default="")
        content = item.findtext("조문내용", default="")

        full_text = content or ""
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
                "text": f"[{law_name}] 제{article_no}조 {title}\n{full_text}",
                "article_no": f"제{article_no}조",
            })

    print(f"  조문 {len(articles)}개 수집")
    return articles


def build_chroma_db(law_entries: list[dict]):
    """
    law_entries: law_List 테이블 행 목록
      필수: law_mst, law_name_kr
      선택: law_id (없으면 law_name_kr로 검색), law_type_name, dept_name, enforce_date
    """
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
    all_texts = []
    all_metadatas = []

    for entry in law_entries:
        law_mst = entry.get("law_mst", 0)
        law_name = entry.get("law_name_kr", "")
        law_id = entry.get("law_id") or search_law_id(law_name)

        print(f"\n[{law_mst}] {law_name} (law_id={law_id})")
        if not law_id:
            continue

        articles = fetch_law_text(law_id, law_name)
        for article in articles:
            chunks = splitter.split_text(article["text"])
            for chunk in chunks:
                all_texts.append(chunk)
                all_metadatas.append({
                    "law_mst": str(law_mst),
                    "law_id": law_id,
                    "law_name_kr": law_name,
                    "law_type_name": entry.get("law_type_name", ""),
                    "dept_name": entry.get("dept_name", ""),
                    "enforce_date": entry.get("enforce_date", ""),
                    "article_no": article["article_no"],
                    "source": "법제처",
                })

    if not all_texts:
        print("\n수집된 텍스트가 없어 DB를 생성하지 않습니다.")
        return

    print(f"\n임베딩 모델 로딩: {EMBED_MODEL}")
    embedding = HuggingFaceEmbeddings(model_name=EMBED_MODEL)

    print(f"ChromaDB 저장 중... ({len(all_texts)}개 청크 → {CHROMA_DIR})")
    Chroma.from_texts(
        texts=all_texts,
        embedding=embedding,
        persist_directory=CHROMA_DIR,
        metadatas=all_metadatas,
    )
    print(f"ChromaDB 구축 완료! {len(all_texts)}개 청크 저장됨")


# 백엔드 DB 연동 전까지 사용할 MVP 기본 법령 목록
# law_id를 모르면 비워두면 법령명으로 자동 검색
DEFAULT_LAW_ENTRIES = [
    {
        "law_mst": 1,
        "law_name_kr": "표시광고의공정화에관한법률",
        "law_type_name": "법률",
        "dept_name": "공정거래위원회",
    },
    {
        "law_mst": 2,
        "law_name_kr": "부정경쟁방지및영업비밀보호에관한법률",
        "law_type_name": "법률",
        "dept_name": "특허청",
    },
    {
        "law_mst": 3,
        "law_name_kr": "정보통신망이용촉진및정보보호등에관한법률",
        "law_type_name": "법률",
        "dept_name": "과학기술정보통신부",
    },
    {
        "law_mst": 4,
        "law_name_kr": "개인정보보호법",
        "law_type_name": "법률",
        "dept_name": "개인정보보호위원회",
    },
]

if __name__ == "__main__":
    build_chroma_db(DEFAULT_LAW_ENTRIES)
