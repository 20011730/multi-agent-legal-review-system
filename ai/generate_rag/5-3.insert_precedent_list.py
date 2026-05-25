"""
precedent_list.json → public.precedent_list 적재.
배치 실패 시 해당 청크만 행단위로 재시도, 깨진 행은 failed_inserts.json으로 분리.
"""
import json
import psycopg2
from psycopg2.extras import execute_batch
from datetime import datetime
from pathlib import Path

DB_CONFIG = {
    'dbname': 'legalreview', 'user': 'legalreview',
    'password': 'legalreview', 'host': 'localhost', 'port': '5432',
}

FAILED_INSERTS_FILE = Path("failed_inserts.json")
BATCH = 1000

INSERT_SQL = """
    INSERT INTO public.precedent_list (
        prec_serial, case_name, case_no, judgment_date,
        court_name, court_type_code,
        case_type_name, case_type_code,
        judgment_type, judgment_result,
        data_source, detail_link
    ) VALUES (
        %(prec_serial)s, %(case_name)s, %(case_no)s, %(judgment_date)s,
        %(court_name)s, %(court_type_code)s,
        %(case_type_name)s, %(case_type_code)s,
        %(judgment_type)s, %(judgment_result)s,
        %(data_source)s, %(detail_link)s
    )
    ON CONFLICT (prec_serial) DO NOTHING;
"""


def insert_json_to_db(json_filepath: str):
    print(f"\n[{json_filepath}] 파일 읽는 중...")
    try:
        with open(json_filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ {json_filepath} 파일 없음.")
        return

    if not data:
        print("데이터 없음.")
        return

    print(f"총 {len(data):,}건 적재 시작 (BATCH={BATCH})")

    failed_rows = []
    conn, cursor = None, None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM public.precedent_list;")
        before = cursor.fetchone()[0]

        for i in range(0, len(data), BATCH):
            chunk = data[i:i + BATCH]
            try:
                execute_batch(cursor, INSERT_SQL, chunk, page_size=BATCH)
                conn.commit()
            except psycopg2.DatabaseError as batch_err:
                # 배치 안에 깨진 행이 있음 → 행단위 fallback
                print(f"  ⚠️ batch [{i}:{i+len(chunk)}] 실패, 행단위 재시도: {batch_err}")
                conn.rollback()
                for row in chunk:
                    try:
                        cursor.execute(INSERT_SQL, row)
                        conn.commit()
                    except psycopg2.DatabaseError as row_err:
                        conn.rollback()
                        failed_rows.append({
                            "row": row,
                            "error": f"{type(row_err).__name__}: {row_err}",
                            "at": datetime.now().isoformat(timespec="seconds"),
                        })

        cursor.execute("SELECT COUNT(*) FROM public.precedent_list;")
        after = cursor.fetchone()[0]

        new_cnt = after - before
        skipped_cnt = len(data) - new_cnt - len(failed_rows)
        print(f"✅ 신규 {new_cnt:,}건 / 중복 skip {skipped_cnt:,}건 / 실패 {len(failed_rows)}건")

        if failed_rows:
            FAILED_INSERTS_FILE.write_text(
                json.dumps(failed_rows, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"   → 실패 행 → {FAILED_INSERTS_FILE} (원인 분석 및 재시도용)")

    except psycopg2.DatabaseError as e:
        print(f"❌ DB 연결/세션 오류: {e}")
        if conn: conn.rollback()
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


if __name__ == "__main__":
    insert_json_to_db('precedent_list.json')
    print("\n🎉 작업 종료.")