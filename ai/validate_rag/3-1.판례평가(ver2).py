
"""
판례 검색 평가 — eval_sample + 설계가중치 + case-level 하이브리드(BM25+Dense)
============================================================================
질문 → 판례 검색 → corpus_id(=db_id, 단일정답)로 채점. 법령 평가와 동일한 표본·
가중 통계 틀 사용. USE_HYBRID로 'dense 단독' ↔ '하이브리드' 전환(논문용 A/B).

판례 corpus는 본문이 Chroma에 없으므로(임베딩+메타만 저장), BM25는 PostgreSQL
case_documents.rawcontent 를 '판례 1건=문서 1개'로 색인하는 case-level 방식이다.
  - Dense : Chroma 청크 검색 → 청크→판례 dedup
  - BM25  : PG 본문 색인 → case_id 직접 반환
  - 융합  : RRF(기본) 또는 linear → 최종 case_id 순위

- query type 비교 : summ_pass / qa_question / keyword (paired Wilcoxon)
- 지표(단일정답)  : Recall@K, MRR, nDCG@K  (K∈{1,5,10,20,50,100})

⚠️ 하이브리드 사용 시 hybrid_retrieval.py(CaseHybridRetriever) 가 import 경로에 있어야 함.
"""


"""
판례 검색 평가 — eval_sample + 설계가중치 + 하이브리드(BM25+Dense) 전환
=====================================================================
질문(query) → legal_case_chunks 검색 → corpus_id(단일 정답)로 채점.
USE_HYBRID 플래그로 'dense 단독' ↔ '하이브리드'를 전환(논문용 A/B).
법령 평가와 동일한 표본·가중 통계 틀을 사용한다.

- query type 비교 : summ_pass / qa_question / keyword (paired Wilcoxon)
- 검색            : USE_HYBRID=False → E5 dense / True → BM25(Kiwi)+Dense 융합
- 집계            : eval_sample + 설계가중치(가중 bootstrap), 카테고리별 분해
- 지표(단일정답)  : Recall@K, MRR, nDCG@K  (K∈{1,5,10,20,50,100})

⚠️ 하이브리드 사용 시 hybrid_retrieval.py 가 import 경로에 있어야 함.
"""


"""
판례(Case) 검색 평가 — eval_sample + 설계가중치 정합 버전
=========================================================
질문(query) → 판례 corpus(legal_case_chunks) 검색 → corpus_id(단일 정답)로 채점.
법령 평가(eval_statute_retrieval.py)와 "같은 표본·같은 통계 틀"을 쓰도록 정렬했다.

기존 코드 대비 수정점
--------------------
1. eval_sample(층화표본) ⨝ eval_dataset 로 로드 → 법령 평가와 동일한 2,000건 질문 사용.
   전체로 돌리려면 USE_SAMPLE=False.
2. 전체(overall) 지표는 설계가중치(weight=N_h/n_h)로 가중집계(weighted bootstrap).
   → 카테고리 불균형 편향 제거. (카테고리별 지표는 층 내부 등확률이라 단순평균=가중평균)
3. query type 소스 컬럼을 QUERY_TYPE_COLUMN으로 명시 → 'keyword' 같은 컬럼명 불일치 해결.
4. paired-complete 필터를 "활성 query type"에 맞춰 동적으로 적용(과거 case_title 하드코딩 제거).

지표(단일 정답): Recall@K, MRR, nDCG@K  (K ∈ {1,5,10,20,50,100})
유의성: query type 쌍별 Wilcoxon signed-rank(paired, 양측) — paired 차이 기반이라 비가중.
"""




import math
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
import torch
import chromadb
from sentence_transformers import SentenceTransformer
from scipy.stats import wilcoxon
from tqdm import tqdm

# ═════════════════════════════════════════════════════════════════════════════
# 1. 설정
# ═════════════════════════════════════════════════════════════════════════════
PG_CONFIG = {
    "host": "localhost", "port": 5432,
    "dbname": "legalreview", "user": "legalreview", "password": "legalreview",
}
CHROMA_DB_PATH  = "/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/generate_rag/chroma_legal_db"
COLLECTION_NAME = "legal_case_chunks"
MODEL_NAME      = "intfloat/multilingual-e5-base"

USE_SAMPLE = True

# ── 검색 방식 ───────────────────────────────────────────────────────────────
USE_HYBRID = True                 # False: dense 단독(baseline) / True: BM25(PG)+Dense
FUSION     = "rrf"                # "rrf" | "linear"
ALPHA      = 0.5
N_DENSE    = 500
N_SPARSE   = 500
BM25_CACHE = "bm25_cases.pkl"     # 판례 BM25 토큰 캐시(최초 1회, 약 12만건)

# 판례 본문 소스 (PostgreSQL)
CASE_TABLE  = "case_documents"
ID_COLUMN   = "id"                # case_documents PK = db_id = corpus_id
TEXT_COLUMN = "rawcontent"        # ← 확인된 본문 컬럼명 (다르면 여기 수정)

# 비교할 query type → 표시명
QUERY_TYPES = {
    "summ_pass":   "쟁점 요지 (Summary.summ_pass)",
    "qa_question": "법률 질문 (jdgmnInfo.question)",
    "keyword":     "주제 키워드 (keyword_tagg)",
}
QUERY_TYPE_COLUMN = {
    "summ_pass":   "summ_pass",
    "qa_question": "qa_question",
    "keyword":     "keyword",
}

K_VALUES        = [1, 5, 10, 20, 50, 100]
TOP_K_CHUNKS    = 500
TOP_K_CASES     = 100
EMBED_BATCH     = 256
RETRIEVE_BATCH  = 64

N_BOOTSTRAP     = 1000
ALPHA_CI        = 0.05
RANDOM_SEED     = 42
OUTPUT_DIR      = Path("./eval_results_case")
OUTPUT_DIR.mkdir(exist_ok=True)

# ═════════════════════════════════════════════════════════════════════════════
# 2. 데이터 로딩
# ═════════════════════════════════════════════════════════════════════════════
def _check_columns(pg_conn):
    cur = pg_conn.cursor()
    cur.execute("""SELECT column_name FROM information_schema.columns
                   WHERE table_name='eval_dataset'""")
    have = {r[0] for r in cur.fetchall()}; cur.close()
    missing = set(QUERY_TYPE_COLUMN.values()) - have
    if missing:
        raise SystemExit(f"❌ eval_dataset에 컬럼 없음: {sorted(missing)} "
                         f"→ QUERY_TYPE_COLUMN 수정 또는 해당 query type 제거.")

def load_eval(pg_conn) -> pd.DataFrame:
    qcols = ", ".join(f"d.{QUERY_TYPE_COLUMN[q]} AS {q}" for q in QUERY_TYPES)
    if USE_SAMPLE:
        sql = f"""
            SELECT s.eval_id, s.folder, s.weight, d.corpus_id, {qcols}
            FROM eval_sample s JOIN eval_dataset d ON s.eval_id = d.eval_id
            WHERE d.corpus_id IS NOT NULL
        """
    else:
        qcols2 = ", ".join(f"{QUERY_TYPE_COLUMN[q]} AS {q}" for q in QUERY_TYPES)
        sql = f"""
            SELECT eval_id, folder, 1.0::float8 AS weight, corpus_id, {qcols2}
            FROM eval_dataset WHERE corpus_id IS NOT NULL
        """
    return pd.read_sql(sql, pg_conn)

def filter_paired_complete(df: pd.DataFrame) -> pd.DataFrame:
    nonempty = lambda s: s.fillna("").astype(str).str.strip().str.len() > 0
    mask = pd.Series(True, index=df.index)
    for q in QUERY_TYPES:
        mask &= nonempty(df[q])
    return df[mask].reset_index(drop=True)

# ═════════════════════════════════════════════════════════════════════════════
# 3. 인코딩 & dense 단독 경로
# ═════════════════════════════════════════════════════════════════════════════
def encode_queries(model, queries, batch_size=EMBED_BATCH):
    embs = model.encode([f"query: {q}" for q in queries],
                        batch_size=batch_size, normalize_embeddings=True,
                        show_progress_bar=True, convert_to_numpy=True)
    return embs.astype("float32")

def dense_case_rankings(collection, query_embs):
    """dense 단독: 배치 질의 → 각 질의별 판례 순위(청크→판례 dedup)."""
    res = collection.query(query_embeddings=query_embs.tolist(),
                           n_results=TOP_K_CHUNKS, include=["metadatas"])
    out = []
    for ids in res["ids"]:
        seen, cases = set(), []
        for cid in ids:
            try:
                case_id = int(str(cid).split("_")[0])
            except ValueError:
                continue
            if case_id not in seen:
                seen.add(case_id); cases.append(case_id)
                if len(cases) >= TOP_K_CASES:
                    break
        out.append(cases)
    return out

# ═════════════════════════════════════════════════════════════════════════════
# 4. 메트릭 (단일 정답)
# ═════════════════════════════════════════════════════════════════════════════
def per_sample_metrics(ranked_cases, gold_case_id, k_values):
    try:
        rank = ranked_cases.index(int(gold_case_id)) + 1
    except (ValueError, TypeError):
        rank = None
    out = {}
    for k in k_values:
        hit = (rank is not None and rank <= k)
        out[f"recall@{k}"] = float(hit)
        out[f"ndcg@{k}"]   = (1.0 / math.log2(rank + 1)) if hit else 0.0
    out["mrr"] = (1.0 / rank) if rank is not None else 0.0
    return out

# ═════════════════════════════════════════════════════════════════════════════
# 5. 통계 (설계가중치)
# ═════════════════════════════════════════════════════════════════════════════
def weighted_bootstrap_ci(values, weights, rng, n_bootstrap=N_BOOTSTRAP, alpha=ALPHA_CI):
    v = np.asarray(values, float); w = np.asarray(weights, float)
    if v.size == 0:
        return float("nan"), float("nan"), float("nan")
    point = float(np.average(v, weights=w))
    n = len(v); means = np.empty(n_bootstrap)
    for b in range(n_bootstrap):
        idx = rng.integers(0, n, n); means[b] = np.average(v[idx], weights=w[idx])
    lo, hi = np.percentile(means, [100*alpha/2, 100*(1-alpha/2)])
    return point, float(lo), float(hi)

def paired_wilcoxon(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if not np.any((a - b) != 0):
        return float("nan"), 1.0
    stat, p = wilcoxon(a, b, zero_method="wilcox", alternative="two-sided")
    return float(stat), float(p)

# ═════════════════════════════════════════════════════════════════════════════
# 6. 표 생성
# ═════════════════════════════════════════════════════════════════════════════
def build_main_table(per_query_results, weights, rng):
    rows = []
    for qtype, samples in per_query_results.items():
        df = pd.DataFrame(samples)
        for metric in df.columns:
            mean, lo, hi = weighted_bootstrap_ci(df[metric].values, weights, rng)
            rows.append({"query_type": qtype, "metric": metric,
                         "mean": mean, "ci_lo": lo, "ci_hi": hi, "n": len(df)})
    return pd.DataFrame(rows)

def build_category_table(eval_df, per_query_results, rng):
    rows = []
    for qtype, samples in per_query_results.items():
        df = pd.DataFrame(samples).assign(folder=eval_df["folder"].values,
                                          weight=eval_df["weight"].values)
        for folder, sub in df.groupby("folder"):
            for metric in [c for c in sub.columns if c not in ("folder", "weight")]:
                mean, lo, hi = weighted_bootstrap_ci(sub[metric].values,
                                                     sub["weight"].values, rng)
                rows.append({"query_type": qtype, "folder": folder, "metric": metric,
                             "mean": mean, "ci_lo": lo, "ci_hi": hi, "n": len(sub)})
    return pd.DataFrame(rows)

def build_paired_table(per_query_results, key_metrics):
    qtypes = list(per_query_results); rows = []
    for i in range(len(qtypes)):
        for j in range(i + 1, len(qtypes)):
            a, b = qtypes[i], qtypes[j]
            da, db = pd.DataFrame(per_query_results[a]), pd.DataFrame(per_query_results[b])
            for metric in key_metrics:
                stat, p = paired_wilcoxon(da[metric].values, db[metric].values)
                rows.append({"query_type_a": a, "query_type_b": b, "metric": metric,
                             "mean_a": float(da[metric].mean()), "mean_b": float(db[metric].mean()),
                             "delta": float(da[metric].mean() - db[metric].mean()),
                             "wilcoxon_stat": stat, "p_value": p})
    return pd.DataFrame(rows)

# ═════════════════════════════════════════════════════════════════════════════
# 7. 메인
# ═════════════════════════════════════════════════════════════════════════════
def main():
    rng = np.random.default_rng(RANDOM_SEED)

    print("📥 eval 로딩 (eval_sample=%s) ..." % USE_SAMPLE)
    pg = psycopg2.connect(**PG_CONFIG)
    _check_columns(pg)
    eval_df = filter_paired_complete(load_eval(pg)); pg.close()
    print(f"   paired-complete 행: {len(eval_df):,}  (query type: {list(QUERY_TYPES)})")
    weights = eval_df["weight"].values

    print("🔌 ChromaDB 연결 ...")
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    print(f"   총 chunk 수: {collection.count():,}")

    # coverage 점검 (판례 chunk 메타 db_id 기준)
    unique_gold = list({int(x) for x in eval_df["corpus_id"]})
    sample = rng.choice(unique_gold, size=min(200, len(unique_gold)), replace=False)
    present = sum(1 for gid in sample
                  if collection.get(where={"db_id": int(gid)}, limit=1)["ids"])
    print(f"   coverage: {present}/{len(sample)} ({present/len(sample)*100:.1f}%)")

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"📥 모델 로드 {MODEL_NAME} (device={device}) ...")
    model = SentenceTransformer(MODEL_NAME, device=device); model.max_seq_length = 512

    # case-level 하이브리드 검색기 1회 구축(전 query type 공유)
    hybrid = None
    if USE_HYBRID:
        from hybrid_retrieval import CaseHybridRetriever
        print(f"🔧 판례 하이브리드 구축 (BM25={CASE_TABLE}.{TEXT_COLUMN} + Dense, "
              f"fusion={FUSION}) — 최초 1회 색인 ...")
        hybrid = CaseHybridRetriever(collection, PG_CONFIG, table=CASE_TABLE,
                                     id_column=ID_COLUMN, text_column=TEXT_COLUMN,
                                     cache_path=BM25_CACHE, n_dense=N_DENSE,
                                     n_sparse=N_SPARSE, fusion=FUSION, alpha=ALPHA,
                                     top_k_chunks=TOP_K_CHUNKS)

    per_query_results = {}
    golds = eval_df["corpus_id"].astype(int).tolist()
    for qtype in QUERY_TYPES:
        print(f"\n{'━'*70}\n▶ query type: {qtype} — {QUERY_TYPES[qtype]}\n{'━'*70}")
        qtexts = eval_df[qtype].fillna("").tolist()
        query_embs = encode_queries(model, qtexts)

        case_rankings = []
        for i in tqdm(range(0, len(query_embs), RETRIEVE_BATCH)):
            emb_b = query_embs[i:i+RETRIEVE_BATCH]
            if USE_HYBRID:
                case_rankings.extend(
                    hybrid.search(qtexts[i:i+RETRIEVE_BATCH], emb_b, top_k_cases=TOP_K_CASES))
            else:
                case_rankings.extend(dense_case_rankings(collection, emb_b))

        samples = [per_sample_metrics(r, g, K_VALUES)
                   for r, g in zip(case_rankings, golds)]
        per_query_results[qtype] = samples
        dq = pd.DataFrame(samples)
        wr10 = np.average(dq["recall@10"].values, weights=weights)
        wmrr = np.average(dq["mrr"].values, weights=weights)
        print(f"   (가중) Recall@10={wr10:.4f}  MRR={wmrr:.4f}")

    # 표 저장/출력
    tag = f"{'hybrid_'+FUSION if USE_HYBRID else 'dense'}"
    main_table   = build_main_table(per_query_results, weights, rng)
    cat_table    = build_category_table(eval_df, per_query_results, rng)
    paired_table = build_paired_table(per_query_results,
                    key_metrics=["recall@1","recall@10","recall@50","mrr","ndcg@10"])
    main_table.to_csv(OUTPUT_DIR / f"table1_main_{tag}.csv", index=False)
    paired_table.to_csv(OUTPUT_DIR / f"table2_paired_{tag}.csv", index=False)
    cat_table.to_csv(OUTPUT_DIR / f"table3_category_{tag}.csv", index=False)
    for qtype, samples in per_query_results.items():
        pd.DataFrame(samples).assign(
            eval_id=eval_df["eval_id"].values, folder=eval_df["folder"].values,
            corpus_id=eval_df["corpus_id"].values, weight=weights,
        ).to_csv(OUTPUT_DIR / f"per_sample_{qtype}_{tag}.csv", index=False)

    metric_order = [f"recall@{k}" for k in K_VALUES] + ["mrr"] + [f"ndcg@{k}" for k in K_VALUES]
    print("\n" + "─"*70)
    print(f"Table 1. 판례 검색 [{tag}] (design-weighted mean [95% CI], n={len(eval_df)})")
    print("─"*70)
    t1 = (main_table.assign(value=lambda d: d.apply(
            lambda r: f"{r['mean']:.4f} [{r['ci_lo']:.4f},{r['ci_hi']:.4f}]", axis=1))
          .pivot(index="metric", columns="query_type", values="value")
          .reindex(metric_order)[list(QUERY_TYPES)])
    print(t1.to_string())

    print("\n" + "─"*70 + "\nTable 2. Paired Wilcoxon (two-sided)\n" + "─"*70)
    t2 = paired_table.copy()
    t2["delta"]   = t2["delta"].map(lambda v: f"{v:+.4f}")
    t2["p_value"] = t2["p_value"].map(
        lambda p: f"{p:.2e} {'***' if p<0.001 else '**' if p<0.01 else '*' if p<0.05 else 'n.s.'}")
    print(t2[["query_type_a","query_type_b","metric","mean_a","mean_b","delta","p_value"]]
          .to_string(index=False))

    print("\n" + "─"*70 + "\nTable 3. 카테고리별 Recall@10\n" + "─"*70)
    t3 = (cat_table[cat_table["metric"]=="recall@10"]
          .assign(value=lambda d: d.apply(
              lambda r: f"{r['mean']:.3f} [{r['ci_lo']:.3f},{r['ci_hi']:.3f}] (n={r['n']:,})", axis=1))
          .pivot(index="folder", columns="query_type", values="value")[list(QUERY_TYPES)])
    print(t3.to_string())
    print(f"\n✅ 저장 → {OUTPUT_DIR}/ (tag={tag})")

if __name__ == "__main__":
    main()