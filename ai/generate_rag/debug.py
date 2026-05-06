import json

# 용의선상에 오른 50글자 제한 컬럼들
target_columns = ['amend_type', 'dept_code', 'joint_promulgate_no']

with open('current_laws.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("🔍 50글자 제한 컬럼 3개 집중 탐색 중...\n")

found_error = False

for item in data:
    for col in target_columns:
        value = item.get(col)
        
        # 값이 존재하고, 문자열이면서 길이가 50을 초과하는 경우
        if value and isinstance(value, str) and len(value) > 50:
            print(f"🚨 범인 발견! [법령: {item.get('law_name_kr')}]")
            print(f"   - 컬럼명: {col}")
            print(f"   - 글자수: {len(value)}자")
            print(f"   - 실제값: {value}\n")
            found_error = True

if not found_error:
    print("✅ 타겟 컬럼 3개 중에는 50글자를 넘는 데이터가 없습니다.")