import psycopg2
import urllib.request
import xml.etree.ElementTree as ET
import xml.dom.minidom
import ssl

# DB 접속 정보 
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost',
    'port': '5432'
}

def test_law_body_parsing():
    print("🚀 법령 본문 파싱 테스트를 시작합니다 (urllib 우회 방식)...\n")
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 데이터 1건 가져오기
        cursor.execute("""
            SELECT law_mst, law_name_kr 
            FROM public.law_list 
            WHERE detail_link IS NOT NULL 
            LIMIT 1;
        """)
        result = cursor.fetchone()

        if not result:
            print("테이블에 데이터가 없습니다.")
            return

        law_mst, law_name_kr = result
        print(f"📌 타겟 법령: {law_name_kr} (MST: {law_mst})")
        
        # ==========================================
        # 💡 Requests 대신 기본 urllib 사용 + HTTPS 강제 적용
        # ==========================================
        # HTTP -> HTTPS로 변경하여 통신 안정성 확보
        api_url = f"https://www.law.go.kr/DRF/lawService.do?OC=hyejin&target=eflaw&type=XML&MST={law_mst}"
        
        print(f"🔗 호출 URL: {api_url}\n")

        # 정부 사이트의 까다로운 SSL 인증서 검증을 강제로 통과시키는 마법의 주문
        context = ssl._create_unverified_context()
        
        # 가벼운 헤더만 추가
        req = urllib.request.Request(
            api_url, 
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        
        # urllib을 이용해 안전하게 데이터 가져오기
        with urllib.request.urlopen(req, context=context, timeout=15) as response:
            xml_data = response.read().decode('utf-8')

        # ==========================================
        # [테스트 1] Raw XML 구조 눈으로 확인하기
        # ==========================================
        print("=== 📄 [Raw XML 구조 미리보기 (상위 30줄)] ===")
        parsed_xml = xml.dom.minidom.parseString(xml_data)
        pretty_xml = parsed_xml.toprettyxml(indent="  ")
        print('\n'.join(pretty_xml.split('\n')))

        # ==========================================
        # [테스트 2] 핵심 데이터(조문) 파싱해보기
        # ==========================================
        print("=== 🔎 [데이터 파싱 테스트: 본문 조문 추출] ===")
        root = ET.fromstring(xml_data)
        
        jo_list = root.findall('.//조문단위')
        
        if not jo_list:
            print("이 법령에는 <조문단위> 태그가 없거나 구조가 다릅니다.")
        else:
            for i, jo in enumerate(jo_list[:3]):
                jo_num = jo.findtext('조문번호', '번호없음')
                jo_title = jo.findtext('조문제목', '')
                jo_content = jo.findtext('조문내용', '내용없음')
                
                title_str = f"({jo_title})" if jo_title else ""
                print(f"제{jo_num}조{title_str} : {jo_content.strip()}")

    except Exception as e:
        print(f"❌ 오류 발생: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    test_law_body_parsing()