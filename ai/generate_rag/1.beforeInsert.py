import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import time
import json
#0505
"""
API 호출해서 "법령 리스트"를 조회해서 json 형식으로 가져옴.
현행 5583건, 시행예정 923건 나눠서 저장함
테이블에 insert하기전에 확인용
API 호출 형식은 https://open.law.go.kr/LSO/openApi/guideResult.do 에서 확인

1: 연혁, 2: 시행예정, 3: 현행 (기본값: 전체)
연혁+예정 : nw=1,2
예정+현행 : nw=2,3
연혁+현행 : nw=1,3
연혁+예정+현행 : nw=1,2,3

연혁은 과거라서 안함.

<OUTPUT>
1.current_laws.json - 현행 복록 목록
2.scheduled_laws.json - 시행 예정 목록 

파일까서 값 잘 들어가있는지 확인하고 Insert
"""
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import time
import json

def fetch_law_data_pure(api_key):
    # 1. 세션 및 재시도 로직 설정
    session = requests.Session()
    retry_strategy = Retry(
        total=5,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    base_url = "http://www.law.go.kr/DRF/lawSearch.do"
    
    current_laws = []    # nw=3 (현행)
    scheduled_laws = []  # nw=2 (시행예정)
    
    target_configs = [
        ('3', 3, current_laws),
        ('2', 2, scheduled_laws)
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }

    for nw_val, status_code, target_list in target_configs:
        status_label = "현행" if status_code == 3 else "시행예정"
        print(f"\n--- {status_label}(코드 {status_code}) 데이터 수집 시작 ---")
        
        page = 1
        total_count = 1
        collected_in_phase = 0

        while collected_in_phase < total_count:
            params = {
                "OC": api_key,
                "target": "eflaw",
                "type": "json",
                "nw": nw_val,
                "display": 50, # 몇개씩 가져올 지 조절하는 변수, 최대 100.
                "page": page
            }

            try:
                response = session.get(base_url, params=params, headers=headers, timeout=20)
                response.raise_for_status()
                data = response.json()
                
                search_result = data.get('LawSearch')
                if not search_result: break

                if page == 1:
                    total_count = int(search_result.get('totalCnt', 0))
                    print(f"[{status_label}] 총 {total_count}건 발견!")

                laws = search_result.get('law')
                if not laws: break
                if isinstance(laws, dict): laws = [laws]

                for law in laws:
                    #테이블 구조 매핑
                    item = {
                        # 안전장치 없이 '법령일련번호' 필드에서 직접 정수 변환 시도
                        "law_mst": int(law.get('법령일련번호')) if law.get('법령일련번호') else None,
                        "amend_type": law.get('제개정구분명'),
                        "current_history_code": law.get('현행연혁코드'),
                        "dept_code": law.get('소관부처코드'),
                        "dept_name": law.get('소관부처명'),
                        #"detail_link": law.get('법령상세링크'),
                        # 가져온 링크 문자열에서 HTML을 XML로 곧바로 치환해서 저장
                        "detail_link": law.get('법령상세링크', '').replace('type=HTML', 'type=XML').replace('type=json', 'type=XML') if law.get('법령상세링크') else None,
                        "enforce_date": law.get('시행일자'),
                        "joint_dept_info": law.get('공동부령구분'), 
                        "joint_promulgate_no": law.get('공포번호(공동부령의 공포번호)'),
                        "law_id": law.get('법령ID'),
                        "law_name_kr": law.get('법령명한글'),
                        "law_name_short": law.get('법령약칭명'),
                        "law_type_name": law.get('법령구분명'),
                        "promulgate_date": law.get('공포일자'),
                        "promulgate_no": law.get('공포번호'),
                        "self_other_law": law.get('자법타법여부'),
                        "law_status": status_code 
                    }
                    target_list.append(item)
                    collected_in_phase += 1

                print(f"[{status_label}] 진행: {collected_in_phase} / {total_count}")
                page += 1
                time.sleep(0.5)

            except Exception as e:
                print(f"오류 발생: {e}")
                time.sleep(3)
                continue

    # 파일 저장
    with open('current_laws.json', 'w', encoding='utf-8') as f:
        json.dump(current_laws, f, ensure_ascii=False, indent=4)
    with open('scheduled_laws.json', 'w', encoding='utf-8') as f:
        json.dump(scheduled_laws, f, ensure_ascii=False, indent=4)

    print(f"\n✅ 수집 완료! (현행: {len(current_laws)}건, 예정: {len(scheduled_laws)}건)")
    return current_laws, scheduled_laws

if __name__ == "__main__":
    MY_API_KEY = "hyejin" # API 키 입력
    fetch_law_data_pure(MY_API_KEY)