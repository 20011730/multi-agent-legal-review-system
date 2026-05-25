"""
대규모 판례 XML 대량 수집 스크립트 (Step 1 전용)
- PostgreSQL DB 연동하여 prec_serial 조회
- OpenAPI 호출 후 raw_xml 폴더에 개별 파일로 저장
- 이미 존재하는 파일은 건너뛰기 (이어받기 완벽 지원)
"""
import time
import urllib.request
import urllib.parse
import ssl
from pathlib import Path
import psycopg2
from tqdm import tqdm

# ============================================================
# [설정] 본인 환경에 맞게 수정하세요
# ============================================================
OC = "hyejin"  # 국가법령정보센터 API 인증키

# PostgreSQL DB 접속 정보
DB_CONFIG = {
    "host": "localhost",
    "database": "legalreview",  
    "user": "legalreview",     
    "password": "legalreview", 
    "port": "5432"
}

# 디렉토리 설정
OUTPUT_DIR = Path("./precedent_pipeline")
RAW_XML_DIR = OUTPUT_DIR / "raw_xml"
RAW_XML_DIR.mkdir(parents=True, exist_ok=True)

ssl_ctx = ssl._create_unverified_context()

# ============================================================
# OpenAPI 호출 헬퍼 (재시도 로직 포함)
# ============================================================
def fetch_api_with_retry(url, timeout=10, max_retries=5):
    """API 호출 및 에러 발생 시 자동 재시도"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*'
    }
    
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=timeout) as response:
                return response.read().decode('utf-8')
        except Exception as e:
            if attempt == max_retries:
                raise e
            time.sleep(1 * attempt)  # 실패 시 1초, 2초, 3초... 늘려가며 대기


# ============================================================
# 메인 실행부
# ============================================================
def main():
    print("=" * 60)
    print("  [STEP 1] DB 연동 및 판례 XML 대량 수집 시작")
    print("=" * 60)
    
    # 1. PostgreSQL 연결 및 prec_serial 가져오기
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        # null 값이 아닌 정상적인 serial 번호만 가져오기
        cursor.execute("SELECT prec_serial FROM precedent_list WHERE prec_serial IS NOT NULL;")
        rows = cursor.fetchall()
        serial_list = [str(row[0]) for row in rows]
        conn.close()
        print(f"✅ DB에서 총 {len(serial_list):,}건의 판례 ID를 불러왔습니다.")
    except Exception as e:
        print(f"❌ DB 연결 실패: {e}")
        return

    # 2. XML 수집 (이어받기 적용)
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    # tqdm을 사용해 17.2만건의 진행 상태를 시각적으로 확인
    for case_id in tqdm(serial_list, desc="XML 다운로드 진행률", unit="건"):
        file_path = RAW_XML_DIR / f"{case_id}.xml"
        
        # 이미 파일이 존재하면 다운로드 건너뜀 (이어받기 핵심 로직)
        if file_path.exists():
            skip_count += 1
            continue
            
        url = (
            f"https://www.law.go.kr/DRF/lawService.do?"
            f"OC={OC}&target=prec&type=XML&ID={case_id}"
        )
        
        try:
            xml_str = fetch_api_with_retry(url)
            file_path.write_text(xml_str, encoding='utf-8')
            success_count += 1
            
            # 서버 IP 차단을 막기 위한 필수 딜레이 (0.1 ~ 0.3초 권장)
            time.sleep(0.1) 
            
        except Exception as e:
            fail_count += 1
            # 실패해도 스크립트가 멈추지 않고 다음 판례로 넘어갑니다.

    print("\n" + "=" * 60)
    print("  🎉 [STEP 1 완료 통계]")
    print("=" * 60)
    print(f"  - 신규 다운로드 성공 : {success_count:,}건")
    print(f"  - 기존 파일 건너뜀   : {skip_count:,}건")
    print(f"  - 다운로드 실패      : {fail_count:,}건")
    print(f"  👉 저장 경로: {RAW_XML_DIR.absolute()}")


if __name__ == "__main__":
    main()