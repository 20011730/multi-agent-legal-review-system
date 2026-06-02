"""
임베더 조문 누락 탐지 — '현행법인데 조문이 비정상적으로 적게/드문드문 들어간 법' 찾기
==============================================================================
목적: coverage 천장 중 '구법'(회복불가)과 구분되는, 진짜 임베더 버그(현행법인데
조문 파싱 실패로 일부만 임베딩됨)를 골라낸다. 이런 법만 재임베딩하면 회복된다.

판정 신호 (단순 임계값 대신 상대 비교)
-----------------------------------
(A) gold가 인용한 그 법의 최대 조문번호  >  corpus가 가진 그 법의 최대 조문번호
    → 정답은 제105조를 인용하는데 corpus 최대 조문이 제2조면, 뒷부분 통째 누락.
(B) corpus 조문 수가 gold가 인용한 고유 조문 수보다 적음
    → 인용된 조문조차 다 못 담을 만큼 적게 들어감.
(C) 조문 번호 점유율(있는 조문 / 최대 조문번호) 이 매우 낮음(구멍 많음)
    → 제1·2조만 있고 그 위가 비면 파싱 실패 의심.

'구법'은 corpus에 아예 없으므로 여기 안 잡힘(law_absent) → 자연히 분리됨.
대상은 'corpus에 존재하는 현행법인데 조문이 부족한' 경우로 한정된다.

출력(./embedder_gaps/): suspect_laws.csv (재임베딩 후보, 의심강도 순)
"""

import re
import logging
from collections import defaultdict
from pathlib import Path

import pandas as pd
import psycopg2
import chromadb
from tqdm import tqdm

PG_CONFIG = {"host":"localhost","port":5432,"dbname":"legalreview",
             "user":"legalreview","password":"legalreview"}
CHROMA_DB_PATH  = "/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/generate_rag/chroma_data"
COLLECTION_NAME = "laws"
USE_SAMPLE      = True
OUTPUT_DIR      = Path("./embedder_gaps")

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("gaps")

ART_RE       = re.compile(r"제\s*(\d+)\s*조(?:\s*의\s*(\d+))?")
LAW_KEYWORDS = ("법", "령", "규칙", "헌법", "법률", "특별법", "조약", "규정")
REL_RE       = re.compile(r"(같은\s*법|동\s*법)")

def art_main_no(s):
    """조문의 '주 번호'(제105조의2 → 105). 정렬·최대값 비교용."""
    m = ART_RE.search(s or "")
    return int(m.group(1)) if m else None

def art_token(s):
    m = ART_RE.search(s or "")
    if not m:
        return None
    return f"제{m.group(1)}조" + (f"의{m.group(2)}" if m.group(2) else "")

def norm_law(s):
    s = re.sub(r"\([^)]*\)", "", s or "")
    s = re.sub(r"^\s*구\s+", "", s)
    return re.sub(r"\s+", "", s)

# ── 보강 파서(진단 v2와 동일 규칙, 법령명·조문만 필요) ──────────────────────────
def strip_markers(ref): return re.sub(r"\s+"," ",re.sub(r"\[\s*\d+\s*\]"," ",ref)).strip()
def clean_law(name):
    name = name.split("(")[0]; name = re.sub(r"부\s*칙","",name)
    name = re.sub(r"^\s*구\s+","",name); return re.sub(r"\s+"," ",name).strip()
def base_of(law): return re.sub(r"\s*시행(령|규칙)\s*$","",law).strip()

def parse_refs(ref):
    if not ref or not ref.strip(): return set()
    ref = strip_markers(ref)
    items = [it.strip() for it in ref.replace("/",",").split(",") if it.strip()]
    out, law, last_base = set(), None, None
    for it in items:
        arts = list(ART_RE.finditer(it))
        prefix = it[:arts[0].start()].strip() if arts else it
        has_kw = any(k in prefix for k in LAW_KEYWORDS)
        if REL_RE.search(prefix) and last_base:
            suf = "시행령" if "시행령" in prefix else ("시행규칙" if "시행규칙" in prefix else "")
            law = (last_base + (" "+suf if suf else "")).strip()
        elif (arts and has_kw) or (has_kw and not arts):
            law = clean_law(prefix if arts else it); last_base = base_of(law)
        for m in arts:
            if law:
                out.add((norm_law(law), int(m.group(1))))   # (법령정규화, 주조문번호)
    return out

def law_matches(gn, a):
    return a and (gn == a or a.endswith(gn) or gn.endswith(a))

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1) gold: 법령별 인용 조문번호 모으기
    pg = psycopg2.connect(**PG_CONFIG)
    sql = ("""SELECT d.ref_rules FROM eval_sample s JOIN eval_dataset d ON s.eval_id=d.eval_id
              WHERE COALESCE(d.ref_rules,'')<>''""" if USE_SAMPLE else
           "SELECT ref_rules FROM eval_dataset WHERE COALESCE(ref_rules,'')<>''")
    refs = pd.read_sql(sql, pg)["ref_rules"].tolist(); pg.close()
    gold_law_arts = defaultdict(set)
    for r in refs:
        for gn, no in parse_refs(r):
            gold_law_arts[gn].add(no)
    log.info("gold 법령 수: %s", f"{len(gold_law_arts):,}")

    # 2) corpus: 법령(alias)별 조문 주번호 집합 + 표시이름
    log.info("corpus 인덱싱 ...")
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    col = client.get_collection(COLLECTION_NAME)
    corpus_arts = defaultdict(set)         # alias(norm) -> {주조문번호}
    corpus_name = {}                       # alias -> 표시용 원래 title
    total = col.count(); off, page = 0, 10_000
    pbar = tqdm(total=total)
    while off < total:
        got = col.get(include=["metadatas"], limit=page, offset=off)
        metas = got["metadatas"] or []
        for md in metas:
            no = art_main_no(md.get("articleNo",""))
            if no is None: continue
            for raw in (md.get("title",""), md.get("shortName","")):
                a = norm_law(raw)
                if a:
                    corpus_arts[a].add(no)
                    corpus_name.setdefault(a, raw or a)
        off += page; pbar.update(len(metas))
        if not metas: break
    pbar.close()
    corpus_aliases = list(corpus_arts.keys())

    # 3) gold 법령 ↔ corpus alias 매칭 후 이상치 판정
    rows = []
    for gn, gold_nos in gold_law_arts.items():
        # 매칭되는 corpus alias 찾기(가장 조문 많은 것 우선 = 본법 우선)
        cands = [a for a in corpus_aliases if law_matches(gn, a)]
        if not cands:
            continue                       # corpus에 없음 = 구법/약칭 → 여기 대상 아님
        a = max(cands, key=lambda x: len(corpus_arts[x]))
        c_nos = corpus_arts[a]
        gold_max, c_max = max(gold_nos), max(c_nos)
        c_cnt = len(c_nos)
        occupancy = c_cnt / c_max if c_max else 0.0     # 점유율(구멍 지표)
        # 의심 신호
        sigA = gold_max > c_max                          # 인용 최대조문 > corpus 최대조문
        sigB = c_cnt < len(gold_nos)                     # corpus 조문수 < gold 고유 조문수
        sigC = (c_max >= 20 and occupancy < 0.3)         # 큰 법인데 점유율 매우 낮음
        suspicion = (3 if sigA else 0) + (2 if sigB else 0) + (1 if sigC else 0)
        if suspicion > 0:
            rows.append({
                "law_norm": gn, "corpus_name": corpus_name.get(a, a),
                "corpus_article_count": c_cnt, "corpus_max_article": c_max,
                "gold_max_article": gold_max, "gold_unique_arts": len(gold_nos),
                "occupancy": round(occupancy, 3),
                "sig_goldmax>corpusmax": sigA, "sig_corpus<gold": sigB,
                "sig_low_occupancy": sigC, "suspicion": suspicion,
            })

    df = pd.DataFrame(rows).sort_values(["suspicion","gold_unique_arts"],
                                        ascending=[False, False])
    df.to_csv(OUTPUT_DIR / "suspect_laws.csv", index=False)

    print("\n" + "="*78)
    print("임베더 조문 누락 의심 법령 (suspicion 높을수록 재임베딩 가치 큼)")
    print("="*78)
    print(f"의심 법령 수: {len(df):,}\n")
    print(f"{'법령':<28}{'corpus조문':>9}{'corpus최대':>9}{'gold최대':>8}{'점유율':>7}{'의심':>5}")
    print("-"*78)
    for _, r in df.head(30).iterrows():
        print(f"{r['corpus_name'][:27]:<28}{r['corpus_article_count']:>9}"
              f"{r['corpus_max_article']:>9}{r['gold_max_article']:>8}"
              f"{r['occupancy']:>7.2f}{r['suspicion']:>5}")

    print("\n" + "-"*78)
    print("해석:")
    print("• sig_goldmax>corpusmax(가장 강함): 정답은 큰 조문을 인용하는데 corpus 최대 조문이")
    print("  훨씬 작음 → 임베더가 뒷부분을 통째로 누락(예: 지방자치법 corpus 2개).")
    print("• 점유율(occupancy) 낮음 + 큰 법: 조문 번호에 구멍이 많음 → 파싱 실패 의심.")
    print("• suspicion 상위 법들을 law_documents에서 raw_content 길이/내용 확인 후 재임베딩.")
    print(f"\n✅ 저장 → {OUTPUT_DIR}/suspect_laws.csv")

if __name__ == "__main__":
    main()