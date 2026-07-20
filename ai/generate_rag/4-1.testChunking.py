import psycopg2
import re
import json

# DB 접속 정보는 환경변수로 분리 (config.py가 .env 자동 로드)
from config import DB_CONFIG  # noqa: F401

def parse_articles(raw_content):
    """
    raw_content를 정규식을 이용해 '조문' 단위로 분리
    """
    chunks = []
    
    # 정규식 설명: 
    # ^(제\d+(?:조의\d+)?) : '제1조' 또는 '제3조의2' 같은 조문 번호 캡처 (그룹1)
    # (?:\(([^)]+)\))?     : '(목적)' 같은 조문 제목 캡처 (선택사항, 그룹2)
    # \s*(.*?)             : 조문 내용 캡처 (그룹3)
    # (?=^제\d+(?:조의\d+)?|\Z) : 다음 조문이 시작되거나 문서가 끝날 때까지 (Lookahead)
    pattern = re.compile(
        r"^(제\d+(?:조의\d+)?)(?:\(([^)]+)\))?\s*(.*?)(?=^제\d+(?:조의\d+)?|\Z)", 
        re.MULTILINE | re.DOTALL
    )

    matches = pattern.finditer(raw_content)
    
    for match in matches:
        article_no = match.group(1).strip() # 예: 제1조
        article_title = match.group(2).strip() if match.group(2) else "" # 예: 목적
        article_text = match.group(3).strip() # 예: 이 법은 10ㆍ27법난과 관련하여...

        # Chroma의 document(원문)에 들어갈 전체 텍스트 조립
        title_part = f"({article_title})" if article_title else ""
        full_text = f"{article_no}{title_part} {article_text}"

        chunks.append({
            "articleNo": article_no,
            "articleTitle": article_title,
            "text": full_text
        })
        
    return chunks

def test_chunking_logic():
    print("🚀 청킹(Chunking) 로직 테스트를 시작합니다...\n")
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 아직 청킹되지 않은 데이터 1건만 가져오기
        cursor.execute("""
            SELECT id, reference_id, title, short_name, department, 
                   enforce_date, revision_type, url, raw_content 
            FROM public.law_documents 
            WHERE chunked = false 
            LIMIT 1;
        """)
        
        row = cursor.fetchone()
        if not row:
            print("테이블에 청킹할 데이터가 없습니다.")
            return

        row_id, reference_id, title, short_name, department, enforce_date, revision_type, url, raw_content = row
        
        print(f"📌 타겟 법령: {title} (MST: {reference_id})")
        
        # 1. 정규식으로 조문 분리
        articles = parse_articles(raw_content)
        
        print(f"✂️ 총 {len(articles)}개의 조문으로 분리되었습니다.\n")
        
        # 2. ChromaDB 스키마에 맞게 딕셔너리 매핑
        chroma_chunks = []
        for article in articles:
            chunk_id = f"law_{reference_id}_{article['articleNo']}"
            
            chunk_data = {
                "chunkId": chunk_id,
                "document": article['text'],
                "metadata": {
                    "rowId": row_id,
                    "sourceType": "LAW",
                    "title": title,
                    "shortName": short_name or "",
                    "articleNo": article['articleNo'],
                    "articleTitle": article['articleTitle'],
                    "department": department or "",
                    "enforceDate": enforce_date or "",
                    "revisionType": revision_type or "",
                    "url": url or ""
                }
            }
            chroma_chunks.append(chunk_data)

        # 3. 결과 출력 (제1조, 제2조만 샘플로 확인)
        print("=== 📦 [ChromaDB 적재용 데이터 구조 미리보기] ===")
        for chunk in chroma_chunks[:2]: 
            print(json.dumps(chunk, ensure_ascii=False, indent=2))
            print("-" * 40)
            
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    test_chunking_logic()