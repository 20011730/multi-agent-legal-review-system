"""
RAG Retrieval Evaluation Pipeline
=================================
Corpus: ChromaDB(legal_case_chunks) embedded with intfloat/multilingual-e5-base
Eval set: AI Hub 상황별 판례 데이터 → eval_dataset (PostgreSQL)

Query types compared (paired design):
  - summ_pass     : 쟁점 요지 (1-2 sentence summary)
  - qa_question   : 법률 질문형
  - case_title    : 사건명 (단순 키워드)

Metrics (with 95% bootstrap CI):
  - Recall@K, MRR, nDCG@K  for K ∈ {1, 5, 10, 20, 50, 100}
Significance: Wilcoxon signed-rank test (paired, two-sided)
Table 1: Query type별 메트릭 + 95% bootstrap CI (Recall@K, MRR, nDCG@K)
Table 2: Query type 쌍별 Wilcoxon signed-rank paired test
Table 3: 카테고리별 Recall@10 break-down
"""

import os
import math
from pathlib import Path
from collections import defaultdict

import numpy as np
import pandas as pd
import psycopg2
import torch
import chromadb
from sentence_transformers import SentenceTransformer
from scipy.stats import wilcoxon
from tqdm import tqdm

# ═════════════════════════════════════════════════════════════════════════════
# 1. CONFIGURATION
# ═════════════════════════════════════════════════════════════════════════════
PG_CONFIG = {
    "host": "localhost", "port": 5432,
    "dbname": "legalreview", "user": "legalreview", "password": "legalreview",
}
CHROMA_DB_PATH   = "/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/generate_rag/chroma_legal_db"
COLLECTION_NAME  = "legal_case_chunks"
MODEL_NAME       = "intfloat/multilingual-e5-base"

QUERY_TYPES = {
    "summ_pass":   "쟁점 요지 (Summary.summ_pass)",
    "qa_question": "법률 질문 (jdgmnInfo.question)",
    #"case_title":  "사건명 키워드 (caseTitle)",
    "keyword":     "주제 키워드 (keyword_tagg)", # 수정

}

K_VALUES        = [1, 5, 10, 20, 50, 100]
TOP_K_CHUNKS    = 500   # case-level dedup 후 100건을 보장하기 위한 chunk 후보 수
TOP_K_CASES     = 100
EMBED_BATCH     = 256
RETRIEVE_BATCH  = 64

N_BOOTSTRAP     = 1000
ALPHA           = 0.05
RANDOM_SEED     = 42

OUTPUT_DIR = Path("./eval_results")
OUTPUT_DIR.mkdir(exist_ok=True)

# ═════════════════════════════════════════════════════════════════════════════
# 2. DATA LOADING
# ═════════════════════════════════════════════════════════════════════════════
def load_eval_dataset(pg_conn) -> pd.DataFrame:
    sql = """
        SELECT eval_id, folder, corpus_id, class_name,
               case_title, summ_pass, qa_question
        FROM eval_dataset
        WHERE corpus_id IS NOT NULL
    """
    return pd.read_sql(sql, pg_conn)

def filter_paired_complete(df: pd.DataFrame) -> pd.DataFrame:
    """3개 query type 모두 비어있지 않은 row만 사용 → paired comparison 보장"""
    nonempty = lambda s: s.fillna("").str.strip().str.len() > 0
    mask = nonempty(df["summ_pass"]) & nonempty(df["qa_question"]) & nonempty(df["case_title"])
    return df[mask].reset_index(drop=True)

# ═════════════════════════════════════════════════════════════════════════════
# 3. ENCODING & RETRIEVAL
# ═════════════════════════════════════════════════════════════════════════════
def encode_queries(model: SentenceTransformer, queries, batch_size=EMBED_BATCH):
    """e5 모델은 query에 'query: ' prefix 필수"""
    formatted = [f"query: {q}" for q in queries]
    embs = model.encode(
        formatted,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    return embs.astype("float32")

def retrieve_top_cases(collection, query_embs, top_k_chunks, top_k_cases):
    """Chunk-level retrieval → case-level dedup (한 case의 첫 등장 순위 보존)"""
    result = collection.query(
        query_embeddings=query_embs.tolist(),
        n_results=top_k_chunks,
    )
    ids_per_query = result["ids"]            # List[List[str]]
    case_rankings = []
    for chunk_ids in ids_per_query:
        seen, cases = set(), []
        for chunk_id in chunk_ids:
            # chunk_id format: f"{db_id}_{child_id}"
            try:
                case_id = int(chunk_id.split("_")[0])
            except ValueError:
                continue
            if case_id not in seen:
                seen.add(case_id)
                cases.append(case_id)
                if len(cases) >= top_k_cases:
                    break
        case_rankings.append(cases)
    return case_rankings

# ═════════════════════════════════════════════════════════════════════════════
# 4. METRICS
# ═════════════════════════════════════════════════════════════════════════════
def per_sample_metrics(ranked_cases, gold_case_id: int, k_values):
    """단일 정답 IR 메트릭. nDCG는 binary relevance 기준 (IDCG=1)"""
    try:
        rank = ranked_cases.index(int(gold_case_id)) + 1  # 1-indexed
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
# 5. STATISTICS
# ═════════════════════════════════════════════════════════════════════════════
def bootstrap_ci(values, n_bootstrap=N_BOOTSTRAP, alpha=ALPHA, rng=None):
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return float("nan"), float("nan"), float("nan")
    rng = rng or np.random.default_rng(RANDOM_SEED)
    n = len(arr)
    samples = arr[rng.integers(0, n, size=(n_bootstrap, n))].mean(axis=1)
    return float(arr.mean()), float(np.percentile(samples, 100*alpha/2)), \
           float(np.percentile(samples, 100*(1-alpha/2)))

def paired_wilcoxon(values_a, values_b):
    a, b = np.asarray(values_a), np.asarray(values_b)
    diff = a - b
    if not np.any(diff != 0):
        return float("nan"), 1.0
    stat, p = wilcoxon(a, b, zero_method="wilcox", alternative="two-sided")
    return float(stat), float(p)

# ═════════════════════════════════════════════════════════════════════════════
# 6. TABLE BUILDERS
# ═════════════════════════════════════════════════════════════════════════════
def build_main_table(per_query_results, rng):
    rows = []
    for qtype, samples in per_query_results.items():
        df = pd.DataFrame(samples)
        for metric in df.columns:
            mean, lo, hi = bootstrap_ci(df[metric].values, rng=rng)
            rows.append({
                "query_type": qtype, "metric": metric,
                "mean": mean, "ci_lo": lo, "ci_hi": hi, "n": len(df),
            })
    return pd.DataFrame(rows)

def build_category_table(eval_df, per_query_results, rng):
    rows = []
    for qtype, samples in per_query_results.items():
        df = pd.DataFrame(samples).assign(folder=eval_df["folder"].values)
        for folder, sub in df.groupby("folder"):
            for metric in [c for c in sub.columns if c != "folder"]:
                mean, lo, hi = bootstrap_ci(sub[metric].values, rng=rng)
                rows.append({
                    "query_type": qtype, "folder": folder, "metric": metric,
                    "mean": mean, "ci_lo": lo, "ci_hi": hi, "n": len(sub),
                })
    return pd.DataFrame(rows)

def build_paired_table(per_query_results, key_metrics):
    qtypes = list(per_query_results)
    rows = []
    for i in range(len(qtypes)):
        for j in range(i+1, len(qtypes)):
            a, b = qtypes[i], qtypes[j]
            da = pd.DataFrame(per_query_results[a])
            db = pd.DataFrame(per_query_results[b])
            for metric in key_metrics:
                stat, p = paired_wilcoxon(da[metric].values, db[metric].values)
                rows.append({
                    "query_type_a": a, "query_type_b": b, "metric": metric,
                    "mean_a": float(da[metric].mean()),
                    "mean_b": float(db[metric].mean()),
                    "delta": float(da[metric].mean() - db[metric].mean()),
                    "wilcoxon_stat": stat, "p_value": p,
                })
    return pd.DataFrame(rows)

# ═════════════════════════════════════════════════════════════════════════════
# 7. MAIN
# ═════════════════════════════════════════════════════════════════════════════
def main():
    rng = np.random.default_rng(RANDOM_SEED)

    # 7-1. eval_dataset 로딩 & paired filter
    print("📥 Loading eval_dataset from PostgreSQL ...")
    pg = psycopg2.connect(**PG_CONFIG)
    eval_df_raw = load_eval_dataset(pg)
    pg.close()
    print(f"   raw rows with corpus_id : {len(eval_df_raw):,}")
    eval_df = filter_paired_complete(eval_df_raw)
    print(f"   paired-complete rows    : {len(eval_df):,}\n")

    # 7-2. ChromaDB 연결
    print("🔌 Connecting to ChromaDB ...")
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    print(f"   total chunks in collection: {collection.count():,}\n")

    # 7-3. Ground-truth coverage sanity check
    print("🔎 Sanity check: gold cases present in ChromaDB ...")
    unique_gold = list({int(x) for x in eval_df["corpus_id"]})
    sample = rng.choice(unique_gold, size=min(200, len(unique_gold)), replace=False)
    present = 0
    for gid in sample:
        got = collection.get(where={"db_id": int(gid)}, limit=1)
        if got["ids"]:
            present += 1
    coverage = present / len(sample)
    print(f"   sampled {len(sample)} gold cases → {present} present ({coverage*100:.1f}%)")
    if coverage < 0.9:
        print("   ⚠️ coverage가 90% 미만 — chunk 메타데이터의 db_id 형식 점검 필요\n")
    else:
        print("   ✅ 정상\n")

    # 7-4. 모델 로딩
    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"📥 Loading {MODEL_NAME} (device={device}) ...")
    model = SentenceTransformer(MODEL_NAME, device=device)
    model.max_seq_length = 512

    # 7-5. Query type별 평가
    per_query_results = {}
    for qtype in QUERY_TYPES:
        print(f"\n{'━'*70}\n▶ Query type: {qtype} — {QUERY_TYPES[qtype]}\n{'━'*70}")
        queries = eval_df[qtype].fillna("").tolist()
        golds   = eval_df["corpus_id"].astype(int).tolist()

        print("🚀 Encoding queries ...")
        query_embs = encode_queries(model, queries)

        print("🔍 Retrieving top cases ...")
        case_rankings = []
        for i in tqdm(range(0, len(query_embs), RETRIEVE_BATCH)):
            batch = query_embs[i:i+RETRIEVE_BATCH]
            case_rankings.extend(
                retrieve_top_cases(collection, batch, TOP_K_CHUNKS, TOP_K_CASES)
            )

        print("📊 Computing per-sample metrics ...")
        samples = [per_sample_metrics(r, g, K_VALUES)
                   for r, g in zip(case_rankings, golds)]
        per_query_results[qtype] = samples

        df_q = pd.DataFrame(samples)
        print(f"   Recall@10 = {df_q['recall@10'].mean():.4f}  |  "
              f"MRR = {df_q['mrr'].mean():.4f}  |  "
              f"nDCG@10 = {df_q['ndcg@10'].mean():.4f}")

    # 7-6. Tables
    print("\n" + "═"*70 + "\n📈 Aggregating results\n" + "═"*70)
    main_table    = build_main_table(per_query_results, rng)
    cat_table     = build_category_table(eval_df, per_query_results, rng)
    paired_table  = build_paired_table(
        per_query_results,
        key_metrics=["recall@1", "recall@10", "recall@50", "mrr", "ndcg@10"],
    )

    # 7-7. 저장
    main_table.to_csv(OUTPUT_DIR / "table1_main_metrics.csv", index=False)
    paired_table.to_csv(OUTPUT_DIR / "table2_paired_tests.csv", index=False)
    cat_table.to_csv(OUTPUT_DIR / "table3_category_breakdown.csv", index=False)
    for qtype, samples in per_query_results.items():
        pd.DataFrame(samples).assign(
            eval_id=eval_df["eval_id"].values,
            folder=eval_df["folder"].values,
            corpus_id=eval_df["corpus_id"].values,
        ).to_csv(OUTPUT_DIR / f"per_sample_{qtype}.csv", index=False)

    # 7-8. 논문 표 형식 콘솔 출력
    metric_order = (
        [f"recall@{k}" for k in K_VALUES] + ["mrr"] +
        [f"ndcg@{k}" for k in K_VALUES]
    )

    print("\n" + "─"*70)
    print("Table 1. Retrieval performance by query type "
          "(mean [95% bootstrap CI], n = {})".format(len(eval_df)))
    print("─"*70)
    t1 = (main_table.assign(value=lambda d: d.apply(
            lambda r: f"{r['mean']:.4f} [{r['ci_lo']:.4f},{r['ci_hi']:.4f}]",
            axis=1))
          .pivot(index="metric", columns="query_type", values="value")
          .reindex(metric_order)
          [list(QUERY_TYPES)])
    print(t1.to_string())

    print("\n" + "─"*70)
    print("Table 2. Paired Wilcoxon signed-rank tests (two-sided)")
    print("─"*70)
    t2 = paired_table.copy()
    t2["delta"]   = t2["delta"].map(lambda v: f"{v:+.4f}")
    t2["p_value"] = t2["p_value"].map(
        lambda p: f"{p:.2e} {'***' if p<0.001 else '**' if p<0.01 else '*' if p<0.05 else 'n.s.'}"
    )
    print(t2[["query_type_a","query_type_b","metric","mean_a","mean_b","delta","p_value"]]
          .to_string(index=False))

    print("\n" + "─"*70)
    print("Table 3. Recall@10 by category (mean [95% CI], n)")
    print("─"*70)
    t3 = (cat_table[cat_table["metric"]=="recall@10"]
          .assign(value=lambda d: d.apply(
              lambda r: f"{r['mean']:.3f} [{r['ci_lo']:.3f},{r['ci_hi']:.3f}] (n={r['n']:,})",
              axis=1))
          .pivot(index="folder", columns="query_type", values="value")
          [list(QUERY_TYPES)])
    print(t3.to_string())

    print(f"\n✅ All artifacts saved to {OUTPUT_DIR}/")
    print(f"   - table1_main_metrics.csv")
    print(f"   - table2_paired_tests.csv")
    print(f"   - table3_category_breakdown.csv")
    print(f"   - per_sample_<query_type>.csv (× {len(QUERY_TYPES)})")


if __name__ == "__main__":
    main()