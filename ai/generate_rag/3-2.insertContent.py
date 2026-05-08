import psycopg2
import urllib.request
import ssl
import xml.etree.ElementTree as ET
import time
from datetime import datetime

#CPU 사용량 넉넉하면 API 병렬로 처리하면 빠름
#🎉 수집 작업이 종료되었습니다!
#  - 성공: 5583건
#  - 실패: 1건

# ==========================================
# 1. DB 접속 정보 
# ==========================================
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost',
    'port': '5432'
}

# SSL 인증서 강제 패스 (정부 API 방화벽 우회)
context = ssl._create_unverified_context()

def safe_text(text):
    """None 값을 빈 문자열로 안전하게 변환하는 헬퍼 함수"""
    return text.strip() if text else ""

def build_raw_content(root, title, law_mst, department, enforce_date):
    """XML 트리에서 조문(조, 항, 호)을 추출해 사람이 읽기 편한 텍스트로 조립합니다."""
    parts = []
    parts.append(f"[법령] {title} (MST={law_mst})")
    if department: parts.append(f"소관부처: {department}")
    if enforce_date: parts.append(f"시행일: {enforce_date}")
    parts.append("") # 빈 줄 추가

    jo_list = root.findall('.//조문단위')
    
    if not jo_list:
        # 조문이 없으면 XML 원문을 텍스트로 통째로 저장 (Fallback)
        return "\n".join(parts) + "\n--- API 응답 원문 (조문 파싱 실패) ---\n" + ET.tostring(root, encoding='unicode')

    for jo in jo_list:
        jo_num = safe_text(jo.findtext('조문번호'))
        jo_title = safe_text(jo.findtext('조문제목'))
        jo_content = safe_text(jo.findtext('조문내용'))

        title_str = f"({jo_title})" if jo_title else ""
        num_str = f"제{jo_num}조" if jo_num else ""
        
        # [제1조(목적) 이 법은...] 형태로 조립
        parts.append(f"{num_str}{title_str} {jo_content}".strip())

        # '항'이 있다면 추가 (예: ① 모든 국민은...)
        for hang in jo.findall('.//항'):
            hang_content = safe_text(hang.findtext('항내용'))
            if hang_content:
                parts.append("  " + hang_content)
                
                # '호'가 있다면 추가 (예: 1. 첫째 항목...)
                for ho in hang.findall('.//호'):
                    ho_content = safe_text(ho.findtext('호내용'))
                    if ho_content:
                        parts.append("    " + ho_content)
        
        parts.append("") # 조문과 조문 사이 빈 줄

    return "\n".join(parts)

def run_batch_ingestion():
    print("🚀 현행 법령(law_status=3) 본문 수집을 시작합니다...\n")
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # ==========================================
        # 2. 수집 대상 조회 (스마트 이어받기 로직)
        # ==========================================
        # law_documents에 아직 들어가지 않은(NOT IN) 현행 법령(status='3')만 가져옵니다.
        # Spring JPA는 카멜케이스(referenceId)를 스네이크케이스(reference_id)로 DB에 매핑합니다.
        cursor.execute("""
            SELECT law_mst, law_name_kr, law_name_short, dept_name, enforce_date, amend_type, detail_link
            FROM public.law_list
            WHERE law_status = '3' 
              AND CAST(law_mst AS VARCHAR) NOT IN (SELECT reference_id FROM public.law_documents);
        """)
        
        target_laws = cursor.fetchall()
        total_count = len(target_laws)
        
        if total_count == 0:
            print("✅ 수집할 대상이 없습니다. (모두 적재 완료!)")
            return

        print(f"🎯 총 {total_count}건의 법령 본문을 수집합니다.\n")

        insert_query = """
            INSERT INTO public.law_documents (
                reference_id, title, short_name, department, enforce_date, revision_type, url, raw_content, chunked, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, false, %s, %s
            )
        """

        success_count = 0
        fail_count = 0

        # ==========================================
        # 3. 본문 API 호출 및 DB Insert (For Loop)
        # ==========================================
        for idx, row in enumerate(target_laws, 1):
            law_mst, title, short_name, department, enforce_date, revision_type, url = row
            
            # None 방어
            law_mst_str = str(law_mst)
            
            try:
                # API 호출 (urllib)
                api_url = f"https://www.law.go.kr/DRF/lawService.do?OC=hyejin&target=eflaw&type=XML&MST={law_mst}"
                req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
                
                with urllib.request.urlopen(req, context=context, timeout=15) as response:
                    xml_data = response.read().decode('utf-8')
                
                # XML 파싱 및 텍스트 조립
                root = ET.fromstring(xml_data)
                raw_content = build_raw_content(root, title, law_mst_str, department, enforce_date)
                
                now = datetime.now()
                
                # DB 한 건씩 Insert (안전성 최우선)
                cursor.execute(insert_query, (
                    law_mst_str, title, short_name, department, enforce_date, revision_type, url, raw_content, now, now
                ))
                conn.commit()
                success_count += 1
                
                # 진행률 출력 (매 건마다)
                print(f"[{idx}/{total_count}] ✅ 성공: {title} (MST: {law_mst_str})")
                
                # 💥 공공 API 서버가 차단하지 않도록 0.5초 휴식
                time.sleep(0.5)

            except Exception as e:
                conn.rollback() # 에러 나면 해당 건만 롤백
                fail_count += 1
                print(f"[{idx}/{total_count}] ❌ 실패: {title} (MST: {law_mst_str}) - 사유: {e}")
                # 실패해도 다음 법령으로 계속 진행
                time.sleep(1) 

        print("\n🎉 수집 작업이 종료되었습니다!")
        print(f"  - 성공: {success_count}건")
        print(f"  - 실패: {fail_count}건")

    except Exception as e:
        print(f"DB 연결 및 쿼리 실행 중 치명적 오류: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    run_batch_ingestion()