"""
판례 검색 인터랙티브 도구 (PostgreSQL 버전)
- ChromaDB로 벡터 검색
- PostgreSQL JOIN으로 case_documents 정보까지 한 번에 조회
- 짧은 청크 필터링, top-k, 미리보기 길이 조정 가능
"""
import os
import psycopg2
import chromadb
import torch
from sentence_transformers import SentenceTransformer

# ─── 설정 ─────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DB_PATH = os.path.join(SCRIPT_DIR, "chroma_legal_db")
COLLECTION_NAME = "legal_case_chunks"
MODEL_NAME = "intfloat/multilingual-e5-base"
#파인튜닝한 모델 
# MODEL_NAME = os.path.join(SCRIPT_DIR, "legal-e5-finetuned")
# ===== PostgreSQL 연결 정보 — 본인 환경에 맞춰 수정 =====
PG_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "legalreview",
    "user": "legalreview",
    "password": "legalreview",  
}
# ====================================================

DEFAULT_TOP_K = 5
DEFAULT_PREVIEW_LEN = 300
DEFAULT_MIN_LEN = 0   # 짧은 청크 필터링 (0이면 끔)


# ─── 초기화 ─────────────────────────────────────────────
def init():
    print("📥 임베딩 모델 로딩 중...")
    device = (
        "cuda" if torch.cuda.is_available()
        else "mps" if torch.backends.mps.is_available()
        else "cpu"
    )
    model = SentenceTransformer(MODEL_NAME, device=device)
    model.max_seq_length = 512
    print(f"   디바이스: {device}")

    print("📚 ChromaDB / PostgreSQL 연결 중...")
    chroma_client = chromadb.PersistentClient(CHROMA_DB_PATH)
    collection = chroma_client.get_collection(COLLECTION_NAME)
    conn = psycopg2.connect(**PG_CONFIG)

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM case_chunks")
        pg_chunks = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM case_documents")
        pg_cases = cur.fetchone()[0]

    print(f"   ChromaDB 인덱싱: {collection.count():,} 청크")
    print(f"   PostgreSQL:     {pg_chunks:,} 청크 / {pg_cases:,} 판례\n")

    return model, collection, conn


# ─── 검색 ─────────────────────────────────────────────
def search(query, model, collection, conn, top_k, min_len=0):
    """
    1) ChromaDB로 벡터 검색
    2) PostgreSQL JOIN으로 청크 + 판례 정보 한 번에
    3) ChromaDB 순서 유지 + 짧은 청크 필터링
    """
    # 1) 쿼리 임베딩 (E5: query 측에 'query:' prefix 필수)
    q_emb = model.encode(
        f"query: {query}",
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype("float32")

    # 짧은 청크 필터링 시 여유 있게 더 많이 가져옴
    fetch_k = top_k * 3 if min_len > 0 else top_k

    res = collection.query(
        query_embeddings=[q_emb.tolist()],
        n_results=fetch_k,
        include=["distances"],
    )
    chunk_ids = res["ids"][0]
    distances = res["distances"][0]

    if not chunk_ids:
        return []

    # 2) PostgreSQL JOIN — case_documents까지 한 번에
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                c.chunk_id,
                c.section_type,
                c.subsection_label,
                c.content,
                d.case_number,
                d.court,
                d.case_type,
                d.judgment_date,
                d.judgment,
                d.title,
                d.referenced_provisions,
                d.referenced_precedents
            FROM case_chunks c
            JOIN case_documents d ON c.case_id = d.id
            WHERE c.chunk_id = ANY(%s)
                    AND c.section_type NOT IN ('원고', '피고', '원고, 상고인', '피고, 피상고인')
        """, (chunk_ids,))
        rows = cur.fetchall()

    # 3) ChromaDB 유사도 순서대로 정렬 + 필터링
    row_map = {row[0]: row for row in rows}
    results = []
    for chunk_id, dist in zip(chunk_ids, distances):
        if chunk_id not in row_map:
            continue
        row = row_map[chunk_id]
        content = row[3] or ""

        if min_len > 0 and len(content) < min_len:
            continue

        results.append({
            "chunk_id": row[0],
            "similarity": 1 - dist,
            "section_type": row[1] or "",
            "subsection_label": row[2] or "",
            "content": content,
            "case_number": row[4] or "N/A",
            "court": row[5] or "",
            "case_type": row[6] or "",
            "judgment_date": row[7] or "",
            "judgment": row[8] or "",
            "title": row[9] or "",
            "referenced_provisions": row[10] or "",
            "referenced_precedents": row[11] or "",
        })

        if len(results) >= top_k:
            break

    return results


# ─── 출력 ─────────────────────────────────────────────
def format_date(d):
    """판결일 형식: 'YYYYMMDD' → 'YYYY-MM-DD'"""
    s = str(d)
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


def print_results(results, preview_len):
    for i, r in enumerate(results, start=1):
        preview = r["content"][:preview_len].replace("\n", " ")
        if len(r["content"]) > preview_len:
            preview += "..."

        header = f"[{i}] 유사도 {r['similarity']:.4f}  │  {r['case_number']}"
        if r["court"]:
            header += f"  ({r['court']})"
        if r["case_type"]:
            header += f"  ·  {r['case_type']}"
        if r["judgment_date"]:
            header += f"  ·  {format_date(r['judgment_date'])}"

        print(f"\n{header}")
        print(f"    섹션: {r['section_type']} / {r['subsection_label'] or '-'}")
        print(f"    청크: {r['chunk_id']}  ({len(r['content']):,}자)")
        print(f"    본문: {preview}")


def print_full(result):
    sep = "═" * 80
    print(f"\n{sep}")
    print(f"📄 사건번호: {result['case_number']}")
    if result["title"]:
        print(f"   제목:    {result['title']}")
    if result["court"]:
        print(f"   법원:    {result['court']}")
    if result["case_type"]:
        print(f"   분류:    {result['case_type']}")
    if result["judgment_date"]:
        print(f"   판결일:  {format_date(result['judgment_date'])}")
    if result["judgment"]:
        print(f"   판결:    {result['judgment']}")
    print(f"   섹션:    {result['section_type']} / {result['subsection_label'] or '-'}")
    print(f"   청크ID:  {result['chunk_id']}")
    print(f"   유사도:  {result['similarity']:.4f}")
    if result["referenced_provisions"]:
        print(f"   참조법령: {result['referenced_provisions'][:300]}")
    if result["referenced_precedents"]:
        print(f"   참조판례: {result['referenced_precedents'][:300]}")
    print(sep)
    print(result["content"])
    print(f"{sep}\n")


# ─── 도움말 ─────────────────────────────────────────────
HELP = """
💡 사용법:
  <검색어>           → 검색 실행
  show <번호>        → N번 결과의 본문 + 메타데이터 전체 보기
  k <숫자>           → top-k 변경 (예: k 10)
  preview <숫자>     → 본문 미리보기 길이 변경 (예: preview 500)
  min_len <숫자>     → 짧은 청크 필터 (예: min_len 100, 0=끔)
  help, ?           → 도움말
  quit, q, exit     → 종료
"""


# ─── 메인 ─────────────────────────────────────────────
def main():
    model, collection, conn = init()

    top_k = DEFAULT_TOP_K
    preview_len = DEFAULT_PREVIEW_LEN
    min_len = DEFAULT_MIN_LEN
    last_results = []

    print("=" * 80)
    print("🔍 판례 검색 인터랙티브 모드 (PostgreSQL)")
    print("=" * 80)
    print(HELP)

    try:
        while True:
            try:
                prompt = f"\n[k={top_k}"
                if min_len > 0:
                    prompt += f" min={min_len}"
                prompt += "] 검색어 ▶ "
                query = input(prompt).strip()
            except (EOFError, KeyboardInterrupt):
                print("\n👋 종료합니다.")
                break

            if not query:
                continue

            low = query.lower()

            # 종료
            if low in ("quit", "exit", "q", ":q"):
                print("👋 종료합니다.")
                break

            # 도움말
            if low in ("help", "?"):
                print(HELP)
                continue

            # top-k 변경
            if low.startswith("k "):
                try:
                    top_k = max(1, min(50, int(query.split()[1])))
                    print(f"✓ top-k = {top_k}")
                except (IndexError, ValueError):
                    print("⚠️  사용법: k 10")
                continue

            # 미리보기 길이
            if low.startswith("preview "):
                try:
                    preview_len = max(50, int(query.split()[1]))
                    print(f"✓ 미리보기 = {preview_len}자")
                except (IndexError, ValueError):
                    print("⚠️  사용법: preview 500")
                continue

            # 짧은 청크 필터
            if low.startswith("min_len "):
                try:
                    min_len = max(0, int(query.split()[1]))
                    print(f"✓ 최소 청크 길이 = {min_len}자")
                except (IndexError, ValueError):
                    print("⚠️  사용법: min_len 100  (0이면 끔)")
                continue

            # 본문 전체 보기
            if low.startswith("show "):
                try:
                    idx = int(query.split()[1]) - 1
                    if 0 <= idx < len(last_results):
                        print_full(last_results[idx])
                    else:
                        print(f"⚠️  유효 번호: 1~{len(last_results)}")
                except (IndexError, ValueError):
                    print("⚠️  사용법: show 1")
                continue

            # 일반 검색
            print("🔍 검색 중...")
            try:
                results = search(
                    query, model, collection, conn,
                    top_k=top_k, min_len=min_len,
                )
            except Exception as e:
                print(f"❌ 검색 오류: {e}")
                # 연결 끊김 등 복구 시도
                try:
                    conn.rollback()
                except Exception:
                    pass
                continue

            last_results = results

            if not results:
                print("📋 검색 결과 없음 (필터 조건이 너무 강할 수 있음)")
                continue

            print(f"\n📋 검색 결과 ({len(results)}개)")
            print_results(results, preview_len=preview_len)
            print(f"\n💡 본문 전체 보기: show <번호>  (예: show 1)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()