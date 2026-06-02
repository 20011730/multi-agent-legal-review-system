"""
법조항 검색 평가 — section-aware + 하이브리드(BM25+Dense) 전환  [v3]
====================================================================
질문(qa_question) → laws 컬렉션 검색 → ref_rules의 (법령, section, 조문)로 채점.
USE_HYBRID 플래그로 'dense 단독' ↔ '하이브리드'를 전환해 A/B 비교(논문용).

- gold     : ref_rules 파싱 → {(법령명, MAIN|ADDENDA, 조문)} (질문당 다중정답)
- 검색      : USE_HYBRID=False → E5 dense 단독 / True → BM25(Kiwi)+Dense 융합
- 매칭      : (법령, section, 조문) 3원소. 본문 gold는 본문 조문에만 매칭.
- 집계      : 층화표본 eval_sample + 설계가중치(가중 bootstrap), 카테고리별 분해
- 지표      : Recall@K, Precision@K, F1@K, MAP, Hit@K  (K∈{1,5,10,20,50,100})

USE_HYBRID = False → dense 단독(baseline). 기존과 동일.
USE_HYBRID = True → BM25(Kiwi) + Dense 하이브리드.

⚠️ 하이브리드 사용 시 hybrid_retrieval.py 가 같은 폴더(또는 import 경로)에 있어야 함.
   laws 컬렉션은 section-aware 임베더(v4)로 구축돼 있어야 함.
"""
"""
Statute (법조항) Retrieval Evaluation  — section-aware  [v2]
법령만 평가하는 코드
===========================================================
[실행 흐름]
eval_sample ⨝ eval_dataset로 질문·ref_rules 로드 
→ ref_rules를 (법령, section, 조문) 정답으로 파싱 
→ 맨 먼저 coverage 출력 
→ 인코딩·검색 
→ Recall@K / MAP 등 출력 + law_eval_results/에 CSV 저장

평가지표 
Recall@K, Precision@K, F1@K, MAP, Hit@K
질문당 여러 개가 답이 될 수 있음

Given a legal question (qa_question), evaluate whether the retriever returns the
correct statutory provisions. Each query has a SET of gold provisions parsed from
`eval_dataset.ref_rules`, now as (법령명, SECTION, 조문):
    "민법 제103조, 부칙 제2조" → {(민법, MAIN, 제103조), (민법, ADDENDA, 제2조)}

This matches the section-aware `laws` corpus (v3 embedder), where each chunk carries
`section` ∈ {MAIN, ADDENDA}. A body gold "민법 제103조" matches only MAIN 제103조,
never a 부칙 제103조. 부칙 gold matches any ADDENDA article of that law with the same
number (ref_rules rarely names which amendment's 부칙), i.e. addendaId is ignored.

Corpus  : ChromaDB `laws` (article-level, e5 "passage:" prefix)
Eval set: stratified `eval_sample` ⨝ `eval_dataset` → design-weighted aggregation
Metrics : Recall@K, Precision@K, F1@K, MAP, Hit@K  (K ∈ {1,5,10,20,50,100})
          with 95% design-weighted bootstrap CI + per-category breakdown

⚠️ Build the `laws` collection with the v3 embedder first. If coverage is near
zero, the corpus articleNo lacks "조" (old bug) → re-embed.
"""

import re
import logging
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
import torch
import chromadb
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# ═════════════════════════════════════════════════════════════════════════════
# 설정
# ═════════════════════════════════════════════════════════════════════════════
PG_CONFIG = {
    "host": "localhost", "port": 5432,
    "dbname": "legalreview", "user": "legalreview", "password": "legalreview",
}
CHROMA_DB_PATH  = "/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/generate_rag/chroma_data"
COLLECTION_NAME = "laws"
MODEL_NAME      = "intfloat/multilingual-e5-base"

USE_SAMPLE = True                 # True: eval_sample(층화표본) / False: 전체 eval_dataset

# ── 검색 방식 ───────────────────────────────────────────────────────────────
USE_HYBRID = True                 # False: dense 단독(baseline) / True: BM25+Dense 하이브리드
FUSION     = "rrf"                # "rrf" | "linear"
ALPHA      = 0.5                  # fusion="linear"일 때 BM25 가중치(α). 별도 튜닝셋에서 정할 것
N_DENSE    = 200                  # 융합 전 dense 후보 수
N_SPARSE   = 200                  # 융합 전 BM25 후보 수
BM25_CACHE = "bm25_laws.pkl"      # BM25 토큰 캐시(최초 1회 생성)

K_VALUES     = [1, 5, 10, 20, 50, 100]
TOP_K        = 100
RETR_BATCH   = 64
EMBED_BATCH  = 256

N_BOOTSTRAP  = 1000
ALPHA_CI     = 0.05
RANDOM_SEED  = 42
OUTPUT_DIR   = Path("./law_eval_results")

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s | %(levelname)-7s | %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("law_eval")

# ═════════════════════════════════════════════════════════════════════════════
# 1. ref_rules 파서 (section 인식)
# ═════════════════════════════════════════════════════════════════════════════
ARTICLE_RE   = re.compile(r"제\s*\d+\s*조(?:\s*의\s*\d+)?")
LAW_KEYWORDS = ("법", "령", "규칙", "헌법", "법률", "특별법", "조약", "규정")

def canonical_article(s: str):
    """'조'를 포함한 표준 조문 토큰. 없으면 None(과거 articleNo 'OO조' 누락 버그 탐지)."""
    m = ARTICLE_RE.search(s or "")
    return re.sub(r"\s+", "", m.group(0)) if m else None

def _clean_law_name(name: str) -> str:
    name = re.sub(r"\([^)]*\)", "", name)      # (법률 제983호) 등 제거
    name = re.sub(r"부\s*칙", "", name)         # '부칙' 표식 제거
    name = re.sub(r"^\s*구\s+", "", name)       # 구법 표식 제거
    return re.sub(r"\s+", " ", name).strip()

def parse_ref_rules(ref: str):
    """'민법 제103조, 부칙 제2조 / 헌법 제20조' → {(법령명, section, 조문)}."""
    if not ref or not ref.strip():
        return set()
    items = [it.strip() for it in ref.replace("/", ",").split(",") if it.strip()]
    out, law, sec = set(), None, "MAIN"
    for it in items:
        arts = list(ARTICLE_RE.finditer(it))
        if arts:
            prefix = it[: arts[0].start()].strip()
            if prefix and any(k in prefix for k in LAW_KEYWORDS):
                sec = "ADDENDA" if "부칙" in prefix else "MAIN"
                law = _clean_law_name(prefix)
            elif "부칙" in it:
                sec = "ADDENDA"
            for m in arts:
                if law:
                    out.add((law, sec, re.sub(r"\s+", "", m.group(0))))
        elif "부칙" in it:
            sec = "ADDENDA"
        elif any(k in it for k in LAW_KEYWORDS):
            sec, law = "MAIN", _clean_law_name(it)
    return out

# ═════════════════════════════════════════════════════════════════════════════
# 2. 법령명 매칭
# ═════════════════════════════════════════════════════════════════════════════
def norm_law(s: str) -> str:
    s = re.sub(r"\([^)]*\)", "", s or "")
    s = re.sub(r"^\s*구\s+", "", s)
    return re.sub(r"\s+", "", s)

def law_matches(gold_law: str, aliases) -> bool:
    g = norm_law(gold_law)
    if not g:
        return False
    for a in aliases:
        if a and (g == a or a.endswith(g) or g.endswith(a)):
            return True
    return False

# ═════════════════════════════════════════════════════════════════════════════
# 3. 데이터 로딩
# ═════════════════════════════════════════════════════════════════════════════
def load_eval(pg_conn) -> pd.DataFrame:
    if USE_SAMPLE:
        sql = """
            SELECT s.eval_id, s.folder, s.weight,
                   d.qa_question, d.ref_rules, d.corpus_id
            FROM eval_sample s JOIN eval_dataset d ON s.eval_id = d.eval_id
            WHERE COALESCE(d.qa_question,'') <> '' AND COALESCE(d.ref_rules,'') <> ''
        """
    else:
        sql = """
            SELECT eval_id, folder, 1.0::float8 AS weight,
                   qa_question, ref_rules, corpus_id
            FROM eval_dataset
            WHERE COALESCE(qa_question,'') <> '' AND COALESCE(ref_rules,'') <> ''
        """
    df = pd.read_sql(sql, pg_conn)
    df["gold"] = df["ref_rules"].map(parse_ref_rules)
    df = df[df["gold"].map(len) > 0].reset_index(drop=True)
    log.info("파싱된 gold 있는 행: %s", f"{len(df):,}")
    log.info("질문당 평균 gold 조문: %.2f", df["gold"].map(len).mean())
    n_add = df["gold"].map(lambda g: any(s == "ADDENDA" for _, s, _ in g)).sum()
    log.info("부칙 조문을 인용한 질문: %s", f"{int(n_add):,}")
    return df

# ═════════════════════════════════════════════════════════════════════════════
# 4. corpus 인덱스 (coverage 점검용; section 포함)
# ═════════════════════════════════════════════════════════════════════════════
def build_corpus_index(collection):
    index = defaultdict(list)            # article -> [(aliases, section)]
    total = collection.count()
    offset, page = 0, 10_000
    pbar = tqdm(total=total, desc="corpus 인덱싱")
    while offset < total:
        got = collection.get(include=["metadatas"], limit=page, offset=offset)
        metas = got["metadatas"] or []
        for md in metas:
            art = canonical_article(md.get("articleNo", ""))
            if art is None:
                continue
            aliases = {norm_law(md.get("title", "")), norm_law(md.get("shortName", ""))}
            index[art].append((aliases, md.get("section", "MAIN")))
        offset += page; pbar.update(len(metas))
        if not metas:
            break
    pbar.close()
    return index

def gold_in_corpus(gold, index) -> int:
    hit = 0
    for law, sec, art in gold:
        for aliases, csec in index.get(art, []):
            if csec == sec and law_matches(law, aliases):
                hit += 1; break
    return hit

# ═════════════════════════════════════════════════════════════════════════════
# 5. 검색 (dense 단독 또는 하이브리드) → 디코딩
# ═════════════════════════════════════════════════════════════════════════════
def encode_queries(model, queries):
    embs = model.encode([f"query: {q}" for q in queries],
                        batch_size=EMBED_BATCH, normalize_embeddings=True,
                        show_progress_bar=True, convert_to_numpy=True)
    return embs.astype("float32")

def decode_hits(hits):
    """[(chunk_id, metadata)] → 순위 보존 [(aliases, section, article)] (중복 제거)."""
    seen, ranked = set(), []
    for cid, md in hits:
        art = canonical_article(md.get("articleNo", ""))
        if art is None:
            continue
        sec = md.get("section", "MAIN")
        aliases = frozenset({norm_law(md.get("title", "")), norm_law(md.get("shortName", ""))})
        key = (aliases, sec, art)
        if key in seen:
            continue
        seen.add(key); ranked.append((set(aliases), sec, art))
    return ranked

def dense_hits_batch(collection, query_embs):
    """dense 단독: 배치 질의 → 각 질의별 [(chunk_id, metadata)]."""
    res = collection.query(query_embeddings=query_embs.tolist(),
                           n_results=TOP_K, include=["metadatas"])
    return [list(zip(res["ids"][j], res["metadatas"][j])) for j in range(len(query_embs))]

# ═════════════════════════════════════════════════════════════════════════════
# 6. 메트릭 (다중정답, section 인식)
# ═════════════════════════════════════════════════════════════════════════════
def per_sample_metrics(ranked, gold, k_values):
    n_gold = len(gold)
    rels, matched = [], set()
    for aliases, sec, art in ranked:
        is_rel = False
        for (glaw, gsec, gart) in gold:
            if (glaw, gsec, gart) in matched:
                continue
            if art == gart and sec == gsec and law_matches(glaw, aliases):
                matched.add((glaw, gsec, gart)); is_rel = True; break
        rels.append(1 if is_rel else 0)
    out = {}
    for k in k_values:
        n_hit = sum(rels[:k]); r = n_hit / n_gold; p = n_hit / k
        out[f"recall@{k}"]    = r
        out[f"precision@{k}"] = p
        out[f"f1@{k}"]        = (2*p*r/(p+r)) if (p+r) else 0.0
        out[f"hit@{k}"]       = 1.0 if n_hit > 0 else 0.0
    hits, ap = 0, 0.0
    for i, rel in enumerate(rels, 1):
        if rel:
            hits += 1; ap += hits / i
    out["map"] = ap / n_gold if n_gold else 0.0
    return out

# ═════════════════════════════════════════════════════════════════════════════
# 7. 설계가중 집계
# ═════════════════════════════════════════════════════════════════════════════
def weighted_bootstrap_ci(values, weights, rng, n_boot=N_BOOTSTRAP, alpha=ALPHA_CI):
    v = np.asarray(values, float); w = np.asarray(weights, float)
    if v.size == 0:
        return float("nan"), float("nan"), float("nan")
    point = float(np.average(v, weights=w))
    n = len(v); means = np.empty(n_boot)
    for b in range(n_boot):
        idx = rng.integers(0, n, n)
        means[b] = np.average(v[idx], weights=w[idx])
    lo, hi = np.percentile(means, [100*alpha/2, 100*(1-alpha/2)])
    return point, float(lo), float(hi)

def build_tables(df, samples, rng):
    sdf = pd.DataFrame(samples)
    sdf["weight"] = df["weight"].values
    sdf["folder"] = df["folder"].values
    metrics = [c for c in sdf.columns if c not in ("weight", "folder")]
    overall, per_cat = [], []
    for m in metrics:
        mean, lo, hi = weighted_bootstrap_ci(sdf[m].values, sdf["weight"].values, rng)
        overall.append({"metric": m, "mean": mean, "ci_lo": lo, "ci_hi": hi, "n": len(sdf)})
    for folder, sub in sdf.groupby("folder"):
        for m in metrics:
            mean, lo, hi = weighted_bootstrap_ci(sub[m].values, sub["weight"].values, rng)
            per_cat.append({"folder": folder, "metric": m, "mean": mean,
                            "ci_lo": lo, "ci_hi": hi, "n": len(sub)})
    return pd.DataFrame(overall), pd.DataFrame(per_cat)

# ═════════════════════════════════════════════════════════════════════════════
# 8. 메인
# ═════════════════════════════════════════════════════════════════════════════
def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(RANDOM_SEED)

    pg = psycopg2.connect(**PG_CONFIG)
    df = load_eval(pg); pg.close()

    log.info("ChromaDB `%s` 연결 ...", COLLECTION_NAME)
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    log.info("corpus 청크 수: %s", f"{collection.count():,}")

    # 8-1. coverage (정답 조문이 corpus에 있는가)
    log.info("coverage 점검용 corpus 인덱스 구축 ...")
    index = build_corpus_index(collection)
    tot_gold = covered = tot_add = cov_add = 0
    for g in df["gold"]:
        tot_gold += len(g); covered += gold_in_corpus(g, index)
        add = {x for x in g if x[1] == "ADDENDA"}
        tot_add += len(add); cov_add += gold_in_corpus(add, index)
    cov = covered / tot_gold if tot_gold else 0.0
    log.info("corpus 내 gold 조문: %s / %s  (%.1f%%)",
             f"{covered:,}", f"{tot_gold:,}", 100*cov)
    if tot_add:
        log.info("  └ 부칙 조문: %s / %s (%.1f%%)",
                 f"{cov_add:,}", f"{tot_add:,}", 100*cov_add/tot_add)
    if cov < 0.5:
        log.warning("⚠️ coverage 낮음 → articleNo 버그 재임베딩 또는 구법/특별법 누락 점검.")

    # 8-2. 모델
    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    log.info("모델 로드 %s (device=%s)", MODEL_NAME, device)
    model = SentenceTransformer(MODEL_NAME, device=device); model.max_seq_length = 512

    log.info("질문 %s건 인코딩 ...", f"{len(df):,}")
    q_embs = encode_queries(model, df["qa_question"].tolist())
    qtexts = df["qa_question"].tolist()

    # 8-3. 검색 (dense 단독 또는 하이브리드)
    hybrid = None
    if USE_HYBRID:
        from hybrid_retrieval import HybridRetriever
        log.info("하이브리드 검색기 구축 (BM25+Dense, fusion=%s) ...", FUSION)
        hybrid = HybridRetriever(collection, cache_path=BM25_CACHE,
                                 n_dense=N_DENSE, n_sparse=N_SPARSE,
                                 fusion=FUSION, alpha=ALPHA)

    log.info("검색 중 (USE_HYBRID=%s) ...", USE_HYBRID)
    ranked_all = []
    for i in tqdm(range(0, len(q_embs), RETR_BATCH)):
        emb_b = q_embs[i:i+RETR_BATCH]
        if USE_HYBRID:
            hits_batch = hybrid.search(qtexts[i:i+RETR_BATCH], emb_b, top_k=TOP_K)
        else:
            hits_batch = dense_hits_batch(collection, emb_b)
        for hits in hits_batch:
            ranked_all.append(decode_hits(hits))

    # 8-4. 채점
    log.info("채점 ...")
    samples = [per_sample_metrics(r, g, K_VALUES)
               for r, g in zip(ranked_all, df["gold"])]

    overall, per_cat = build_tables(df, samples, rng)
    tag = f"{'hybrid_'+FUSION if USE_HYBRID else 'dense'}"
    overall.to_csv(OUTPUT_DIR / f"law_overall_{tag}.csv", index=False)
    per_cat.to_csv(OUTPUT_DIR / f"law_by_category_{tag}.csv", index=False)
    pd.DataFrame(samples).assign(
        eval_id=df["eval_id"].values, folder=df["folder"].values,
        n_gold=df["gold"].map(len).values,
    ).to_csv(OUTPUT_DIR / f"law_per_sample_{tag}.csv", index=False)

    order = ([f"recall@{k}" for k in K_VALUES] + [f"precision@{k}" for k in K_VALUES] +
             [f"f1@{k}" for k in K_VALUES] + [f"hit@{k}" for k in K_VALUES] + ["map"])
    print("\n" + "─"*64)
    print(f"법조항 검색 [{tag}] (design-weighted mean [95% CI], n={len(df):,}, "
          f"coverage={100*cov:.1f}%)")
    print("─"*64)
    t = overall.set_index("metric").reindex(order)
    for m in order:
        if m in t.index and not pd.isna(t.loc[m, "mean"]):
            r = t.loc[m]
            print(f"  {m:<14} {r['mean']:.4f}  [{r['ci_lo']:.4f}, {r['ci_hi']:.4f}]")
    log.info("저장 → %s/ (tag=%s)", OUTPUT_DIR, tag)

if __name__ == "__main__":
    main()