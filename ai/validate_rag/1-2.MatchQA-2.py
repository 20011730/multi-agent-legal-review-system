import json
import psycopg2
# 질의 변경으로 인해 추가
# Match.py 돌린 다음 이것까지 같이 돌려주세요
PG_CONFIG = {
    "host": "localhost", "port": 5432,
    "dbname": "legalreview",
    "user": "legalreview", "password": "legalreview",
}

# 1. 컬럼 추가
with psycopg2.connect(**PG_CONFIG) as conn:
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE eval_dataset ADD COLUMN IF NOT EXISTS keyword TEXT")
        cur.execute("SELECT eval_id, source_path FROM eval_dataset")
        rows = cur.fetchall()
    conn.commit()

# 2. JSON 다시 읽어 keyword_tagg 추출
updates = []
for eval_id, path in rows:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        continue
    tags = data.get("keyword_tagg") or []
    kw = " ".join(
        t.get("keyword", "").strip()
        for t in tags
        if isinstance(t, dict) and t.get("keyword")
    )
    updates.append((kw, eval_id))

# 3. 일괄 UPDATE
with psycopg2.connect(**PG_CONFIG) as conn:
    with conn.cursor() as cur:
        from psycopg2.extras import execute_batch
        execute_batch(
            cur,
            "UPDATE eval_dataset SET keyword = %s WHERE eval_id = %s",
            updates,
            page_size=1000,
        )
    conn.commit()

print(f"✅ {len(updates):,}건 업데이트 완료")