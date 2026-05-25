"""
판례 임베딩 검색 품질 검증 스크립트
- 실제 법률 쿼리로 retrieval 결과 확인
- 다양한 도메인의 쿼리 테스트
"""
import sqlite3
import numpy as np
import chromadb
import torch
import os
from sentence_transformers import SentenceTransformer

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DB_PATH = os.path.join(SCRIPT_DIR, "chroma_legal_db")
CHUNKS_DB_PATH = os.path.join(SCRIPT_DIR, "case_chunks.db")
COLLECTION_NAME = "legal_case_chunks"
MODEL_NAME = "intfloat/multilingual-e5-base"

TOP_K = 3
CONTENT_PREVIEW_LEN = 250   # 결과 출력 시 본문 미리보기 길이

# 테스트 쿼리: 다양한 법률 도메인 (민사/형사/가사/행정 등)
TEST_QUERIES = [
    "임대차 계약 해지 통보 효력",
    "상속재산 분할 협의 무효",
    "교통사고 손해배상 과실비율",
    "이혼 시 위자료 산정 기준",
    "근로계약 부당해고 구제",
    "부동산 매매계약 해제",
    "사기죄 성립 요건",
    "음주운전 면허취소 처분",
    "주식회사 이사 책임",
    "보이스피싱 피해 손해배상",
]

# ─────────────────────────────────────────────────────────────────────────────
# 초기화
# ─────────────────────────────────────────────────────────────────────────────
def init():
    print("📥 임베딩 모델 로딩 중...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(MODEL_NAME, device=device)
    model.max_seq_length = 512
    print(f"   디바이스: {device}")

    print("📚 ChromaDB / SQLite 연결...")
    chroma_client = chromadb.PersistentClient(CHROMA_DB_PATH)
    collection = chroma_client.get_collection(COLLECTION_NAME)
    conn = sqlite3.connect(CHUNKS_DB_PATH)

    print(f"   ChromaDB 청크 수: {collection.count():,}")
    print(f"   SQLite 청크 수:   {conn.execute('SELECT COUNT(*) FROM case_chunks').fetchone()[0]:,}")
    print()
    return model, collection, conn


# ─────────────────────────────────────────────────────────────────────────────
# 검색 + 결과 출력
# ─────────────────────────────────────────────────────────────────────────────
def search_and_print(query, model, collection, conn, top_k=TOP_K):
    # ⚠️ E5 모델은 query에 "query:" prefix 필수
    q_emb = model.encode(
        f"query: {query}",
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype("float32")

    res = collection.query(
        query_embeddings=[q_emb.tolist()],
        n_results=top_k,
        include=["metadatas", "distances"],
    )

    chunk_ids = res["ids"][0]
    metas = res["metadatas"][0]
    distances = res["distances"][0]

    # SQLite에서 본문 한 번에 가져오기 (순서 맞춰서)
    placeholders = ",".join("?" * len(chunk_ids))
    rows = conn.execute(
        f"SELECT chunk_id, content FROM case_chunks WHERE chunk_id IN ({placeholders})",
        chunk_ids,
    ).fetchall()
    id_to_content = dict(rows)

    # 출력
    print(f"\n🔍 쿼리: {query}")
    print("=" * 80)

    similarities = []
    for i, (chunk_id, meta, dist) in enumerate(zip(chunk_ids, metas, distances), start=1):
        similarity = 1 - dist  # cosine distance → similarity
        similarities.append(similarity)

        content = id_to_content.get(chunk_id, "(본문 누락)")
        preview = content[:CONTENT_PREVIEW_LEN].replace("\n", " ")
        if len(content) > CONTENT_PREVIEW_LEN:
            preview += "..."

        print(f"\n[{i}] 유사도: {similarity:.4f}")
        print(f"    사건번호: {meta.get('case_number', 'N/A')}  ({meta.get('court', '')})")
        print(f"    섹션: {meta.get('section_type', '')}"
              f" / {meta.get('subsection_label', '') or '-'}")
        print(f"    청크ID: {chunk_id}")
        print(f"    본문: {preview}")

    return similarities


# ─────────────────────────────────────────────────────────────────────────────
# 통계 출력
# ─────────────────────────────────────────────────────────────────────────────
def print_summary(all_similarities):
    print("\n" + "=" * 80)
    print("📊 전체 검색 품질 요약")
    print("=" * 80)

    flat = np.array([s for sims in all_similarities for s in sims])
    top1 = np.array([sims[0] for sims in all_similarities])

    print(f"전체 top-{TOP_K} 유사도 — 평균: {flat.mean():.4f}, "
          f"최소: {flat.min():.4f}, 최대: {flat.max():.4f}")
    print(f"각 쿼리의 top-1 유사도 — 평균: {top1.mean():.4f}, "
          f"최소: {top1.min():.4f}, 최대: {top1.max():.4f}")

    # 품질 평가
    print("\n🩺 진단:")
    if top1.mean() < 0.70:
        print("  ⚠️  top-1 평균 유사도가 낮음. query: prefix 누락 또는 임베딩 문제 의심.")
    elif top1.mean() > 0.98:
        print("  ⚠️  유사도가 너무 균일하게 높음. 임베딩 collapse 가능성. 결과 다양성 직접 확인 필요.")
    else:
        print(f"  ✅ top-1 평균 유사도 {top1.mean():.4f} — 정상 범위 (E5 기준 0.75~0.95)")

    # 결과 다양성 체크: 모든 쿼리가 같은 청크를 반환하면 문제
    all_top1_ids = []  # 추적 안 했지만 향후 확장용
    print()


# ─────────────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────────────
def main():
    model, collection, conn = init()

    all_similarities = []
    try:
        for query in TEST_QUERIES:
            sims = search_and_print(query, model, collection, conn)
            all_similarities.append(sims)

        print_summary(all_similarities)
    finally:
        conn.close()


if __name__ == "__main__":
    main()