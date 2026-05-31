import json
import glob
import os
import re
import pandas as pd

# 절대 경로 설정
base_path = "/root/embedding-finetuning/115/3.개방데이터/1.데이터/Other/QA데이터"
qa_files = glob.glob(os.path.join(base_path, "*.json"))

# 논문 기준 전처리 함수
def clean_text(text):
    if not text: return ""
    # 한글, 영문, 숫자, 기본 문장 부호 외 제거
    cleaned = re.sub(r'[^가-힣a-zA-Z0-9\s.,!?\'\"]', '', text)
    return re.sub(r'\s+', ' ', cleaned).strip()

qa_pairs = []
print(f"총 {len(qa_files)}개의 파일을 검사합니다...")

for file_path in qa_files:
    filename = os.path.basename(file_path)
    
    # 1. 파일명이 '._' 로 시작하는 숨김 파일 무시
    if filename.startswith("._"):
        continue
        
    # 2. 파일 크기가 0인 빈 파일 무시
    if os.path.getsize(file_path) == 0:
        continue
        
    # 3. JSON 파싱 및 데이터 추출
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            # 논문: question 필드를 쿼리로, commentary 필드를 정답 문서로 활용
            query = clean_text(data.get("question", ""))
            positive = clean_text(data.get("commentary", ""))
            
            if query and positive:
                qa_pairs.append({"query": query, "commentary": positive})
                
    except json.JSONDecodeError:
        print(f"JSON 형식 오류 스킵: {filename}")
    except Exception as e:
        print(f"알 수 없는 에러 ({filename}): {e}")

df = pd.DataFrame(qa_pairs)
print(f"\n성공적으로 불러온 전처리 완료 데이터: {len(df)}건")