"""
PostgreSQL Batch Insert 스크립트
110여 개의 청크 파일을 읽어 DB에 초고속으로 밀어 넣습니다.
실행: pip install psycopg2-binary
      python load_to_db.py
"""
import json
import logging
from pathlib import Path
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost',
    'port': '5432',
}

CHUNK_DIR = "./tmp/parsed_chunks"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | %(message)s",
)
log = logging.getLogger("db-loader")

# ─────────────────────────────────────────────────────────────────────────────
# 1. DB에 이미 존재하는 Reference ID 조회 (중복 방지용)
# ─────────────────────────────────────────────────────────────────────────────
def get_existing_reference_ids(conn) -> set:
    log.info("DB에서 기존 데이터의 reference_id 목록을 가져옵니다...")
    try:
        with conn.cursor() as cur:
            # 테이블명은 JPA가 생성한 물리 테이블명(snake_case)에 맞춤
            cur.execute("SELECT reference_id FROM case_documents")
            existing_ids = {row[0] for row in cur.fetchall()}
            log.info(f"현재 DB에 {len(existing_ids)}건의 데이터가 존재합니다.")
            return existing_ids
    except psycopg2.errors.UndefinedTable:
        log.error("❌ 'case_document' 테이블이 존재하지 않습니다. Spring Boot를 한 번 실행해서 테이블을 생성해주세요.")
        exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# 2. 메인 적재 로직
# ─────────────────────────────────────────────────────────────────────────────
def run_load():
    chunk_dir = Path(CHUNK_DIR)
    chunk_files = sorted(list(chunk_dir.glob("chunk_*.json")))
    
    if not chunk_files:
        log.error(f"[{CHUNK_DIR}] 폴더에 적재할 JSON 파일이 없습니다.")
        return

    log.info("=" * 60)
    log.info(f"총 {len(chunk_files)}개의 청크 파일 DB 적재를 시작합니다.")
    log.info("=" * 60)

    # 쿼리: JPA 엔티티 필드명에 대응하는 실제 DB 컬럼명(snake_case) 사용
    insert_query = """
        INSERT INTO case_documents (
            reference_id, title, case_number, judgment_date, judgment,
            court, case_type, url, prectype, issues, summary,
            rawcontent, referenced_provisions, referenced_precedents,
            chunked, created_at
        ) VALUES %s
    """

    total_inserted = 0

    with psycopg2.connect(**DB_CONFIG) as conn:
        existing_ids = get_existing_reference_ids(conn)
        
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE case_documents ALTER COLUMN id SET DEFAULT nextval('case_document_id_seq');")
            conn.commit()
            
            for idx, file in enumerate(chunk_files, start=1):
                try:
                    with file.open("r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    # 중복 데이터 필터링
                    new_docs = [doc for doc in data if doc["referenceId"] not in existing_ids]
                    
                    if not new_docs:
                        log.info(f"[{idx:3d}/{len(chunk_files):3d}] {file.name} - 신규 데이터 없음 (스킵)")
                        continue

                    # DB에 삽입할 튜플(Tuple) 리스트로 변환
                    values_to_insert = [
                        (
                            doc.get("referenceId"),
                            doc.get("title"),
                            doc.get("caseNumber"),
                            doc.get("judgmentDate"),
                            doc.get("judgment"),
                            doc.get("court"),
                            doc.get("caseType"),
                            doc.get("url"),
                            doc.get("prectype"),
                            doc.get("issues"),
                            doc.get("summary"),
                            doc.get("rawcontent"),
                            doc.get("referencedProvisions"),
                            doc.get("referencedPrecedents"),
                            False, # chunked
                            datetime.now() # created_at
                        )
                        for doc in new_docs
                    ]

                    # execute_values를 이용한 초고속 일괄 삽입 (page_size 1000)
                    execute_values(cur, insert_query, values_to_insert, page_size=1000)
                    
                    # 청크 하나 단위로 커밋하여 안전성 확보
                    conn.commit()
                    
                    # 새로 들어간 ID는 중복 셋업에 추가
                    for doc in new_docs:
                        existing_ids.add(doc["referenceId"])

                    total_inserted += len(values_to_insert)
                    log.info(f"[{idx:3d}/{len(chunk_files):3d}] {file.name} - {len(values_to_insert)}건 적재 완료")
                    
                except Exception as e:
                    conn.rollback() # 에러 발생 시 해당 파일 분량만 롤백
                    log.error(f"❌ {file.name} 처리 중 에러 발생: {e}")

    log.info("=" * 60)
    log.info(f"🎉 모든 작업 완료! 총 {total_inserted:,}건의 신규 판례가 적재되었습니다.")
    log.info("=" * 60)

if __name__ == "__main__":
    run_load()