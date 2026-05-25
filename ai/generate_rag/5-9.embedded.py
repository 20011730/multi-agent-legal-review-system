import os
import glob
import json
import torch
import chromadb
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────────────────────
# 1. 설정 및 하드웨어 가속 준비
# ─────────────────────────────────────────────────────────────────────────────
INPUT_DIR = "./tmp/jsonl_exports"
CHROMA_DB_PATH = "./chroma_legal_db"
COLLECTION_NAME = "legal_case_chunks"
BATCH_SIZE = 64 

# Apple Silicon (MPS) 지원 여부 확인
if torch.backends.mps.is_available():
    device = torch.device("mps")
    print("🚀 Apple Silicon (MPS) GPU 가속을 사용합니다!")
else:
    device = torch.device("cpu")
    print("⚠️ MPS를 찾을 수 없어 CPU로 구동합니다.")

# 모델 로드 
print("📥 임베딩 모델 로딩 중...")
model = SentenceTransformer("intfloat/multilingual-e5-base", device=device)
# [안전장치] 혹시 모를 토큰 초과 방지를 위해 512로 자름
model.max_seq_length = 512 

# ─────────────────────────────────────────────────────────────────────────────
# 2. Chroma DB 설정
# ─────────────────────────────────────────────────────────────────────────────
# 디스크에 영구 저장되는 클라이언트 생성
chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

# 컬렉션 생성 (유사도 검색 방식으로 코사인 유사도 지정)
collection = chroma_client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"} # 정규화된 벡터에는 cosine이 최적
)

# ─────────────────────────────────────────────────────────────────────────────
# 3. 임베딩 및 적재 파이프라인
# ─────────────────────────────────────────────────────────────────────────────
def embed_and_ingest():
    jsonl_files = sorted(glob.glob(os.path.join(INPUT_DIR, "*.jsonl")))
    
    if not jsonl_files:
        print("❌ 처리할 JSONL 파일이 없습니다.")
        return

    print(f"📦 총 {len(jsonl_files)}개의 파일을 Chroma DB에 적재합니다.")

    for file_idx, file_path in enumerate(jsonl_files, start=1):
        filename = os.path.basename(file_path)
        print(f"\n▶ [{file_idx}/{len(jsonl_files)}] 파일 처리 중: {filename}")
        
        # 임시 보관용 리스트
        batch_ids = []
        batch_texts_for_embed = []
        batch_texts_original = []
        batch_metadatas = []
        
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        for line in tqdm(lines, desc="Reading chunks"):
            if not line.strip(): continue
            doc = json.loads(line)
            meta = doc["meta"]
            
            for child in doc["children"]:
                # 1. 고유 ID
                batch_ids.append(f"{meta['db_id']}_{child['child_id']}")
                # 2. 메타데이터 조립 (검색 필터링 용도)
                chunk_meta = {
                    "db_id": meta["db_id"],
                    "case_number": meta["case_number"],
                    "court": meta["court"],
                    "section_type": child["section_type"],
                    "subsection_label": child.get("subsection_label") or "",
                    # 참조 조문/판례가 너무 길면 DB 부하가 오므로 앞부분만 자르거나, 있으면 넣음
                    "ref_statutes": str(meta.get("ref_statutes", ""))[:500],
                    "ref_cases": str(meta.get("ref_cases", ""))[:500]
                }
                batch_metadatas.append(chunk_meta)
                
                # 3. 원본 텍스트 (LLM에게 전달할 실제 내용)
                batch_texts_original.append(child["content"])
                
                # 4. 임베딩용 텍스트 (E5 모델 필수 Prefix 적용!!)
                batch_texts_for_embed.append(f"passage: {child['content']}")
                
                # 배치 사이즈에 도달하면 임베딩 및 DB 삽입
                if len(batch_texts_for_embed) >= BATCH_SIZE:
                    insert_batch(batch_ids, batch_texts_for_embed, batch_texts_original, batch_metadatas)
                    
                    # 리스트 초기화
                    batch_ids.clear()
                    batch_texts_for_embed.clear()
                    batch_texts_original.clear()
                    batch_metadatas.clear()

        # 파일 끝에 도달했을 때 남은 자투리 데이터 처리
        if len(batch_texts_for_embed) > 0:
            insert_batch(batch_ids, batch_texts_for_embed, batch_texts_original, batch_metadatas)

def insert_batch(ids, texts_for_embed, texts_original, metadatas):
    """배치 단위로 모델 임베딩 후 Chroma DB에 Upsert 수행"""
    # normalize_embeddings=True 를 통해 코사인 유사도 검색 최적화
    embeddings = model.encode(texts_for_embed, normalize_embeddings=True, show_progress_bar=False)
    
    collection.upsert(
        ids=ids,
        embeddings=embeddings.tolist(),
        documents=texts_original, # 주의: DB에는 "passage:" 가 안 붙은 원본을 저장
        metadatas=metadatas
    )

if __name__ == "__main__":
    embed_and_ingest()
    print("\n🎉 모든 데이터의 임베딩 및 Chroma DB 적재가 완료되었습니다!")