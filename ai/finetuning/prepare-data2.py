import json
import glob
import os
import re
import pandas as pd

base_path = "/root/embedding-finetuning/115/3.개방데이터/1.데이터/Other/QA데이터"
qa_files = glob.glob(os.path.join(base_path, "*.json"))


def clean_text(text):
    if not text: return ""
    cleaned = re.sub(r'[^가-힣a-zA-Z0-9\s.,!?\'\"]', '', text)
    return re.sub(r'\s+', ' ', cleaned).strip()

qa_pairs = []
skip_reasons = {
    "mac_hidden_file": 0,
    "empty_file": 0,
    "missing_fields": 0,
    "json_error": 0
}

for file_path in qa_files:
    filename = os.path.basename(file_path)
    
    # 원인 1. 맥북 숨김 파일
    if filename.startswith("._"):
        skip_reasons["mac_hidden_file"] += 1
        continue
        
    # 원인 2. 0바이트 파일
    if os.path.getsize(file_path) == 0:
        skip_reasons["empty_file"] += 1
        continue
        
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            query = clean_text(data.get("question", ""))
            positive = clean_text(data.get("commentary", ""))
            
            # 원인 3. 질문이나 해설이 없는 경우
            if query and positive:
                qa_pairs.append({"id": data.get("id", "N/A"), "query": query, "commentary": positive})
            else:
                skip_reasons["missing_fields"] += 1
                
    except json.JSONDecodeError:
        skip_reasons["json_error"] += 1

df = pd.DataFrame(qa_pairs)

# ================= 결과 출력 =================
print("=== 데이터 필터링 리포트 ===")
print(f"검사한 총 파일 수: {len(qa_files)}")
print(f"- 맥북 숨김 파일(._) 제외: {skip_reasons['mac_hidden_file']}건")
print(f"- 질문/해설 필드 누락 제외: {skip_reasons['missing_fields']}건")
print(f"- 빈 파일 제외: {skip_reasons['empty_file']}건")
print(f"- JSON 파싱 에러: {skip_reasons['json_error']}건")
print(f"-> 최종 유효 데이터: {len(df)}건\n")

if not df.empty:
    print("=== 추출된 데이터 샘플 3건 확인 ===")
    for i, row in df.head(3).iterrows():
        print(f"[{row['id']}]")
        print(f"Q: {row['query']}")
        print(f"A(해설): {row['commentary'][:100]}...\n")