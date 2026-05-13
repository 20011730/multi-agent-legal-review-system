import psycopg2
import chromadb
import re
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
from sentence_transformers import SentenceTransformer

# ==========================================
# 1. 설정 및 커스텀 임베딩 함수 (E5 로컬 모델)
# ==========================================
# DB / Chroma / E5 모델 이름은 환경변수로 분리 (config.py가 .env 자동 로드)
from config import DB_CONFIG, CHROMA_DB_DIR, E5_MODEL_NAME  # noqa: F401

class E5EmbeddingFunction(EmbeddingFunction):
    """ChromaDB용 커스텀 E5 임베딩 함수"""
    def __init__(self, model_name: str = E5_MODEL_NAME):
        print(f"🧠 로컬 임베딩 모델[{model_name}]을 메모리에 로드 중입니다. (최초 1회 시간 소요)")
        self.model = SentenceTransformer(model_name)

    def __call__(self, input: Documents) -> Embeddings:
        # DB 적재용 문서는 'passage: ' 접두사를 붙여야 E5 모델 성능이 극대화됩니다.
        passages = [f"passage: {doc}" for doc in input]
        embeddings = self.model.encode(passages, normalize_embeddings=True)
        return embeddings.tolist()

def reset_and_setup_chroma():
    """ChromaDB를 완전히 초기화하고 새 컬렉션을 생성합니다."""
    print("🧹 [1/3] ChromaDB 로컬 스토리지를 초기화합니다...")
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    
    # 기존에 만들어둔 컬렉션이 있다면 싹 지웁니다.
    try:
        chroma_client.delete_collection(name="laws")
        print("   🗑️ 기존 'laws' 컬렉션을 삭제했습니다.")
    except Exception:
        print("   ℹ️ 기존 컬렉션이 없어 새로 생성합니다.")
        
    # 새로운 빈 컬렉션 생성 및 로컬 E5 임베딩 함수 장착
    local_ef = E5EmbeddingFunction()
    collection = chroma_client.create_collection(
        name="laws",
        embedding_function=local_ef,
        metadata={"hnsw:space": "cosine"}
    )
    return collection

def parse_articles(raw_content):
    """원문을 조문 단위로 분리하는 정규식 함수"""
    chunks = []
    if not raw_content: return chunks
    
    pattern = re.compile(r"^(제\d+(?:조의\d+)?)(?:\(([^)]+)\))?\s*(.*?)(?=^제\d+(?:조의\d+)?|\Z)", re.MULTILINE | re.DOTALL)
    for match in pattern.finditer(raw_content):
        article_no = match.group(1).strip()
        article_title = match.group(2).strip() if match.group(2) else ""
        article_text = match.group(3).strip()
        title_part = f"({article_title})" if article_title else ""
        chunks.append({
            "articleNo": article_no,
            "articleTitle": article_title,
            "text": f"{article_no}{title_part} {article_text}"
        })
    return chunks

# ==========================================
# 2. 메인 실행 파이프라인 (전체 데이터 순회)
# ==========================================
def run_full_embedding_pipeline():
    conn = None
    try:
        # 1. ChromaDB 초기화 세팅
        chroma_collection = reset_and_setup_chroma()
        
        # 2. PostgreSQL 연결
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        print("🧹 [2/3] PostgreSQL의 chunked 상태를 모두 초기화합니다...")
        cursor.execute("UPDATE public.law_documents SET chunked = false;")
        conn.commit()

        print("🔍 [3/3] 전체 법령 데이터를 가져와 임베딩을 시작합니다...")
        cursor.execute("""
            SELECT id, reference_id, title, short_name, department, 
                   enforce_date, revision_type, url, raw_content 
            FROM public.law_documents 
            WHERE chunked = false 
            ORDER BY id ASC;
        """)
        
        rows = cursor.fetchall()
        total_laws = len(rows)
        
        if total_laws == 0:
            print("데이터베이스에 처리할 법령이 없습니다.")
            return

        print(f"🎯 총 {total_laws}개의 법령을 순차적으로 처리합니다.\n")

        success_count = 0
        fail_count = 0

        # 3. 전체 데이터 For Loop 돌며 임베딩 & 적재
        for idx, row in enumerate(rows, 1):
            row_id, reference_id, title, short_name, department, enforce_date, revision_type, url, raw_content = row
            
            try:
                articles = parse_articles(raw_content)
                if not articles:
                    print(f"[{idx}/{total_laws}] ⚠️ 건너뜀: {title} (조문 파싱 실패 또는 본문 없음)")
                    fail_count += 1
                    continue

                ids, documents, metadatas = [], [], []
                
                # ChromaDB 스키마 구조에 완벽히 맞춤
                for article in articles:
                    ids.append(f"law_{reference_id}_{article['articleNo']}")
                    documents.append(article['text'])
                    metadatas.append({
                        "rowId": row_id,                    # 핵심 연결 고리 (PostgreSQL PK)
                        "sourceType": "LAW",
                        "title": title,
                        "shortName": short_name or "",
                        "articleNo": article['articleNo'],
                        "articleTitle": article['articleTitle'],
                        "department": department or "",
                        "enforceDate": enforce_date or "",
                        "revisionType": revision_type or "",
                        "url": url or ""
                    })
                
                # 벡터로 변환하여 ChromaDB에 적재
                chroma_collection.upsert(
                    ids=ids,
                    documents=documents,
                    metadatas=metadatas
                )

                # 성공 시 해당 법령의 chunked 상태 업데이트
                cursor.execute("""
                    UPDATE public.law_documents 
                    SET chunked = true, updated_at = NOW() 
                    WHERE id = %s;
                """, (row_id,))
                conn.commit()

                success_count += 1
                
                # 진행 상황 출력 (너무 길어지는 것을 방지하기 위해 10단위 또는 한 줄로 간단히 출력)
                print(f"[{idx}/{total_laws}] ✅ 완료: {title} ({len(articles)}개 조문)")

            except Exception as e:
                conn.rollback() # 해당 건에서 에러 나면 롤백하고 다음으로 넘어감
                fail_count += 1
                print(f"[{idx}/{total_laws}] ❌ 실패: {title} - 사유: {e}")

        print("\n🎉 전체 데이터 임베딩 및 적재가 종료되었습니다!")
        print(f"  - 성공: {success_count}건")
        print(f"  - 실패(또는 조문없음): {fail_count}건")

    except Exception as e:
        print(f"❌ 파이프라인 실행 중 치명적 오류 발생: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    run_full_embedding_pipeline()