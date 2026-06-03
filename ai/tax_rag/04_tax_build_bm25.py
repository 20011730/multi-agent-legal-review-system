"""
BM25 키워드 인덱스 빌드 및 저장 스크립트
- 50만 개 청크의 키워드 사전을 만들어 .pkl 파일로 영구 저장
"""

import os
import json
import pickle
from pathlib import Path
from rank_bm25 import BM25Okapi
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = PROJECT_ROOT / "data" / "chunked_precedents"
BM25_INDEX_PATH = PROJECT_ROOT / "data" / "bm25_index.pkl"
CHUNK_DATA_PATH = PROJECT_ROOT / "data" / "chunk_meta.pkl"

def build_bm25():
    jsonl_files = list(INPUT_DIR.rglob("*.jsonl"))
    
    chunk_ids = []
    tokenized_corpus = []
    
    print("📥 텍스트 조각 로딩 및 형태소 분리 중...")
    for file_path in tqdm(jsonl_files, desc="Reading JSONL"):
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip(): continue
                doc = json.loads(line)
                meta = doc["meta"]
                
                for child in doc["children"]:
                    chunk_id = f"{meta['doc_number']}_{child['child_id']}"
                    content = child["content"]
                    
                    chunk_ids.append(chunk_id)
                    # 공백 기반의 가장 빠른 토큰화 적용 (필요시 형태소 분석기로 교체 가능)
                    tokenized_corpus.append(content.split())

    print("⚙️ BM25 인덱스 훈련 시작 (시간이 다소 소요됩니다)...")
    bm25 = BM25Okapi(tokenized_corpus)
    
    print("💾 인덱스 및 메타데이터 피클링(Pickling)...")
    with open(BM25_INDEX_PATH, 'wb') as f:
        pickle.dump(bm25, f)
        
    with open(CHUNK_DATA_PATH, 'wb') as f:
        pickle.dump(chunk_ids, f)
        
    print(f"✅ BM25 인덱스 빌드 완료! ({BM25_INDEX_PATH})")

if __name__ == "__main__":
    build_bm25()
