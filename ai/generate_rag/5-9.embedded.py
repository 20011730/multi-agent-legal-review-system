import os
import glob
import json
import sqlite3
import torch
import chromadb
from concurrent.futures import ThreadPoolExecutor
from sentence_transformers import SentenceTransformer

# ─────────────────────────────────────────────────────────────────────────────
# 1. 설정 및 하드웨어 가속 준비
# ─────────────────────────────────────────────────────────────────────────────
INPUT_DIR = "/workspace/tmp/jsonl_exports"
CHROMA_DB_PATH = "/workspace/chroma_legal_db"
COLLECTION_NAME = "legal_case_chunks"
CHUNKS_DB_PATH = "/workspace/case_chunks.db"
BATCH_SIZE = 1024
UPSERT_CHUNK_SIZE = 5000
MAX_PENDING_UPSERTS = 2   # 백그라운드에 쌓일 수 있는 작업 최대 개수 (메모리 보호)

device = torch.device("cuda")
print(f"🚀 NVIDIA CUDA GPU 가속을 사용합니다! (디바이스: {device})")

print("📥 임베딩 모델 로딩 중...")
model = SentenceTransformer("intfloat/multilingual-e5-base", device=device)
model.max_seq_length = 512
model.half()  # FP16

# ─────────────────────────────────────────────────────────────────────────────
# 2. Chroma DB 설정 (벡터 인덱스 전용)
# ─────────────────────────────────────────────────────────────────────────────
chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
collection = chroma_client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"}
)

# ─────────────────────────────────────────────────────────────────────────────
# 2-1. 청크 본문 SQLite (case_chunks)
# ─────────────────────────────────────────────────────────────────────────────
chunks_conn = sqlite3.connect(CHUNKS_DB_PATH)
chunks_conn.execute("""
    CREATE TABLE IF NOT EXISTS case_chunks (
        chunk_id         TEXT PRIMARY KEY,
        case_db_id       INTEGER NOT NULL,
        case_number      TEXT,
        court            TEXT,
        section_type     TEXT,
        subsection_label TEXT,
        content          TEXT NOT NULL
    )
""")
chunks_conn.execute(
    "CREATE INDEX IF NOT EXISTS idx_chunks_case_db_id ON case_chunks(case_db_id)"
)
chunks_conn.execute("PRAGMA journal_mode=WAL")
chunks_conn.execute("PRAGMA synchronous=NORMAL")
chunks_conn.commit()

# ─────────────────────────────────────────────────────────────────────────────
# 2-2. 비동기 upsert용 워커 (단일 스레드: ChromaDB는 쓰기 직렬화됨)
# ─────────────────────────────────────────────────────────────────────────────
upsert_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="chroma-upsert")
pending_futures = []

def upsert_to_chroma(ids, embs, metas, file_label):
    """백그라운드에서 ChromaDB upsert 수행"""
    for i in range(0, len(ids), UPSERT_CHUNK_SIZE):
        collection.upsert(
            ids=ids[i:i+UPSERT_CHUNK_SIZE],
            embeddings=embs[i:i+UPSERT_CHUNK_SIZE],
            metadatas=metas[i:i+UPSERT_CHUNK_SIZE],
        )
    print(f"   ✓ [{file_label}] ChromaDB upsert 완료 ({len(ids):,}개)")

# ─────────────────────────────────────────────────────────────────────────────
# 3. 임베딩 및 적재 파이프라인
# ─────────────────────────────────────────────────────────────────────────────
def embed_and_ingest():
    jsonl_files = sorted(glob.glob(os.path.join(INPUT_DIR, "*.jsonl")))
    if not jsonl_files:
        print("❌ 처리할 JSONL 파일이 없습니다.")
        return

    print(f"📦 총 {len(jsonl_files)}개의 파일을 적재합니다.")

    for file_idx, file_path in enumerate(jsonl_files, start=1):
        filename = os.path.basename(file_path)
        print(f"\n▶ [{file_idx}/{len(jsonl_files)}] 파일 처리 중: {filename}")

        batch_ids = []
        batch_texts_for_embed = []
        batch_metadatas = []
        batch_chunk_rows = []

        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                doc = json.loads(line)
                meta = doc["meta"]

                for child in doc["children"]:
                    chunk_id = f"{meta['db_id']}_{child['child_id']}"
                    content = child["content"]
                    section_type = child.get("section_type", "기타")
                    subsection_label = child.get("subsection_label") or ""

                    batch_ids.append(chunk_id)
                    batch_texts_for_embed.append(f"passage: {content}")

                    batch_metadatas.append({
                        "db_id": meta["db_id"],
                        "case_number": meta["case_number"],
                        "court": meta.get("court", ""),
                        "section_type": section_type,
                        "subsection_label": subsection_label,
                        "ref_statutes": str(meta.get("ref_statutes", ""))[:500],
                        "ref_cases": str(meta.get("ref_cases", ""))[:500],
                    })

                    batch_chunk_rows.append((
                        chunk_id,
                        meta["db_id"],
                        meta["case_number"],
                        meta.get("court", ""),
                        section_type,
                        subsection_label,
                        content,
                    ))

        if not batch_texts_for_embed:
            continue

        # 2. 임베딩 연산 (GPU)
        print(f"🚀 {len(batch_texts_for_embed)}개 청크 임베딩 연산 중...")
        embeddings = model.encode(
            batch_texts_for_embed,
            batch_size=BATCH_SIZE,
            normalize_embeddings=True,
            show_progress_bar=True,
        ).astype("float32")

        # 3-1. SQLite 본문 적재 (빠르니까 동기 유지)
        print("📝 SQLite(case_chunks)에 본문 저장 중...")
        chunks_conn.executemany(
            """INSERT OR REPLACE INTO case_chunks
               (chunk_id, case_db_id, case_number, court,
                section_type, subsection_label, content)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            batch_chunk_rows,
        )
        chunks_conn.commit()

        # 3-2. ChromaDB upsert는 백그라운드로 던지기
        #     너무 쌓이면(메모리 보호) 가장 오래된 거 끝날 때까지 대기
        while len(pending_futures) >= MAX_PENDING_UPSERTS:
            pending_futures.pop(0).result()

        print(f"💾 ChromaDB upsert 백그라운드 시작 (대기 {len(pending_futures)+1}개)")
        future = upsert_executor.submit(
            upsert_to_chroma,
            batch_ids, embeddings, batch_metadatas, filename,
        )
        pending_futures.append(future)


if __name__ == "__main__":
    import time
    try:
        embed_and_ingest()
        print(f"\n⏳ 남은 ChromaDB upsert {len(pending_futures)}개 완료 대기 중...")
        for f in pending_futures:
            f.result()
        
        # ★ ChromaDB 내부 compactor가 인덱스 동기화할 시간 확보
        print("⏳ ChromaDB 인덱스 동기화 대기 (30초)...")
        time.sleep(30)
        
        # ★ 인덱스 정상 빌드 확인 (여기서 에러나면 즉시 알 수 있음)
        try:
            cnt = collection.count()
            print(f"\n✅ ChromaDB 최종 청크 수: {cnt:,}")
        except Exception as e:
            print(f"\n⚠️ count() 실패 — 인덱스 빌드 미완: {e}")
            print("   30초 더 대기 후 재시도...")
            time.sleep(30)
            cnt = collection.count()
            print(f"✅ 재시도 성공: {cnt:,}")
        
        print("\n🎉 모든 데이터의 임베딩 및 적재가 완료되었습니다!")
    finally:
        upsert_executor.shutdown(wait=True)
        chunks_conn.close()