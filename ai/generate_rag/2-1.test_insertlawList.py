import json

def analyze_and_clean_json(filepath):
    print(f"🔍 [{filepath}] 분석 시작...")
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"파일을 찾을 수 없습니다: {filepath}\n")
        return []

    clean_data = []
    null_mst_count = 0
    duplicate_mst_count = 0
    seen_mst = set()

    for item in data:
        mst = item.get('law_mst')
        
        # 1. law_mst가 Null인 경우 (DB 에러의 주범)
        if mst is None:
            null_mst_count += 1
            continue
            
        # 2. law_mst가 중복인 경우
        if mst in seen_mst:
            duplicate_mst_count += 1
            continue
            
        seen_mst.add(mst)
        clean_data.append(item)

    print(f"📊 분석 결과:")
    print(f"  - 원본 데이터 총합: {len(data)}건")
    print(f"  - ❌ law_mst가 Null인 데이터: {null_mst_count}건 (제거됨)")
    print(f"  - ⚠️ law_mst가 중복된 데이터: {duplicate_mst_count}건 (제거됨)")
    print(f"  - ✅ DB 삽입 가능(정상) 데이터: {len(clean_data)}건\n")
    
    return clean_data

# --- 실행부 ---
if __name__ == "__main__":
    current_clean = analyze_and_clean_json('current_laws.json')
    scheduled_clean = analyze_and_clean_json('scheduled_laws.json')