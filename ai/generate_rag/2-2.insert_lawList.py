import json
import psycopg2
from psycopg2.extras import execute_batch

# 1. 데이터베이스 접속 정보 (본인의 환경에 맞게 수정하세요)
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost', 
    'port': '5432'
}

def insert_json_to_db(json_filepath):
    print(f"\n[{json_filepath}] 파일 읽는 중...")
    
    # JSON 파일 로드
    try:
        with open(json_filepath, 'r', encoding='utf-8') as f:
            law_data = json.load(f)
    except FileNotFoundError:
        print(f"오류: {json_filepath} 파일을 찾을 수 없습니다.")
        return

    if not law_data:
        print("데이터가 없습니다.")
        return

    print(f"총 {len(law_data)}건의 데이터를 DB에 삽입합니다.")

    # 2. INSERT SQL 쿼리 작성 (딕셔너리 매핑 방식)
    # ON CONFLICT DO NOTHING: 이미 같은 law_mst가 있다면 중복 에러를 내지 않고 무시합니다.
    insert_query = """
        INSERT INTO public.law_list (
            law_mst, amend_type, current_history_code, dept_code, dept_name,
            detail_link, enforce_date, joint_dept_info, joint_promulgate_no,
            law_id, law_name_kr, law_name_short, law_type_name,
            promulgate_date, promulgate_no, self_other_law, law_status
        ) VALUES (
            %(law_mst)s, %(amend_type)s, %(current_history_code)s, %(dept_code)s, %(dept_name)s,
            %(detail_link)s, %(enforce_date)s, %(joint_dept_info)s, %(joint_promulgate_no)s,
            %(law_id)s, %(law_name_kr)s, %(law_name_short)s, %(law_type_name)s,
            %(promulgate_date)s, %(promulgate_no)s, %(self_other_law)s, %(law_status)s
        )
        ON CONFLICT (law_mst) DO NOTHING;
    """

    # 3. DB 연결 및 데이터 일괄 삽입(Batch Insert)
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        # 1000건씩 묶어서 고속 삽입
        execute_batch(cursor, insert_query, law_data, page_size=1000)
        
        # 변경사항 저장 (Commit)
        conn.commit()
        print(f"✅ {json_filepath} DB 삽입 완료!")

    except psycopg2.DatabaseError as error:
        print(f"DB 오류 발생: {error}")
        if conn:
            conn.rollback() # 오류 발생 시 원상복구
    finally:
        if conn:
            cursor.close()
            conn.close()

# --- 실행부 ---
if __name__ == "__main__":
    # 두 개의 JSON 파일을 순차적으로 DB에 밀어 넣음
    insert_json_to_db('current_laws.json')
    insert_json_to_db('scheduled_laws.json')
    
    print("\n🎉 모든 데이터의 DB 인서트 작업이 종료되었습니다.")