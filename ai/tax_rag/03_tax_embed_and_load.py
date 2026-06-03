"""
조세 판례 데이터 임베딩 및 ChromaDB 영구 적재 파이프라인 (Windows & 안정성 강화 버전)
- 적용 모델: intfloat/multilingual-e5-base
- OOM 방지를 위한 Batch 처리 및 GPU 자동 할당
- ChromaDB 중복 적재 방지 및 초기화 로직 추가
"""

import os
import json
from pathlib import Path
import torch
import chromadb
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────────────────────
# 1. 환경 설정 및 경로 세팅
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = PROJECT_ROOT / "data" / "chunked_precedents"
CHROMA_DB_PATH = PROJECT_ROOT / "data" / "chroma_tax_db"

COLLECTION_NAME = "tax_precedents"
EMBEDDING_MODEL = "intfloat/multilingual-e5-base"

# GPU VRAM(그래픽카드 메모리)에 맞춰 조절. 
# CUDA OOM(메모리 부족) 에러가 뜨면 이 숫자를 250이나 100으로 줄여주세요.
BATCH_SIZE = 500  

# ★ [핵심 수정] DB 초기화 플래그: True면 기존 데이터를 싹 지우고 새로 적재, False면 이어서 적재
RESET_DB = True 

# ─────────────────────────────────────────────────────────────────────────────
# 2. 하드웨어 가속 및 모델 초기화 (Windows 맞춤형)
# ─────────────────────────────────────────────────────────────────────────────
def get_device():
    # Windows 환경에서 NVIDIA GPU가 사용 가능한지 체크
    if torch.cuda.is_available():
        return "cuda"
    else:
        return "cpu"

device = get_device()
print(f"🚀 디바이스 설정 완료: {device.upper()} 모드로 작동합니다.")
print(f"📥 임베딩 모델 로딩 중: {EMBEDDING_MODEL}")

# 모델 로드
model = SentenceTransformer(EMBEDDING_MODEL, device=device)

# ★ [핵심 수정] Windows CPU 환경에서는 FP16(.half) 연산을 지원하지 않아 에러가 나므로, CUDA일 때만 적용
if device == "cuda":
    print("⚡ CUDA GPU가 감지되어 메모리 최적화(FP16)를 적용합니다.")
    model.half()
else:
    print("🐢 CPU 모드입니다. 임베딩에 다소 시간이 걸릴 수 있습니다.")

# ─────────────────────────────────────────────────────────────────────────────
# 3. ChromaDB 연결 및 컬렉션 생성 (중복 방지 로직)
# ─────────────────────────────────────────────────────────────────────────────
print(f"\n💾 ChromaDB 영구 저장소 연결: {CHROMA_DB_PATH}")
chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))

if RESET_DB:
    try:
        chroma_client.delete_collection(name=COLLECTION_NAME)
        print(f"🧹 기존 '{COLLECTION_NAME}' 컬렉션을 깔끔하게 삭제했습니다. (초기화 완료)")
    except Exception:
        print(f"ℹ️ 삭제할 기존 컬렉션이 없습니다. 새로 생성합니다.")

# 코사인 유사도(Cosine)를 사용하도록 HNSW 공간 설정
collection = chroma_client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"}
)

# ─────────────────────────────────────────────────────────────────────────────
# 4. 임베딩 및 적재 파이프라인
# ─────────────────────────────────────────────────────────────────────────────
def run_ingestion():
    jsonl_files = list(INPUT_DIR.rglob("*.jsonl"))
    if not jsonl_files:
        print(f"❌ 오류: '{INPUT_DIR}' 경로에 JSONL 파일이 없어.")
        return

    print(f"📊 총 {len(jsonl_files)}개의 청크 파일을 DB에 적재할게.")

    for file_idx, file_path in enumerate(jsonl_files, start=1):
        print(f"\n▶ [{file_idx}/{len(jsonl_files)}] 파일 처리 중: {file_path.name}")

        batch_ids = []
        batch_documents = []
        batch_texts_for_embed = []
        batch_metadatas = []

        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                
                doc = json.loads(line)
                meta = doc["meta"]

                for child in doc["children"]:
                    # 고유 ID 생성 (사건번호 + 자식ID)
                    chunk_id = f"{meta['doc_number']}_{child['child_id']}"
                    content = child["content"]

                    batch_ids.append(chunk_id)
                    batch_documents.append(content)
                    
                    # E5 모델 요구사항: 문서 임베딩 시 'passage: ' 접두사 추가
                    batch_texts_for_embed.append(f"passage: {content}")

                    # 메타데이터 (필터링 검색용)
                    batch_metadatas.append({
                        "doc_number": meta.get("doc_number", ""),
                        "tax_type": meta.get("tax_type", ""),
                        "decision_type": meta.get("decision_type", ""),
                        "attr_year": meta.get("attr_year", ""),
                        "section_type": child.get("section_type", ""),
                        "subsection_label": child.get("subsection_label", "")
                    })

        # BATCH_SIZE 단위로 임베딩 및 적재
        for i in tqdm(range(0, len(batch_ids), BATCH_SIZE), desc="Embedding & Upserting"):
            end_idx = i + BATCH_SIZE
            
            ids_chunk = batch_ids[i:end_idx]
            docs_chunk = batch_documents[i:end_idx]
            embed_texts_chunk = batch_texts_for_embed[i:end_idx]
            meta_chunk = batch_metadatas[i:end_idx]

            # 1) 벡터 변환 연산
            embeddings = model.encode(
                embed_texts_chunk,
                batch_size=32, # 모델 내부 연산 배치
                normalize_embeddings=True,
                show_progress_bar=False
            ).astype("float32").tolist()

            # 2) ChromaDB 적재 (Upsert)
            collection.upsert(
                ids=ids_chunk,
                embeddings=embeddings,
                documents=docs_chunk,
                metadatas=meta_chunk
            )

    # 최종 검증
    total_chunks_in_db = collection.count()
    print("=" * 60)
    print(f"🎉 모든 작업 완료! ChromaDB에 총 {total_chunks_in_db:,}개의 벡터가 영구 저장되었어.")
    print("=" * 60)

if __name__ == "__main__":
    run_ingestion()
