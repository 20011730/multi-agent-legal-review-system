import os
import psycopg2
import chromadb
import re
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
from sentence_transformers import SentenceTransformer

# ==========================================
# 1. 설정 및 커스텀 임베딩 함수 (E5 로컬 모델)
# ==========================================
# DB / Chroma / E5 모델 이름은 환경변수로 분리 (config.py가 .env 자동 로드)
from config import (  # noqa: F401
    DB_CONFIG,
    CHROMA_CLIENT_MODE,
    CHROMA_DB_DIR,
    CHROMA_HOST,
    CHROMA_PORT,
    CHROMA_COLLECTION,
    E5_MODEL_NAME,
    EMBEDDING_DIMENSION,
    describe_chroma_target,
)

# ──────────────────────────────────────────────────────────────
# ChromaDB chunk ID 생성 규칙 (duplicate ID 방지)
#   포맷: law_{reference_id}_{article_no_normalized}_{occurrence:04d}
#   - article_no_normalized: 공백/슬래시/특수문자 → '_' 치환, 비어있으면 'unknown'
#   - occurrence: 같은 (reference_id, article_no) 조합 내 0-based 등장 순서
#     (본칙/부칙에서 같은 "제1조"가 여러 번 등장해도 충돌 방지)
# ──────────────────────────────────────────────────────────────
_ARTICLE_NO_SAFE_RE = re.compile(r"[^0-9A-Za-z가-힣]+")


def _normalize_article_no(article_no: str) -> str:
    """ChromaDB id에 안전하게 쓸 수 있도록 article_no를 정규화.

    - None 또는 공백 → 'unknown'
    - 공백/슬래시/특수문자 → '_'
    - 연속된 '_' 는 하나로 축약
    - 양끝 '_' 제거
    """
    if not article_no:
        return "unknown"
    s = _ARTICLE_NO_SAFE_RE.sub("_", str(article_no))
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "unknown"

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

def _build_chroma_client():
    """CHROMA_CLIENT_MODE 환경변수에 따라 local PersistentClient 또는 HttpClient 생성.

    - "local" (기본): chromadb.PersistentClient(path=CHROMA_DB_DIR)
                      ./chroma_data 파일 저장소 — backend가 사용하는 Docker ChromaDB와 분리
    - "http"        : chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
                      Docker ChromaDB (보통 localhost:8000)에 직접 적재
                      → 운영 데이터에 영향이 가는 모드이므로 반드시 명시적으로 설정해야 함

    Returns:
        chromadb client 인스턴스
    """
    mode = CHROMA_CLIENT_MODE
    if mode == "http":
        print(f"   🌐 Chroma 모드: HTTP (host={CHROMA_HOST}, port={CHROMA_PORT})")
        return chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    elif mode == "local":
        print(f"   📁 Chroma 모드: LOCAL PersistentClient (path={CHROMA_DB_DIR})")
        return chromadb.PersistentClient(path=CHROMA_DB_DIR)
    else:
        raise RuntimeError(
            f"알 수 없는 CHROMA_CLIENT_MODE='{mode}'. 'local' 또는 'http'만 허용됩니다."
        )


def reset_and_setup_chroma():
    """ChromaDB 컬렉션을 준비합니다.

    안전 모드 (기본):
        - client는 CHROMA_CLIENT_MODE 환경변수로 결정 ('local' 기본 / 'http' opt-in)
        - collection 이름은 CHROMA_COLLECTION 환경변수 ('laws_e5' 기본)
          ※ backend가 사용하는 기존 'laws' (384차원, simple-hash)와 차원/임베딩이 다르므로
            반드시 다른 이름으로 적재해야 함. 기본값 'laws_e5'를 그대로 두는 것을 권장.
        - get_or_create_collection — 기존 데이터 보존, upsert 동작

    초기화 모드 (명시 opt-in):
        CHROMA_RESET_ON_START=true 일 때만 delete_collection 수행.
        ⚠️ HTTP 모드 + reset=true 조합은 Docker ChromaDB의 해당 collection을 실제로 삭제합니다.
           기존 'laws' 컬렉션을 보호하기 위해 CHROMA_COLLECTION이 'laws'이면 reset을 거부합니다.
    """
    reset_flag = os.getenv("CHROMA_RESET_ON_START", "false").lower() == "true"
    collection_name = CHROMA_COLLECTION

    print(f"🧰 [1/3] ChromaDB 컬렉션 준비 중 (target={describe_chroma_target()}, reset={reset_flag})...")

    # 안전 가드: backend가 운영 중인 'laws' 컬렉션을 실수로 reset하지 않도록 차단
    if reset_flag and collection_name == "laws":
        raise RuntimeError(
            "안전 가드: CHROMA_COLLECTION='laws'는 backend 운영 컬렉션이므로 reset을 거부합니다. "
            "E5 적재용 컬렉션은 CHROMA_COLLECTION=laws_e5 (또는 다른 이름)을 사용하세요."
        )

    chroma_client = _build_chroma_client()
    local_ef = E5EmbeddingFunction()

    if reset_flag:
        try:
            chroma_client.delete_collection(name=collection_name)
            print(f"   🗑️ 기존 '{collection_name}' 컬렉션을 삭제했습니다. (CHROMA_RESET_ON_START=true)")
        except Exception:
            print(f"   ℹ️ 삭제할 기존 '{collection_name}' 컬렉션이 없습니다.")
        collection = chroma_client.create_collection(
            name=collection_name,
            embedding_function=local_ef,
            metadata={"hnsw:space": "cosine"},
        )
    else:
        # 기존 컬렉션 유지 — upsert로 중복 ID는 덮어쓰기, 새 ID만 추가
        collection = chroma_client.get_or_create_collection(
            name=collection_name,
            embedding_function=local_ef,
            metadata={"hnsw:space": "cosine"},
        )
        print(f"   ♻️ 기존 '{collection_name}' 컬렉션을 그대로 사용합니다 (upsert 모드).")

    print(f"   📐 임베딩 차원: {EMBEDDING_DIMENSION} (모델={E5_MODEL_NAME})")
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

                # ──────────────────────────────────────────────────────
                # ChromaDB chunk ID는 한 row(법령) 내부에서도 본칙/부칙
                # 등으로 같은 articleNo("제1조")가 반복될 수 있으므로
                # (reference_id, article_no) 조합별 occurrence 카운터로
                # 항상 유일성을 보장한다.
                # ──────────────────────────────────────────────────────
                occurrence_map: dict[tuple, int] = {}

                # ChromaDB 스키마 구조에 완벽히 맞춤
                for article in articles:
                    raw_article_no = article.get("articleNo") or ""
                    safe_article_no = _normalize_article_no(raw_article_no)
                    key = (reference_id, safe_article_no)
                    occ = occurrence_map.get(key, 0)
                    occurrence_map[key] = occ + 1

                    chunk_id = f"law_{reference_id}_{safe_article_no}_{occ:04d}"
                    ids.append(chunk_id)
                    documents.append(article['text'])
                    metadatas.append({
                        "rowId": row_id,                    # 핵심 연결 고리 (PostgreSQL PK)
                        "sourceType": "LAW",
                        "title": title,
                        "shortName": short_name or "",
                        "articleNo": raw_article_no,
                        "articleNoNormalized": safe_article_no,
                        "occurrence": occ,
                        "articleTitle": article['articleTitle'],
                        "department": department or "",
                        "enforceDate": enforce_date or "",
                        "revisionType": revision_type or "",
                        "url": url or ""
                    })

                # 안전 검사: 같은 batch(=row) 내 id 중복은 절대 없어야 함
                # ChromaDB upsert에 중복 id가 섞이면 즉시 InvalidArgumentError 발생하므로
                # 그 전에 어느 reference_id / article_no에서 충돌이 났는지 명확히 보고한다.
                if len(ids) != len(set(ids)):
                    seen, dups = set(), []
                    for cid in ids:
                        if cid in seen:
                            dups.append(cid)
                        seen.add(cid)
                    raise RuntimeError(
                        f"[BATCH DUP] reference_id={reference_id} 내 chunk ID 중복 발생. "
                        f"총 {len(ids)}건 중 unique {len(set(ids))}건. "
                        f"중복 샘플: {dups[:5]}"
                    )

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