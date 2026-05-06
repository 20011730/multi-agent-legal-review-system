"""
법제처 API → 법령 + 판례 수집 → ChromaDB 구축.

사용법:
  cd ai
  python build_chroma_db.py

환경변수:
  LAW_API_KEY   — 법제처 OPEN API 인증키 (기본: minijn)
  CHROMA_DB_DIR — ChromaDB 저장 경로 (기본: ./chroma_db)
"""

import os
import requests
import xml.etree.ElementTree as ET

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()

API_KEY = os.getenv("LAW_API_KEY", "minijn")
CHROMA_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
EMBED_MODEL = "jhgan/ko-sroberta-multitask"

splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)


# ── 법령 수집 ──

def search_law_id(law_name: str) -> str | None:
    url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {"OC": API_KEY, "target": "law", "type": "XML", "query": law_name}
    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  법령 검색 오류 ({law_name}): {e}")
        return None

    root = ET.fromstring(res.content)
    for elem in root.iter():
        if elem.tag == "법령ID" and elem.text:
            return elem.text

    print(f"  법령ID 없음: {law_name}")
    return None


def fetch_law_text(law_id: str, law_name: str) -> list[dict]:
    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {"OC": API_KEY, "target": "law", "type": "XML", "ID": law_id}
    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  법령 본문 오류 ({law_id}): {e}")
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
                "source": "법령",
            })

    print(f"  조문 {len(articles)}개 수집")
    return articles


# ── 판례 수집 ──

def search_prec_ids(query: str, display: int = 10) -> list[str]:
    from datetime import datetime, timedelta
    date_to = datetime.today().strftime("%Y%m%d")
    date_from = (datetime.today() - timedelta(days=365 * 5)).strftime("%Y%m%d")

    url = "http://www.law.go.kr/DRF/lawSearch.do"
    params = {
        "OC": API_KEY,
        "target": "prec",
        "type": "XML",
        "query": query,
        "display": display,
        "datFrom": date_from,
        "datTo": date_to,
    }
    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  판례 검색 오류 ({query}): {e}")
        return []

    root = ET.fromstring(res.content)
    ids = []
    for elem in root.iter():
        if elem.tag == "판례일련번호" and elem.text:
            ids.append(elem.text)
    return ids


def fetch_prec_text(prec_id: str) -> dict | None:
    url = "http://www.law.go.kr/DRF/lawService.do"
    params = {"OC": API_KEY, "target": "prec", "type": "XML", "ID": prec_id}
    try:
        res = requests.get(url, params=params, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"  판례 본문 오류 ({prec_id}): {e}")
        return None

    root = ET.fromstring(res.content)

    case_name = root.findtext(".//사건명", default="")
    case_no = root.findtext(".//사건번호", default="")
    court = root.findtext(".//법원명", default="")
    judgment_date = root.findtext(".//선고일자", default="")
    judgment_type = root.findtext(".//판결유형", default="")
    판시사항 = root.findtext(".//판시사항", default="")
    판결요지 = root.findtext(".//판결요지", default="")
    참조법령 = root.findtext(".//참조법령", default="")

    full_text = f"[판례] {case_name} ({case_no})\n법원: {court} | 선고일: {judgment_date} | 유형: {judgment_type}\n참조법령: {참조법령}\n\n판시사항:\n{판시사항}\n\n판결요지:\n{판결요지}"

    if not (판시사항 or 판결요지):
        return None

    return {
        "text": full_text,
        "case_name": case_name,
        "case_no": case_no,
        "court": court,
        "source": "판례",
    }


# ── ChromaDB 구축 ──

def build_chroma_db():
    all_texts = []
    all_metadatas = []

    # 1. 법령 수집
    print("\n=== 법령 수집 시작 ===")
    for entry in LAW_LIST:
        law_name = entry["law_name_kr"]
        law_id = entry.get("law_id") or search_law_id(law_name)
        print(f"\n[법령] {law_name} (law_id={law_id})")
        if not law_id:
            continue

        articles = fetch_law_text(law_id, law_name)
        for article in articles:
            chunks = splitter.split_text(article["text"])
            for chunk in chunks:
                all_texts.append(chunk)
                all_metadatas.append({
                    "source": "법령",
                    "law_name": law_name,
                    "law_id": law_id,
                    "article_no": article["article_no"],
                    "dept": entry.get("dept_name", ""),
                })

    # 2. 판례 수집
    print("\n=== 판례 수집 시작 ===")
    for query in PREC_QUERIES:
        print(f"\n[판례 검색] {query}")
        prec_ids = search_prec_ids(query, display=10)
        print(f"  검색 결과: {len(prec_ids)}건")

        for prec_id in prec_ids:
            prec = fetch_prec_text(prec_id)
            if not prec:
                continue
            chunks = splitter.split_text(prec["text"])
            for chunk in chunks:
                all_texts.append(chunk)
                all_metadatas.append({
                    "source": "판례",
                    "case_name": prec["case_name"],
                    "case_no": prec["case_no"],
                    "court": prec["court"],
                    "query": query,
                })
            print(f"  판례 저장: {prec['case_name']}")

    if not all_texts:
        print("\n수집된 데이터가 없습니다.")
        return

    print(f"\n=== ChromaDB 구축 중 ({len(all_texts)}개 청크) ===")
    print(f"임베딩 모델 로딩: {EMBED_MODEL}")
    embedding = HuggingFaceEmbeddings(model_name=EMBED_MODEL)

    Chroma.from_texts(
        texts=all_texts,
        embedding=embedding,
        persist_directory=CHROMA_DIR,
        metadatas=all_metadatas,
    )
    print(f"ChromaDB 구축 완료! {len(all_texts)}개 청크 → {CHROMA_DIR}")


# ── 스타트업 관련 주요 법령 목록 ──

LAW_LIST = [
    {"law_name_kr": "개인정보보호법", "dept_name": "개인정보보호위원회"},
    {"law_name_kr": "정보통신망이용촉진및정보보호등에관한법률", "dept_name": "과학기술정보통신부"},
    {"law_name_kr": "전자상거래등에서의소비자보호에관한법률", "dept_name": "공정거래위원회"},
    {"law_name_kr": "표시광고의공정화에관한법률", "dept_name": "공정거래위원회"},
    {"law_name_kr": "독점규제및공정거래에관한법률", "dept_name": "공정거래위원회"},
    {"law_name_kr": "근로기준법", "dept_name": "고용노동부"},
    {"law_name_kr": "부정경쟁방지및영업비밀보호에관한법률", "dept_name": "특허청"},
    {"law_name_kr": "저작권법", "dept_name": "문화체육관광부"},
    {"law_name_kr": "전자금융거래법", "dept_name": "금융위원회"},
    {"law_name_kr": "중소기업창업지원법", "dept_name": "중소벤처기업부"},
    {"law_name_kr": "벤처기업육성에관한특별조치법", "dept_name": "중소벤처기업부"},
    {"law_name_kr": "소비자기본법", "dept_name": "공정거래위원회"},
]

# ── 판례 검색 키워드 ──

PREC_QUERIES = [
    "개인정보 유출",
    "전자상거래 소비자 피해",
    "표시광고 허위",
    "영업비밀 침해",
    "스타트업 계약",
    "공정거래 불공정",
    "근로계약 위반",
    "저작권 침해",
]


if __name__ == "__main__":
    build_chroma_db()
