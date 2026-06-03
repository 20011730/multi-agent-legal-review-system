"""
국세청 심판례 하이브리드 검색기 (Vector 0.8 + BM25 0.2)
- 팀원 연동용 모듈 (에이전트/백엔드에서 호출 가능)
"""

import os
import pickle
from pathlib import Path
from typing import List, Dict

# 💡 ChromaDB 라이브러리 추가
import chromadb
from chromadb.config import Settings

# 💡 BM25 검색 라이브러리 추가 (pip install rank_bm25 필요)
from rank_bm25 import BM25Okapi

# 💡 임베딩 모델 로드
from sentence_transformers import SentenceTransformer

# ==============================================================================
# 경로 설정 (대장의 로컬 파일 구조에 맞춤)
# ==============================================================================
# 현재 파일 위치를 기준으로 3칸 위로 올라가면 프로젝트 루트 디렉토리가 됨
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"

from pathlib import Path

# ==============================================================================
# DB 및 피클 파일 경로 설정 (윈도우 역슬래시 에러 방지를 위해 r"" 사용)
# ==============================================================================
CHROMA_DB_PATH = Path(r"C:\Users\olivi\Desktop\LexRexAI\data\tax_db_export\chroma_tax_db")
BM25_INDEX_PATH = Path(r"C:\Users\olivi\Desktop\LexRexAI\data\tax_db_export\bm25_index.pkl")
CHUNK_META_PATH = Path(r"C:\Users\olivi\Desktop\LexRexAI\data\tax_db_export\chunk_meta.pkl")
# ==============================================================================
# 하이브리드 리트리버 클래스
# ==============================================================================
class TaxHybridRetriever:
    def __init__(self, alpha: float = 0.8):
        """
        검색기 초기화
        :param alpha: 하이브리드 검색 가중치 (Vector의 비중, 기본값 0.8)
        """
        self.alpha = alpha
        self.chroma_client = None
        self.collection = None
        self.bm25 = None
        self.chunk_ids = None
        self.embedding_model = None

        print("🚀 [TaxHybridRetriever] 초기화 시작...")
        self._load_components()
        print("✅ [TaxHybridRetriever] 초기화 완료!")

    def _load_components(self):
        """DB, 인덱스, 임베딩 모델을 메모리에 로드"""
        # 1. ChromaDB 로드
        if not CHROMA_DB_PATH.exists():
            raise FileNotFoundError(f"ChromaDB 폴더를 찾을 수 없습니다: {CHROMA_DB_PATH}")
            
        self.chroma_client = chromadb.PersistentClient(
            path=str(CHROMA_DB_PATH),
            settings=Settings(anonymized_telemetry=False)
        )
        self.collection = self.chroma_client.get_collection(name="tax_precedents")
        print("   - ChromaDB 로드 완료")

        # 2. BM25 인덱스 로드
        if not BM25_INDEX_PATH.exists() or not CHUNK_META_PATH.exists():
             raise FileNotFoundError("BM25 피클 파일을 찾을 수 없습니다. (경로 확인 필요)")

        with open(BM25_INDEX_PATH, 'rb') as f:
            self.bm25 = pickle.load(f)
        with open(CHUNK_META_PATH, 'rb') as f:
            self.chunk_ids = pickle.load(f)
        print("   - BM25 인덱스 로드 완료")

        # 3. 임베딩 모델 로드 (HuggingFace 다국어 모델)
        self.embedding_model = SentenceTransformer('intfloat/multilingual-e5-base')
        print("   - 임베딩 모델 로드 완료")


    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        하이브리드 검색 수행
        :param query: 사용자 질문 또는 검색어
        :param top_k: 반환할 결과 개수
        :return: 검색 결과 리스트 (메타데이터와 본문 포함)
        """
        # 1. Vector 검색 (ChromaDB)
        query_embedding = self.embedding_model.encode([query])[0].tolist()
        # 하이브리드를 위해 넉넉하게 후보를 가져옴
        vector_results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k * 5
        )
        
        # 2. BM25 키워드 검색
        tokenized_query = query.split()
        bm25_scores = self.bm25.get_scores(tokenized_query)

        # 3. 하이브리드 스코어 계산 (Min-Max 정규화 적용)
        combined_results = []
        
        # Vector 결과 정규화 및 수집
        if vector_results['ids'][0]:
            v_distances = vector_results['distances'][0]
            v_max = max(v_distances) if v_distances else 1.0
            v_min = min(v_distances) if v_distances else 0.0

            for i, chunk_id in enumerate(vector_results['ids'][0]):
                # ChromaDB의 거리는 작을수록 좋으므로 유사도로 변환
                dist = v_distances[i]
                v_score = 1 - ((dist - v_min) / (v_max - v_min + 1e-9)) 
                
                # 해당 청크의 BM25 스코어 찾기
                bm25_score = 0
                if chunk_id in self.chunk_ids:
                    idx = self.chunk_ids.index(chunk_id)
                    bm25_score = bm25_scores[idx]
                
                # 8:2 비율로 최종 스코어 합산
                final_score = (self.alpha * v_score) + ((1 - self.alpha) * bm25_score)
                
                combined_results.append({
                    "id": chunk_id,
                    "score": final_score,
                    "content": vector_results['documents'][0][i],
                    "metadata": vector_results['metadatas'][0][i]
                })

        # 4. 점수순으로 정렬하여 상위 k개만 반환
        combined_results.sort(key=lambda x: x["score"], reverse=True)
        return combined_results[:top_k]

# ==============================================================================
# 테스트용 코드 (직접 실행 시에만 작동)
# ==============================================================================
if __name__ == "__main__":
    # 리트리버 객체 생성
    retriever = TaxHybridRetriever()
    
    # 테스트 질문
    test_query = "스톡옵션 행사 시 발생하는 세금 문제는?"
    print(f"\n🔍 질문: {test_query}")
    
    # 검색 실행
    results = retriever.search(query=test_query, top_k=3)
    
    # 결과 출력
    for i, res in enumerate(results):
        print(f"\n[{i+1}] 점수: {res['score']:.4f}")
        print(f"사건번호: {res['metadata'].get('doc_number', '알수없음')}")
        print(f"내용: {res['content'][:200]}...")
