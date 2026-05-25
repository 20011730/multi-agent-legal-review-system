import os
import glob
import json
import random

OUTPUT_DIR = "./tmp/jsonl_exports"

def verify_and_report():
    jsonl_files = glob.glob(os.path.join(OUTPUT_DIR, "*.jsonl"))
    
    if not jsonl_files:
        print("❌ 지정된 경로에 JSONL 파일이 없습니다.")
        return

    # 통계용 변수
    total_files = len(jsonl_files)
    total_docs = 0
    total_parents = 0
    total_children = 0
    
    max_token_found = 0
    over_budget_chunks = 0
    missing_meta_count = 0
    
    # 샘플링용 리스트
    all_children_pool = []

    print(f"🔍 총 {total_files}개의 JSONL 파일을 검증합니다. 잠시만 기다려주세요...\n")

    for file_path in jsonl_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    doc = json.loads(line)
                except json.JSONDecodeError:
                    print(f"⚠️ JSON 파싱 에러 발생: {file_path}")
                    continue

                total_docs += 1
                meta = doc.get("meta", {})
                parents = doc.get("parents", [])
                children = doc.get("children", [])
                
                total_parents += len(parents)
                total_children += len(children)
                
                # 통계 수집
                if meta.get("child_over_budget_count", 0) > 0:
                    over_budget_chunks += meta.get("child_over_budget_count")
                
                child_max = meta.get("child_token_max", 0)
                if child_max > max_token_found:
                    max_token_found = child_max
                    
                # 필수 메타데이터 누락 체크 (court, case_number 유무)
                if not meta.get("court") or not meta.get("case_number"):
                    missing_meta_count += 1

                # 랜덤 샘플링을 위해 일부만 메모리에 보관 (파일당 1개 꼴)
                if children and random.random() < 0.01: 
                    all_children_pool.append((meta.get("case_number"), random.choice(children)))

    # ─────────────────────────────────────────────────────────────────────────
    # 결과 리포트 출력
    # ─────────────────────────────────────────────────────────────────────────
    print("=" * 60)
    print(" 📊 [1단계 청킹 완료 요약 리포트] ")
    print("=" * 60)
    print(f"▶ 처리된 파일 수   : {total_files:,} 개")
    print(f"▶ 처리된 판례 건수 : {total_docs:,} 건")
    print(f"▶ 생성된 Parent 수 : {total_parents:,} 개")
    print(f"▶ 생성된 Child 수  : {total_children:,} 개 (Vector DB 인서트 대상)")
    print("-" * 60)
    print(f"▶ 최고 토큰 길이   : {max_token_found} 토큰")
    
    if over_budget_chunks == 0:
        print(f"▶ 예산 초과 청크   : {over_budget_chunks} 건 🟢 (완벽함!)")
    else:
        print(f"▶ 예산 초과 청크   : {over_budget_chunks} 건 🔴 (확인 필요)")
        
    if missing_meta_count == 0:
        print(f"▶ 메타데이터 누락  : {missing_meta_count} 건 🟢 (정상)")
    else:
        print(f"▶ 메타데이터 누락  : {missing_meta_count} 건 🔴 (데이터 확인 필요)")
    print("=" * 60)

    # ─────────────────────────────────────────────────────────────────────────
    # 무작위 눈도장 검사 (랜덤 3건)
    # ─────────────────────────────────────────────────────────────────────────
    print("\n🧐 [무작위 청크 샘플링 검사 (3건)]")
    if all_children_pool:
        samples = random.sample(all_children_pool, min(3, len(all_children_pool)))
        for i, (case_num, child) in enumerate(samples, 1):
            print(f"\n[샘플 {i}] 사건번호: {case_num} | 태그: {child.get('section_type')} | 토큰: {child.get('token_count')}")
            print("-" * 60)
            print(child.get("content"))
            print("-" * 60)

if __name__ == "__main__":
    verify_and_report()