import json
from pathlib import Path

# 앞서 저장한 청크 파일들이 있는 폴더 경로
CHUNK_DIR = "./tmp/parsed_chunks"

def validate_chunks():
    chunk_dir = Path(CHUNK_DIR)
    chunk_files = sorted(list(chunk_dir.glob("chunk_*.json")))
    
    if not chunk_files:
        print(f"[{CHUNK_DIR}] 폴더에 JSON 파일이 없습니다.")
        return

    total_cases = 0
    missing_chunks = []

    print("=" * 50)
    print("청크 파일 데이터 검증을 시작합니다...")
    print("=" * 50)

    for file in chunk_files:
        try:
            with file.open("r", encoding="utf-8") as f:
                data = json.load(f)
                count = len(data)
                total_cases += count
                
                # 1000개가 안 되는 파일 표시 (마지막 파일이거나 누락이 있는 경우)
                if count != 1000:
                    print(f"⚠️ {file.name} : {count}건 (1000건 미만)")
                else:
                    print(f"✅ {file.name} : {count}건")
                    
        except Exception as e:
            print(f"❌ {file.name} 읽기 실패: {e}")
            missing_chunks.append(file.name)

    print("=" * 50)
    print(f"총 검증된 파일 수: {len(chunk_files)}개")
    print(f"전체 누적 판례 수: {total_cases:,}건")
    if missing_chunks:
        print(f"에러가 발생한 파일: {missing_chunks}")
    print("=" * 50)

if __name__ == "__main__":
    validate_chunks()