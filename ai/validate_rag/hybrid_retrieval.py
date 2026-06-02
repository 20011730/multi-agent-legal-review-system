
"""
하이브리드 검색 모듈 (BM25 희소검색 + E5 밀집검색)  — 판례·법령 공용 ver2
이 파일 import해서 eval_statue_retrieve.py / 3-1.판례평가(ver2).py 에 사용
=====================================================================
질의(query)에 대해 두 검색기의 결과를 결합해 후보를 만든다.
  - 희소(Sparse) : BM25. 한국어는 Kiwi 형태소 분석으로 토큰화(법령명·전문용어·
                   사건번호 등 "정확 일치" 신호에 강함). 대용량(수백만 청크)을 위해
                   sparse 행렬 기반의 bm25s 라이브러리 사용.
  - 밀집(Dense)  : 기존 ChromaDB(E5, 코사인) 그대로. 의미적 유사성에 강함.
  - 융합(Fusion) : RRF(Reciprocal Rank Fusion, 기본) 또는 선형결합(논문식) 선택.

설계 의도
--------
- 두 검색기는 "서로 다른 후보"를 가져온다(겹치지 않을 수 있음). 따라서 두 결과의
  **합집합(union)**에 대해 점수를 매겨 재정렬한다. 한쪽에만 잡힌 청크는 반대쪽
  점수를 0(또는 최저)으로 본다.
- 융합 결과는 "청크 순위 리스트"이며, 판례/법령 각 평가 코드가 기존 방식대로
  청크→판례(db_id) 또는 청크→조문(metadata)으로 dedup하면 된다.
- BM25 인덱스(특히 Kiwi 토큰화)는 비용이 크므로, 토큰화 결과를 디스크에 캐싱해
  재실행 시 토큰화를 건너뛴다.

융합 방식 비교
------------
- RRF        : 점수 크기를 안 쓰고 "순위"만 사용 → 스케일/정규화 문제에 강하고
               튜닝 파라미터가 사실상 없음. 기본값으로 권장.
- 선형결합   : norm(BM25)=Min-Max, norm(E5)=(cos+1)/2 로 [0,1] 정규화 후
               α·BM25 + (1-α)·E5. 논문 재현용. α는 별도 튜닝셋에서 정할 것(누수 주의).

설치: pip install bm25s kiwipiepy
참고: Robertson & Zaragoza(2009) BM25; Cormack et al.(2009) RRF.
"""

"""
하이브리드 검색 모듈 (BM25 희소검색 + E5 밀집검색)  — 판례·법령 공용
=====================================================================
질의(query)에 대해 두 검색기의 결과를 결합해 후보를 만든다.
  - 희소(Sparse) : BM25. 한국어는 Kiwi 형태소 분석으로 토큰화(법령명·전문용어·
                   사건번호 등 "정확 일치" 신호에 강함). 대용량(수백만 청크)을 위해
                   sparse 행렬 기반의 bm25s 라이브러리 사용.
  - 밀집(Dense)  : 기존 ChromaDB(E5, 코사인) 그대로. 의미적 유사성에 강함.
  - 융합(Fusion) : RRF(Reciprocal Rank Fusion, 기본) 또는 선형결합(논문식) 선택.

설계 의도
--------
- 두 검색기는 "서로 다른 후보"를 가져온다(겹치지 않을 수 있음). 따라서 두 결과의
  **합집합(union)**에 대해 점수를 매겨 재정렬한다. 한쪽에만 잡힌 청크는 반대쪽
  점수를 0(또는 최저)으로 본다.
- 융합 결과는 "청크 순위 리스트"이며, 판례/법령 각 평가 코드가 기존 방식대로
  청크→판례(db_id) 또는 청크→조문(metadata)으로 dedup하면 된다.
- BM25 인덱스(특히 Kiwi 토큰화)는 비용이 크므로, 토큰화 결과를 디스크에 캐싱해
  재실행 시 토큰화를 건너뛴다.

융합 방식 비교
------------
- RRF        : 점수 크기를 안 쓰고 "순위"만 사용 → 스케일/정규화 문제에 강하고
               튜닝 파라미터가 사실상 없음. 기본값으로 권장.
- 선형결합   : norm(BM25)=Min-Max, norm(E5)=(cos+1)/2 로 [0,1] 정규화 후
               α·BM25 + (1-α)·E5. 논문 재현용. α는 별도 튜닝셋에서 정할 것(누수 주의).

설치: pip install bm25s kiwipiepy
참고: Robertson & Zaragoza(2009) BM25; Cormack et al.(2009) RRF.
"""


import os
import pickle
import logging
from collections import defaultdict

import numpy as np
import bm25s
from kiwipiepy import Kiwi

log = logging.getLogger("hybrid")

# ─────────────────────────────────────────────────────────────────────────────
# 한국어 토큰화 (Kiwi)
# ─────────────────────────────────────────────────────────────────────────────
# BM25에 의미 없는 조사/어미/기호는 빼고, 내용어(명사·동사·형용사·외국어·숫자·
# 어근)만 남긴다. 법령명·조문번호의 숫자/외국어(SN/SL)도 검색 신호이므로 유지.
_KEEP_TAG_PREFIX = ("N", "V", "XR")            # 명사/동사·형용사/어근
_KEEP_TAG_EXACT  = ("SL", "SN", "SH")          # 외국어/숫자/한자

class KiwiTokenizer:
    def __init__(self):
        self.kiwi = Kiwi()

    def __call__(self, text: str) -> list[str]:
        if not text:
            return []
        out = []
        for tk in self.kiwi.tokenize(text):
            if tk.tag[0] in _KEEP_TAG_PREFIX or tk.tag in _KEEP_TAG_EXACT:
                out.append(tk.form)
        return out

    def batch(self, texts: list[str]) -> list[list[str]]:
        return [self(t) for t in texts]

# ─────────────────────────────────────────────────────────────────────────────
# 하이브리드 검색기
# ─────────────────────────────────────────────────────────────────────────────
class HybridRetriever:
    """
    Chroma 컬렉션 하나를 받아 BM25 인덱스를 구축하고, 질의마다
    BM25 + Dense 결과를 융합해 상위 청크를 반환한다.

    Parameters
    ----------
    collection   : chromadb 컬렉션 (E5, hnsw:space="cosine"로 구축된 것)
    cache_path   : BM25 토큰/메타 캐시 경로(.pkl). 있으면 로드, 없으면 만들고 저장.
    n_dense, n_sparse : 각 검색기에서 가져올 후보 수(융합 전).
    fusion       : "rrf" | "linear"
    alpha        : 선형결합 가중치(α·BM25 + (1-α)·Dense). fusion="linear"일 때만.
    rrf_k        : RRF 상수(보통 60).
    """
    def __init__(self, collection, cache_path: str | None = None,
                 n_dense: int = 200, n_sparse: int = 200,
                 fusion: str = "rrf", alpha: float = 0.5, rrf_k: int = 60,
                 build_batch: int = 10_000, text_field: str | None = None):
        # text_field: None이면 Chroma의 documents에서 본문을 읽음.
        #             문자열이면 metadata[text_field]에서 본문을 읽음
        #             (판례 corpus처럼 documents가 비어있고 본문이 메타에 있을 때 사용).
        self.collection = collection
        self.text_field = text_field
        self.n_dense = n_dense
        self.n_sparse = n_sparse
        self.fusion = fusion
        self.alpha = alpha
        self.rrf_k = rrf_k
        self.tok = KiwiTokenizer()

        # 1) 캐시가 있으면 토큰/ids/메타를 로드, 없으면 Chroma에서 끌어와 토큰화 후 저장
        if cache_path and os.path.exists(cache_path):
            log.info("BM25 캐시 로드: %s", cache_path)
            with open(cache_path, "rb") as f:
                blob = pickle.load(f)
            self.ids       = blob["ids"]
            self.metadatas = blob["metadatas"]
            corpus_tokens  = blob["tokens"]
        else:
            self.ids, self.metadatas, docs = self._pull_corpus(build_batch)
            log.info("Kiwi 토큰화 시작 (%s개 청크) — 시간이 걸릴 수 있음 ...", f"{len(docs):,}")
            corpus_tokens = self.tok.batch(docs)
            # 빈 코퍼스 가드: 본문이 전혀 없으면(=토큰 0) BM25를 만들 수 없음
            n_nonempty = sum(1 for t in corpus_tokens if t)
            if n_nonempty == 0:
                raise ValueError(
                    "코퍼스 본문이 비어 있어 BM25 인덱스를 만들 수 없습니다.\n"
                    "  → Chroma의 documents가 비어있는 컬렉션입니다(판례 corpus 등).\n"
                    "  → 본문이 metadata에 있으면 HybridRetriever(..., text_field='필드명')으로 지정,\n"
                    "     metadata에도 없으면 본문을 다른 소스(PostgreSQL 등)에서 가져와야 합니다.")
            log.info("  비어있지 않은 문서: %s / %s", f"{n_nonempty:,}", f"{len(docs):,}")
            if cache_path:
                with open(cache_path, "wb") as f:
                    pickle.dump({"ids": self.ids, "metadatas": self.metadatas,
                                 "tokens": corpus_tokens}, f)
                log.info("BM25 캐시 저장: %s", cache_path)

        # 청크id → (행 인덱스, 메타) 빠른 조회용
        self.id2meta = {cid: md for cid, md in zip(self.ids, self.metadatas)}

        # 2) BM25 인덱스 구축 (토큰화는 끝났으므로 빠름)
        log.info("BM25 인덱스 구축 ...")
        self.bm25 = bm25s.BM25()
        self.bm25.index(corpus_tokens)
        log.info("하이브리드 검색기 준비 완료. 청크=%s", f"{len(self.ids):,}")

    # ── Chroma에서 전체 청크(id/문서/메타) 페이지 단위로 끌어오기 ──────────────
    def _pull_corpus(self, page: int):
        total = self.collection.count()
        ids, metas, docs = [], [], []
        off = 0
        while off < total:
            got = self.collection.get(include=["documents", "metadatas"],
                                       limit=page, offset=off)
            batch_ids = got["ids"] or []
            batch_metas = got["metadatas"] or [{}] * len(batch_ids)
            ids.extend(batch_ids)
            metas.extend(batch_metas)
            # 본문 출처: text_field가 None이면 documents, 아니면 metadata[text_field]
            if self.text_field is None:
                page_docs = got["documents"] or [None] * len(batch_ids)
            else:
                page_docs = [(m or {}).get(self.text_field, "") for m in batch_metas]
            docs.extend([d if d else "" for d in page_docs])
            off += page
            log.info("  corpus 적재 %s/%s", f"{min(off,total):,}", f"{total:,}")
            if not batch_ids:
                break
        return ids, metas, docs

    # ── 융합: RRF (순위 기반) ──────────────────────────────────────────────
    def _fuse_rrf(self, dense_ids, sparse_ids, top_k):
        score = defaultdict(float)
        for rank, cid in enumerate(dense_ids, 1):
            score[cid] += 1.0 / (self.rrf_k + rank)
        for rank, cid in enumerate(sparse_ids, 1):
            score[cid] += 1.0 / (self.rrf_k + rank)
        return sorted(score, key=score.get, reverse=True)[:top_k]

    # ── 융합: 선형결합 (점수 정규화 기반, 논문식) ─────────────────────────────
    def _fuse_linear(self, dense_sims: dict, sparse_scores: dict, top_k):
        # Dense: 코사인 [-1,1] → (cos+1)/2 로 [0,1]
        nd = {cid: (s + 1.0) / 2.0 for cid, s in dense_sims.items()}
        # Sparse: 후보군 내 Min-Max 정규화 → [0,1]
        if sparse_scores:
            vals = np.array(list(sparse_scores.values()), float)
            lo, hi = vals.min(), vals.max()
            rng = (hi - lo) or 1.0
            nb = {cid: (s - lo) / rng for cid, s in sparse_scores.items()}
        else:
            nb = {}
        union = set(nd) | set(nb)
        score = {cid: self.alpha * nb.get(cid, 0.0)
                      + (1 - self.alpha) * nd.get(cid, 0.0) for cid in union}
        return sorted(score, key=score.get, reverse=True)[:top_k]

    # ── 검색: 질의 배치 → 각 질의별 융합 상위 청크 [(chunk_id, metadata)] ──────
    def search(self, query_texts: list[str], query_embeddings: np.ndarray,
               top_k: int = 100):
        n = len(query_texts)

        # (a) Dense — Chroma 배치 질의. 코사인 거리(distance) → 유사도 = 1 - distance
        dres = self.collection.query(query_embeddings=query_embeddings.tolist(),
                                     n_results=self.n_dense,
                                     include=["distances"])
        dense_ids_all  = dres["ids"]                       # List[List[str]]
        dense_dist_all = dres["distances"]

        # (b) Sparse — Kiwi 토큰화 후 bm25s 배치 검색
        q_tokens = self.tok.batch(query_texts)
        s_idx_all, s_score_all = self.bm25.retrieve(q_tokens, k=self.n_sparse)

        # (c) 질의별 융합
        results = []
        for i in range(n):
            d_ids  = dense_ids_all[i]
            d_sims = [1.0 - d for d in dense_dist_all[i]]    # 코사인 유사도
            s_ids  = [self.ids[int(j)] for j in s_idx_all[i]]
            s_sc   = [float(x) for x in s_score_all[i]]

            if self.fusion == "linear":
                fused = self._fuse_linear(dict(zip(d_ids, d_sims)),
                                          dict(zip(s_ids, s_sc)), top_k)
            else:  # "rrf"
                fused = self._fuse_rrf(d_ids, s_ids, top_k)

            results.append([(cid, self.id2meta.get(cid, {})) for cid in fused])
        return results


# ─────────────────────────────────────────────────────────────────────────────
# 판례 전용: case-level 하이브리드
#   판례 corpus는 본문이 Chroma에 없고 PostgreSQL(case_documents.rawcontent)에 있다.
#   정답도 판례(db_id=corpus_id) 단위이므로 BM25는 '판례 1건 = 문서 1개'로 색인한다.
#     - BM25  : PG에서 (id, 본문) → Kiwi 토큰화 → 색인. 검색 시 case_id 순위 반환.
#     - Dense : Chroma 청크 검색 → 청크→판례 dedup → case_id 순위.
#     - 융합  : RRF(기본) 또는 linear → 최종 case_id 순위.
# ─────────────────────────────────────────────────────────────────────────────
class CaseHybridRetriever:
    def __init__(self, collection, pg_config, table: str = "case_documents",
                 id_column: str = "id", text_column: str = "rawcontent",
                 cache_path: str | None = None,
                 n_dense: int = 500, n_sparse: int = 500,
                 fusion: str = "rrf", alpha: float = 0.5, rrf_k: int = 60,
                 top_k_chunks: int = 500):
        self.collection = collection
        self.n_dense, self.n_sparse = n_dense, n_sparse
        self.fusion, self.alpha, self.rrf_k = fusion, alpha, rrf_k
        self.top_k_chunks = top_k_chunks
        self.tok = KiwiTokenizer()

        # 1) BM25 코퍼스: PG에서 (case_id, 본문) 적재 → 토큰화(캐시)
        if cache_path and os.path.exists(cache_path):
            log.info("판례 BM25 캐시 로드: %s", cache_path)
            with open(cache_path, "rb") as f:
                blob = pickle.load(f)
            self.case_ids = blob["case_ids"]
            corpus_tokens = blob["tokens"]
        else:
            self.case_ids, texts = self._pull_cases(pg_config, table, id_column, text_column)
            log.info("Kiwi 토큰화 (판례 %s건) ...", f"{len(texts):,}")
            corpus_tokens = self.tok.batch(texts)
            n_nonempty = sum(1 for t in corpus_tokens if t)
            if n_nonempty == 0:
                raise ValueError(f"{table}.{text_column} 본문이 비어 있습니다. "
                                 f"text_column 이름을 확인하세요.")
            log.info("  비어있지 않은 판례: %s / %s", f"{n_nonempty:,}", f"{len(texts):,}")
            if cache_path:
                with open(cache_path, "wb") as f:
                    pickle.dump({"case_ids": self.case_ids, "tokens": corpus_tokens}, f)
                log.info("판례 BM25 캐시 저장: %s", cache_path)

        # 2) BM25 색인
        log.info("판례 BM25 색인 ...")
        self.bm25 = bm25s.BM25()
        self.bm25.index(corpus_tokens)
        log.info("판례 하이브리드 준비 완료. 판례=%s", f"{len(self.case_ids):,}")

    def _pull_cases(self, pg_config, table, id_col, text_col):
        import psycopg2
        conn = psycopg2.connect(**pg_config); cur = conn.cursor()
        cur.execute(f"SELECT {id_col}, {text_col} FROM {table} "
                    f"WHERE {text_col} IS NOT NULL ORDER BY {id_col}")
        rows = cur.fetchall(); cur.close(); conn.close()
        return [int(r[0]) for r in rows], [r[1] or "" for r in rows]

    # ── 융합 ──────────────────────────────────────────────────────────────
    def _fuse_rrf(self, dense_ids, sparse_ids, top_k):
        score = defaultdict(float)
        for rank, c in enumerate(dense_ids, 1):
            score[c] += 1.0 / (self.rrf_k + rank)
        for rank, c in enumerate(sparse_ids, 1):
            score[c] += 1.0 / (self.rrf_k + rank)
        return sorted(score, key=score.get, reverse=True)[:top_k]

    def _fuse_linear(self, dense_sim: dict, sparse_score: dict, top_k):
        nd = {c: (s + 1.0) / 2.0 for c, s in dense_sim.items()}     # 코사인 → [0,1]
        if sparse_score:
            vals = np.array(list(sparse_score.values()), float)
            lo, hi = vals.min(), vals.max(); rng = (hi - lo) or 1.0
            nb = {c: (s - lo) / rng for c, s in sparse_score.items()}
        else:
            nb = {}
        union = set(nd) | set(nb)
        score = {c: self.alpha * nb.get(c, 0.0) + (1 - self.alpha) * nd.get(c, 0.0)
                 for c in union}
        return sorted(score, key=score.get, reverse=True)[:top_k]

    # ── 검색: 질의 배치 → 각 질의별 융합된 case_id 순위 리스트 ──────────────────
    def search(self, query_texts, query_embeddings, top_k_cases: int = 100):
        n = len(query_texts)
        # Dense: Chroma 청크 검색 (코사인 거리 → 유사도)
        dres = self.collection.query(query_embeddings=query_embeddings.tolist(),
                                     n_results=self.top_k_chunks, include=["distances"])
        # Sparse: BM25 (case_id 직접 반환)
        q_tokens = self.tok.batch(query_texts)
        s_idx, s_sc = self.bm25.retrieve(q_tokens, k=self.n_sparse)

        out = []
        for i in range(n):
            # 청크 → 판례 dedup (첫 등장 순위 보존) + 판례별 dense 점수(최대 유사도)
            seen, d_rank, d_sim = set(), [], {}
            for chunk_id, dist in zip(dres["ids"][i], dres["distances"][i]):
                try:
                    cid = int(str(chunk_id).split("_")[0])
                except ValueError:
                    continue
                sim = 1.0 - dist
                if cid not in seen:
                    seen.add(cid); d_rank.append(cid)
                d_sim[cid] = max(d_sim.get(cid, -1.0), sim)
            s_rank  = [self.case_ids[int(j)] for j in s_idx[i]]
            s_score = {self.case_ids[int(j)]: float(x) for j, x in zip(s_idx[i], s_sc[i])}
            if self.fusion == "linear":
                fused = self._fuse_linear(d_sim, s_score, top_k_cases)
            else:
                fused = self._fuse_rrf(d_rank, s_rank, top_k_cases)
            out.append(fused)
        return out