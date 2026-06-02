"""
Stratified Sub-sampling of the RAG Evaluation Set
=================================================
기존 카테고리 불균형 문제를 해결하기 위해 작성된 코드
Purpose

eval_dataset에서 층화 표본 2,000건을 뽑아 eval_sample 테이블을 만드는 것. 
판례·법령 검색을 돌리지도, 채점하지도 않습니다. 그냥 "어떤 질문 2,000개로 평가할지" 명단을 만드는 준비 작업이다.

결과물 
모든 카테고리가 155~499건 범위 안으로 들어옴
design_weight가 카테고리마다 1.08 ~ 23.92로 크게 다르게 나온다.

TL_01(민사): 표본 1건이 모집단 23.92건을 대표.
TL_10(개인정보): 표본 1건이 1.08건만 대표

따라서 전체 지표는 반드시 weight로 가중평균해야 합니다
-------
The full evaluation pool (`eval_dataset`, PostgreSQL) contains 27,400 query rows,
each linked to a single gold case (`corpus_id`) and its referenced statutes
(`ref_rules`). Running retrieval on all 27,400 queries is unnecessarily expensive:
a few thousand stratified samples already give tight confidence intervals
(±2-3% on a proportion at n≈1-2k), while reducing cost by ~10x.

This script draws a reproducible stratified sample so that:
  (1) every category (folder) is represented well enough for a per-category metric,
      including the small ones (TL_06, TL_10) via a minimum floor (over-sampling);
  (2) population-level (overall) metrics remain *unbiased* through design weights
      w_h = N_h / n_h, to be applied as a weighted mean / weighted bootstrap when
      aggregating across strata.

Sampling design
---------------
Stratification variable : `folder` (8 legal categories)
Allocation              : proportional-to-size with a per-stratum floor
                          (a.k.a. "proportional allocation with minimum stratum
                          size"; the floor over-samples small strata so their
                          per-category estimates are usable).
Design weight           : w_h = N_h / n_h  (rows represented per sampled row)
                          Overall estimate of a metric m:
                              m_hat = (1/N) * Σ_h N_h * mean_h(m)
                                    = weighted mean of per-row values with weight w_h
Selection               : simple random sampling WITHOUT replacement within stratum
Reproducibility         : fixed RANDOM_SEED; allocation table, config and seed are
                          persisted alongside the sample.

Outputs
-------
PostgreSQL table `eval_sample` (eval_id, design weight, stratum metadata) +
CSV mirror + an allocation/manifest CSV for the paper's appendix.

Reference: Cochran, W.G. (1977) *Sampling Techniques*, 3rd ed., ch. 5
(stratified random sampling, proportional allocation, design weights).
"""

from __future__ import annotations

import json
import math
import logging
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ═════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═════════════════════════════════════════════════════════════════════════════
@dataclass(frozen=True)
class Config:
    pg: dict = field(default_factory=lambda: {
        "host": "localhost", "port": 5432,
        "dbname": "legalreview", "user": "legalreview", "password": "legalreview",
    })
    source_table: str = "eval_dataset"
    sample_table: str = "eval_sample"

    # Eligibility: a query must have a non-empty question and a gold case.
    # For joint case + statute evaluation, also require non-empty `ref_rules`.
    require_qa_question: bool = True
    require_ref_rules: bool = True   # set False to evaluate case retrieval only

    # Treat each (query) row as one sampling unit. If True, keep at most one row
    # per gold case so the same case is not over-represented as a target.
    dedup_by_corpus_id: bool = False

    # Allocation
    target_total: int = 2000   # total queries to sample
    stratum_floor: int = 150   # minimum per stratum (capped by availability)

    random_seed: int = 42
    output_dir: Path = Path("./eval_sample_out")


CFG = Config()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("eval_sample")


# ═════════════════════════════════════════════════════════════════════════════
# 1. LOAD ELIGIBLE POOL
# ═════════════════════════════════════════════════════════════════════════════
def load_pool(conn, cfg: Config) -> pd.DataFrame:
    """Load the eligible evaluation pool with its stratification key."""
    sql = f"""
        SELECT eval_id, folder, corpus_id, class_name,
               case_title, summ_pass, qa_question, ref_rules, ref_cases
        FROM {cfg.source_table}
        WHERE corpus_id IS NOT NULL
    """
    df = pd.read_sql(sql, conn)
    n0 = len(df)
    log.info("rows with corpus_id              : %s", f"{n0:,}")

    # normalise text columns for emptiness checks
    for c in ("qa_question", "ref_rules", "summ_pass", "case_title"):
        df[c] = df[c].fillna("").astype(str).str.strip()

    if cfg.require_qa_question:
        df = df[df["qa_question"].str.len() > 0]
        log.info("  with non-empty qa_question     : %s", f"{len(df):,}")

    n_with_rules = int((df["ref_rules"].str.len() > 0).sum())
    log.info("  with non-empty ref_rules       : %s  (%.1f%%)",
             f"{n_with_rules:,}", 100 * n_with_rules / max(len(df), 1))

    if cfg.require_ref_rules:
        df = df[df["ref_rules"].str.len() > 0]
        log.info("  eligible (qa + ref_rules)      : %s", f"{len(df):,}")

    n_unique_cases = df["corpus_id"].nunique()
    log.info("  distinct gold cases (corpus_id): %s", f"{n_unique_cases:,}")

    if cfg.dedup_by_corpus_id:
        # keep one (deterministic) row per gold case
        df = (df.sort_values("eval_id")
                .drop_duplicates(subset="corpus_id", keep="first"))
        log.info("  after dedup_by_corpus_id       : %s", f"{len(df):,}")

    return df.reset_index(drop=True)


# ═════════════════════════════════════════════════════════════════════════════
# 2. ALLOCATION  (proportional + floor, capacity-aware, exact total)
# ═════════════════════════════════════════════════════════════════════════════
def allocate(strata_sizes: dict[str, int], target_total: int,
             floor: int) -> dict[str, int]:
    """
    Proportional-to-size allocation with a per-stratum minimum (floor).

    Guarantees:
      - n_h >= min(floor, N_h)            (small strata over-sampled, never exceed N_h)
      - 0 <= n_h <= N_h                   (cannot draw more than available)
      - Σ n_h == min(target_total, ΣN_h)  (budget met exactly when feasible)
    Remaining budget after the floor is distributed proportionally to N_h, with
    leftover units assigned by the largest-remainder rule.
    """
    N_total = sum(strata_sizes.values())
    target = min(target_total, N_total)

    alloc = {h: min(floor, n) for h, n in strata_sizes.items()}
    capacity = lambda h: strata_sizes[h] - alloc[h]

    # iteratively fill the remaining budget among strata that still have capacity
    guard = 0
    while sum(alloc.values()) < target:
        guard += 1
        if guard > 10_000:                       # safety against pathological inputs
            break
        budget = target - sum(alloc.values())
        open_h = {h: strata_sizes[h] for h in strata_sizes if capacity(h) > 0}
        if not open_h:
            break
        W = sum(open_h.values())
        ideal = {h: budget * open_h[h] / W for h in open_h}

        # integer part first, capped by remaining capacity
        for h in open_h:
            add = min(int(ideal[h]), capacity(h))
            alloc[h] += add

        # distribute leftovers by largest fractional remainder
        leftover = target - sum(alloc.values())
        if leftover > 0:
            for h in sorted(open_h, key=lambda x: ideal[x] - int(ideal[x]),
                            reverse=True):
                if leftover == 0:
                    break
                if capacity(h) > 0:
                    alloc[h] += 1
                    leftover -= 1
    return alloc


def allocation_table(strata_sizes: dict[str, int],
                     alloc: dict[str, int]) -> pd.DataFrame:
    N = sum(strata_sizes.values())
    rows = []
    for h in sorted(strata_sizes):
        Nh, nh = strata_sizes[h], alloc[h]
        rows.append({
            "stratum": h,
            "N_h (pop)": Nh,
            "pop_share": Nh / N,
            "n_h (sample)": nh,
            "sampling_fraction": nh / Nh if Nh else float("nan"),
            "design_weight w_h": Nh / nh if nh else float("nan"),
        })
    t = pd.DataFrame(rows)
    t.loc["TOTAL"] = {
        "stratum": "TOTAL",
        "N_h (pop)": N,
        "pop_share": 1.0,
        "n_h (sample)": int(t["n_h (sample)"].sum()),
        "sampling_fraction": t["n_h (sample)"].sum() / N,
        "design_weight w_h": float("nan"),
    }
    return t


# ═════════════════════════════════════════════════════════════════════════════
# 3. DRAW SAMPLE  (SRS without replacement within each stratum)
# ═════════════════════════════════════════════════════════════════════════════
def draw_sample(df: pd.DataFrame, alloc: dict[str, int],
                strata_sizes: dict[str, int], rng) -> pd.DataFrame:
    parts = []
    for h, nh in alloc.items():
        idx = df.index[df["folder"] == h].to_numpy()
        chosen = rng.choice(idx, size=nh, replace=False)
        sub = df.loc[chosen].copy()
        sub["stratum"] = h
        sub["stratum_pop"] = strata_sizes[h]
        sub["stratum_sample"] = nh
        sub["weight"] = strata_sizes[h] / nh        # design weight w_h
        parts.append(sub)
    out = pd.concat(parts, ignore_index=True)
    # weights normalised to sum to N (so weighted counts recover population size)
    return out


# ═════════════════════════════════════════════════════════════════════════════
# 4. PERSIST
# ═════════════════════════════════════════════════════════════════════════════
def write_sample_table(conn, cfg: Config, sample: pd.DataFrame) -> None:
    cur = conn.cursor()
    cur.execute(f"DROP TABLE IF EXISTS {cfg.sample_table}")
    cur.execute(f"""
        CREATE TABLE {cfg.sample_table} (
            sample_id      BIGSERIAL PRIMARY KEY,
            eval_id        BIGINT,
            folder         TEXT,
            stratum        TEXT,
            corpus_id      BIGINT,
            stratum_pop    INT,
            stratum_sample INT,
            weight         DOUBLE PRECISION,
            has_ref_rules  BOOLEAN
        )
    """)
    cur.execute(f"CREATE INDEX idx_{cfg.sample_table}_eval "
                f"ON {cfg.sample_table}(eval_id)")

    payload = [
        (int(r.eval_id), r.folder, r.stratum, int(r.corpus_id),
         int(r.stratum_pop), int(r.stratum_sample), float(r.weight),
         bool(len(str(r.ref_rules).strip()) > 0))
        for r in sample.itertuples(index=False)
    ]
    execute_values(cur, f"""
        INSERT INTO {cfg.sample_table}
        (eval_id, folder, stratum, corpus_id,
         stratum_pop, stratum_sample, weight, has_ref_rules)
        VALUES %s
    """, payload)
    conn.commit()
    cur.close()
    log.info("wrote %s rows to PostgreSQL table `%s`",
             f"{len(payload):,}", cfg.sample_table)


# ═════════════════════════════════════════════════════════════════════════════
# 5. MAIN
# ═════════════════════════════════════════════════════════════════════════════
def main(cfg: Config = CFG) -> None:
    cfg.output_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(cfg.random_seed)

    conn = psycopg2.connect(**cfg.pg)
    try:
        log.info("Loading eligible pool from `%s` ...", cfg.source_table)
        pool = load_pool(conn, cfg)

        strata_sizes = pool["folder"].value_counts().to_dict()
        alloc = allocate(strata_sizes, cfg.target_total, cfg.stratum_floor)

        alloc_tbl = allocation_table(strata_sizes, alloc)
        log.info("Allocation:\n%s", alloc_tbl.to_string(
            index=False,
            formatters={
                "pop_share":         lambda v: f"{v:6.2%}",
                "sampling_fraction": lambda v: f"{v:6.2%}",
                "design_weight w_h": lambda v: "" if pd.isna(v) else f"{v:7.2f}",
            }))

        sample = draw_sample(pool, alloc, strata_sizes, rng)
        write_sample_table(conn, cfg, sample)

        # ── artifacts for the paper / reproducibility ────────────────────────
        sample.to_csv(cfg.output_dir / "eval_sample.csv", index=False)
        alloc_tbl.to_csv(cfg.output_dir / "allocation_table.csv", index=False)

        manifest = {
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "config": {k: (str(v) if isinstance(v, Path) else v)
                       for k, v in asdict(cfg).items()},
            "population_size_N": int(sum(strata_sizes.values())),
            "sample_size_n": int(len(sample)),
            "strata_population": strata_sizes,
            "strata_allocation": alloc,
        }
        (cfg.output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

        log.info("Done. n=%s drawn from N=%s (%.1f%%). Artifacts → %s/",
                 f"{len(sample):,}", f"{sum(strata_sizes.values()):,}",
                 100 * len(sample) / sum(strata_sizes.values()), cfg.output_dir)
    finally:
        conn.close()


if __name__ == "__main__":
    main()