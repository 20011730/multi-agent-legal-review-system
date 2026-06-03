"""
국세청 조세 판례 청킹 결과물 무결성 검증 스크립트
- 500 토큰 초과 청크 색출
- 필수 메타데이터(사건번호, 세목) 누락 확인
- 무작위 눈도장 검사(Random Sampling)를 통한 구조 확인
"""

import os
import glob
import json
import random
from pathlib import Path

# 앞서 청킹 코드가 저장한 폴더 경로와 동일하게 세팅
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = PROJECT_ROOT / "data" / "chunked_precedents"

MAX_TOKEN_BUDGET = 500

def verify_and_report():
    jsonl_files = glob.glob(os.path.join(OUTPUT_DIR, "*.jsonl"))
    
    if not jsonl_files:
        print(f"❌ 경로 오류: {OUTPUT_DIR} 에 JSONL 파일이 없어.")
        return

    # 통계 집계용 변수
    total_files = len(jsonl_files)
    total_docs = 0
    total_parents = 0
    total_children = 0
    
    max_token_found = 0
    over_budget_chunks = 0
    missing_meta_count = 0
    
    # 샘플링용 풀
    all_children_pool = []

    print(f"🔍 총 {total_files}개의 JSONL 파일 무결성 검증을 시작할게...\n")

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
                
                # 자식 청크(실제 벡터 DB에 들어갈 텍스트)들의 토큰 검증
                for child in children:
                    tokens = child.get("token_count", 0)
                    if tokens > max_token_found:
                        max_token_found = tokens
                    
                    if tokens > MAX_TOKEN_BUDGET:
                        over_budget_chunks += 1

                # 필수 메타데이터 누락 체크 (국세청 데이터 기준: 사건번호, 세목)
                if not meta.get("doc_number") or not meta.get("tax_type"):
                    missing_meta_count += 1

                # 랜덤 샘플링 (파일당 일정 비율로 추출)
                if children and random.random() < 0.05: 
                    all_children_pool.append((meta.get("doc_number", "알수없음"), random.choice(children)))

    # ─────────────────────────────────────────────────────────────────────────
    # 결과 리포트 출력
    # ─────────────────────────────────────────────────────────────────────────
    print("=" * 60)
    print(" 📊 [청킹 무결성 검증 요약 리포트] ")
    print("=" * 60)
    print(f"▶ 검증된 파일 수   : {total_files:,} 개")
    print(f"▶ 원본 판례 건수   : {total_docs:,} 건")
    print(f"▶ 생성된 Parent 수 : {total_parents:,} 개 (문맥 보존용)")
    print(f"▶ 생성된 Child 수  : {total_children:,} 개 (Vector DB 인서트 대상)")
    print("-" * 60)
    print(f"▶ 최고 토큰 길이   : {max_token_found} 토큰 (제한: {MAX_TOKEN_BUDGET})")
    
    if over_budget_chunks == 0:
        print(f"▶ 예산 초과 청크   : {over_budget_chunks} 건 🟢 (완벽함)")
    else:
        print(f"▶ 예산 초과 청크   : {over_budget_chunks:,} 건 🔴 (확인 필요 - 정규식 타격 실패 단락 존재)")
        
    if missing_meta_count == 0:
        print(f"▶ 메타데이터 누락  : {missing_meta_count} 건 🟢 (정상)")
    else:
        print(f"▶ 메타데이터 누락  : {missing_meta_count:,} 건 🔴 (크롤링 원본 데이터 점검 필요)")
    print("=" * 60)

    # ─────────────────────────────────────────────────────────────────────────
    # 무작위 눈도장 검사 (랜덤 3건)
    # ─────────────────────────────────────────────────────────────────────────
    print("\n🧐 [무작위 청크 샘플링 검사 (3건)]")
    if all_children_pool:
        samples = random.sample(all_children_pool, min(3, len(all_children_pool)))
        for i, (doc_num, child) in enumerate(samples, 1):
            print(f"\n[샘플 {i}] 사건번호: {doc_num} | 섹션: {child.get('section_type')} | 토큰: {child.get('token_count')}")
            print("-" * 60)
            print(child.get("content"))
            print("-" * 60)

if __name__ == "__main__":
    verify_and_report()
