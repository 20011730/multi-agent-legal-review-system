
# pip install requests chromadb psycopg2-binary

import requests
import psycopg2
import chromadb
from chromadb.utils import embedding_functions
import time

# ==========================================
# 1. 스타트업 8대 카테고리별 핵심 법령 매핑 
# 타겟 카테고리 및 핵심 법령 맵핑 (8개 분야)
# 1) https://www.k-startup.go.kr/web/contents/webACTSUPT_LOCAL_FAQ.do 국내 주요 상담 FAQ 분야에서 따옴
# 2) https://www.k-startup.go.kr/onestop 스타트업 원스톱 지원센터에서 법률(국내) 8개 카테고리.
# ==========================================

STARTUP_LAWS = {
    "계약_거래": ["민법", "상법", "약관의 규제에 관한 법률", "하도급거래 공정화에 관한 법률"],
    "지식재산_브랜드": ["특허법", "상표법", "디자인보호법", "저작권법", "부정경쟁방지 및 영업비밀보호에 관한 법률"],
    "개인정보_데이터": ["개인정보 보호법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률", "위치정보의 보호 및 이용 등에 관한 법률", "신용정보의 이용 및 보호에 관한 법률"],
    "규제_인허가_대응": ["독점규제 및 공정거래에 관한 법률", "전기통신사업법", "전자상거래 등에서의 소비자보호에 관한 법률"],
    "인사_노무": ["근로기준법", "최저임금법", "근로자퇴직급여 보장법", "남녀고용평등과 일·가정 양립 지원에 관한 법률"],
    "투자_자금조달": ["벤처투자 촉진에 관한 법률", "자본시장과 금융투자업에 관한 법률", "외국인투자 촉진법"],
    "기업운영_법무": ["중소기업창업 지원법", "벤처기업육성에 관한 특별조치법"],
    "사업정리_재도전": ["채무자 회생 및 파산에 관한 법률"]
}

# ==========================================
# 2. 환경 설정 및 DB 연결
# ==========================================
API_KEY = "hyejin" # 발급받은 API 키 입력

# PostgreSQL 연결 (지식 그래프 노드/엣지 저장용)
conn = psycopg2.connect(dbname="legal_graph", user="postgres", password="password", host="localhost")
cur = conn.cursor()

# PostgreSQL 테이블 생성 (카테고리 컬럼 추가)
cur.execute("""
    CREATE TABLE IF NOT EXISTS nodes (
        node_id VARCHAR(100) PRIMARY KEY, 
        category VARCHAR(50),            -- 8대 카테고리
        type VARCHAR(20),                -- LAW, DECREE, PRECEDENT
        law_name VARCHAR(100),           -- 소속 법령명 (예: 근로기준법)
        title VARCHAR(255),              -- 조문 제목
        content TEXT                     -- 조문 본문
    );
    CREATE TABLE IF NOT EXISTS edges (
        source_id VARCHAR(100),
        target_id VARCHAR(100),
        relation_type VARCHAR(50),       
        PRIMARY KEY (source_id, target_id)
    );
""")
conn.commit()

# Chroma DB 연결 (벡터 검색용)
chroma_client = chromadb.PersistentClient(path="./chroma_legal_db")
# 파인튜닝 legal-e5 
# 파인튜닝된 임베딩 모델 로드
TUNED_MODEL_PATH = "./legal-e5-finetuned"
ef = HuggingFaceEmbeddings(
    model_name=TUNED_MODEL_PATH,
    model_kwargs={"tokenizer_kwargs": {"fix_mistral_regex": True}}
)
#ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="your-finetuned-legal-e5-model")
collection = chroma_client.get_or_create_collection(name="startup_legal_kb", embedding_function=ef)


# ==========================================
# 3. 데이터 수집 및 적재 함수
# ==========================================
def chunk_text(text, max_length=300, overlap=50):
    """긴 조문을 모델 제한에 맞게 자르는 간단한 오버랩 청킹 함수"""
    chunks = []
    start = 0
    while start < len(text):
        end = start + max_length
        chunks.append(text[start:end])
        start += (max_length - overlap)
    return chunks

def fetch_and_store_law_details(law_name, category):
    """특정 법령을 조회하여 DB에 적재하는 메인 로직"""
    
    # [주의] 아래는 실제 API 응답 구조에 맞춰 파싱 로직을 직접 구현해야 하는 부분입니다.
    # API 공식 문서의 JSON 구조(조문, 항, 호)를 순회하며 데이터를 추출해야 합니다.
    
    # 1. 법령 ID 검색 (가상 데이터)
    law_id = f"LAW_{law_name}" 
    
    # 2. 본문 및 하위 법령/판례 연관 데이터 추출 (가상 데이터)
    # 실제로는 '지능형 법령정보지식베이스 API' 등을 혼합하여 호출
    articles = [
        {"id": f"{law_id}_제1조", "title": f"{law_name} 제1조(목적)", "content": "이 법의 목적은...", "type": "LAW"},
        {"id": f"{law_id}_제2조", "title": f"{law_name} 제2조(정의)", "content": "이 법에서 사용하는 용어의 뜻은...", "type": "LAW"}
    ]
    
    relations = [
        {"source": f"{law_id}_제1조", "target": f"DECREE_{law_name}시행령_제1조", "relation": "HAS_DECREE"}
    ]

    # 3. PostgreSQL 적재 (지식 그래프 노드 및 엣지)
    for art in articles:
        cur.execute("""
            INSERT INTO nodes (node_id, category, type, law_name, title, content) 
            VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (node_id) DO NOTHING
        """, (art['id'], category, art['type'], law_name, art['title'], art['content']))
        
    for rel in relations:
        cur.execute("""
            INSERT INTO edges (source_id, target_id, relation_type) 
            VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
        """, (rel['source'], rel['target'], rel['relation']))
    conn.commit()

    # 4. Chroma DB 적재 (벡터 임베딩)
    for art in articles:
        chunks = chunk_text(art['content'])
        for i, chunk in enumerate(chunks):
            chunk_id = f"{art['id']}_chunk_{i}"
            
            # 메타데이터에 카테고리를 넣어두면 나중에 특정 분야만 필터링(Metadata Filtering)하여 검색할 때 매우 유용합니다.
            collection.upsert(
                documents=[chunk],
                metadatas=[{"category": category, "law_name": law_name, "article_id": art['id'], "type": art['type']}],
                ids=[chunk_id]
            )

# ==========================================
# 4. 일괄 적재 (Batch Ingestion) 실행
# ==========================================
if __name__ == "__main__":
    print("🚀 스타트업 법률 RAG DB 일괄 적재 시작...")
    
    total_laws = sum(len(laws) for laws in STARTUP_LAWS.values())
    processed_count = 0

    for category, laws in STARTUP_LAWS.items():
        print(f"\n--- [{category}] 카테고리 적재 중 ---")
        for law in laws:
            print(f" > '{law}' 데이터 처리 중...")
            try:
                fetch_and_store_law_details(law, category)
                processed_count += 1
                time.sleep(0.5) # API 호출 제한(Rate Limit) 방지를 위한 대기 시간
            except Exception as e:
                print(f" ❌ '{law}' 처리 중 오류 발생: {e}")
                
    print(f"\n✅ 완료! 총 {processed_count}/{total_laws}개 법령 적재 완료.")

cur.close()
conn.close()