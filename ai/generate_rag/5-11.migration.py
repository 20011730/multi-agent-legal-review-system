import sqlite3
import psycopg2
from psycopg2.extras import execute_values
import time
#   1,863,318 / 1,863,318 (100.0%)  22,210 rows/s  ETA: 0s
PG_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "legalreview",
    "user": "legalreview",
    "password": "legalreview",
}
SQLITE_PATH = "./case_chunks.db"

sqlite_conn = sqlite3.connect(SQLITE_PATH)
pg_conn = psycopg2.connect(**PG_CONFIG)
pg_cur = pg_conn.cursor()

# 1) 테이블 생성 (없으면)
print("📋 case_chunks 테이블 생성 중...")
pg_cur.execute("""
    CREATE TABLE IF NOT EXISTS case_chunks (
        chunk_id         TEXT PRIMARY KEY,
        case_id          BIGINT NOT NULL
                         REFERENCES case_documents(id) ON DELETE CASCADE,
        section_type     TEXT,
        subsection_label TEXT,
        content          TEXT NOT NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
""")
pg_cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_case_id ON case_chunks(case_id);")
pg_conn.commit()
print("✅ 테이블 준비 완료\n")

# 2) 배치 마이그레이션
BATCH = 5000
total = sqlite_conn.execute("SELECT COUNT(*) FROM case_chunks").fetchone()[0]
print(f"📦 총 {total:,}개 청크 마이그레이션 시작\n")

cursor = sqlite_conn.execute("""
    SELECT chunk_id, case_db_id, section_type, subsection_label, content
    FROM case_chunks
""")

done = 0
start = time.time()
while True:
    rows = cursor.fetchmany(BATCH)
    if not rows:
        break
    execute_values(
        pg_cur,
        """INSERT INTO case_chunks
           (chunk_id, case_id, section_type, subsection_label, content)
           VALUES %s
           ON CONFLICT (chunk_id) DO NOTHING""",
        rows,
        page_size=BATCH,
    )
    pg_conn.commit()
    done += len(rows)
    elapsed = time.time() - start
    rate = done / elapsed if elapsed > 0 else 0
    eta = (total - done) / rate if rate > 0 else 0
    print(f"  {done:,} / {total:,} ({done*100/total:.1f}%)  "
          f"{rate:,.0f} rows/s  ETA: {eta:.0f}s")

# 3) 검증
pg_cur.execute("SELECT COUNT(*) FROM case_chunks")
pg_count = pg_cur.fetchone()[0]
print(f"\n✅ 마이그레이션 완료")
print(f"   SQLite:     {total:,}")
print(f"   PostgreSQL: {pg_count:,}")
print(f"   일치: {'✅' if pg_count == total else '⚠️'}")

sqlite_conn.close()
pg_conn.close()