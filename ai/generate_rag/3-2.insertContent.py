import psycopg2
import urllib.request
import ssl
import xml.etree.ElementTree as ET
import time

# ==========================================
# 1. 설정 및 헬퍼 함수
# ==========================================
# DB / OC는 환경변수로 분리 (config.py가 .env 자동 로드)
from config import DB_CONFIG, require_law_api_oc

context = ssl._create_unverified_context()

def safe_text(text):
    return text.strip() if text else ""

def build_raw_content(root, title, law_mst, department, enforce_date):
    """조-항-호-목 계층 구조를 분석하여 텍스트로 조립합니다."""
    parts = []
    parts.append(f"[법령] {title} (MST={law_mst})")
    if department: parts.append(f"소관부처: {department}")
    if enforce_date: parts.append(f"시행일: {enforce_date}")
    parts.append("")

    jo_list = root.findall('.//조문단위')
    
    if not jo_list:
        return "\n".join(parts) + "\n--- API 응답 원문 (조문 파싱 실패) ---\n" + ET.tostring(root, encoding='unicode')

    for jo in jo_list:
        jo_num = safe_text(jo.findtext('조문번호'))
        jo_title = safe_text(jo.findtext('조문제목'))
        jo_content = safe_text(jo.findtext('조문내용'))

        # [중복 방지] 조문내용이 이미 "제n조"로 시작하는지 체크
        if jo_num and jo_content.startswith(f"제{jo_num}조"):
            parts.append(jo_content.strip())
        else:
            title_str = f"({jo_title})" if jo_title else ""
            num_str = f"제{jo_num}조" if jo_num else ""
            parts.append(f"{num_str}{title_str} {jo_content}".strip())

        # 1. 항(①, ②...)
        for hang in jo.findall('.//항'):
            hang_content = safe_text(hang.findtext('항내용'))
            if hang_content:
                parts.append("  " + hang_content)
                
                # 2. 호(1., 2. ...)
                for ho in hang.findall('.//호'):
                    ho_content = safe_text(ho.findtext('호내용'))
                    if ho_content:
                        parts.append("    " + ho_content)
                        
                        # 3. 목(가., 나. ...)
                        for mok in ho.findall('.//목'):
                            mok_content = safe_text(mok.findtext('목내용'))
                            if mok_content:
                                parts.append("      " + mok_content)
        
        parts.append("")

    return "\n".join(parts)

# ==========================================
# 2. 핵심 수집 로직 (단건 처리용)
# ==========================================
def process_single_law(cursor, conn, row, insert_query):
    law_mst, title, short_name, department, enforce_date, revision_type, url = row
    law_mst_str = str(law_mst)
    
    _oc = require_law_api_oc()
    api_url = f"https://www.law.go.kr/DRF/lawService.do?OC={_oc}&target=eflaw&type=XML&MST={law_mst}"
    req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
    
    with urllib.request.urlopen(req, context=context, timeout=15) as response:
        xml_data = response.read().decode('utf-8')
    
    root = ET.fromstring(xml_data)
    raw_content = build_raw_content(root, title, law_mst_str, department, enforce_date)
    
    cursor.execute(insert_query, (
        law_mst_str, title, short_name, department, enforce_date, revision_type, url, raw_content
    ))
    conn.commit()
    return title

# ==========================================
# 3. 실행 루프 (본 수집 + 재시도)
# ==========================================
def run_ingestion_with_retry():
    print("🚀 법령 본문 수집을 시작합니다 (실패 시 자동 재시도 포함)...")
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 수집 대상 조회 (DB에 없는 것만)
        cursor.execute("""
            SELECT law_mst, law_name_kr, law_name_short, dept_name, enforce_date, amend_type, detail_link
            FROM public.law_list
            WHERE law_status = '3' 
              AND CAST(law_mst AS VARCHAR) NOT IN (SELECT reference_id FROM public.law_documents);
        """)
        
        target_laws = cursor.fetchall()
        total_count = len(target_laws)
        
        if total_count == 0:
            print("✅ 모두 적재되어 있습니다.")
            return

        print(f"🎯 총 {total_count}건 수집 예정\n")

        insert_query = """
            INSERT INTO public.law_documents (
                reference_id, title, short_name, department, enforce_date, revision_type, url, raw_content, chunked, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, false, NOW(), NOW())
        """

        failed_rows = [] # 💥 에러난 법령들을 모아둘 리스트

        # --- [1차 본 수집] ---
        for idx, row in enumerate(target_laws, 1):
            try:
                title = process_single_law(cursor, conn, row, insert_query)
                print(f"[{idx}/{total_count}] ✅ {title}")
                time.sleep(0.5)
            except Exception as e:
                conn.rollback()
                title = row[1]
                print(f"[{idx}/{total_count}] ❌ {title} (오류: {e}) -> ⏳ 재시도 대기열에 추가")
                failed_rows.append(row)
                time.sleep(1)

        # --- [2차 재시도 로직] ---
        if failed_rows:
            retry_count = len(failed_rows)
            print(f"\n🔄 1차 수집 완료. 실패한 {retry_count}건에 대해 [안전 모드]로 재시도를 시작합니다...")
            print("서버 차단을 막기 위해 대기 시간을 늘려서 천천히 진행합니다 (건당 3초 휴식).\n")
            
            time.sleep(5) # 재시도 전 API 서버에 숨 돌릴 시간 5초 부여
            
            final_failed = 0
            for idx, row in enumerate(failed_rows, 1):
                try:
                    title = process_single_law(cursor, conn, row, insert_query)
                    print(f"[재시도 {idx}/{retry_count}] ✅ 성공: {title}")
                    time.sleep(3) # 안전 모드: 3초 휴식
                except Exception as e:
                    conn.rollback()
                    title = row[1]
                    print(f"[재시도 {idx}/{retry_count}] ❌ 최종 실패: {title} (오류: {e})")
                    final_failed += 1
                    time.sleep(3)
            
            print(f"\n🎉 모든 작업이 종료되었습니다. (최종 실패: {final_failed}건)")
        else:
            print("\n🎉 모든 작업이 실패 없이 한 번에 종료되었습니다!")

    except Exception as e:
        print(f"시스템 오류: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    run_ingestion_with_retry()