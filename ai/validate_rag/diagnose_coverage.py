"""
법조항 coverage 진단 v2 — 파서 보강 전/후 회복폭 측정
====================================================
보강 내용:
  (1) [N] 쟁점번호 표지 제거           예: '[1] 헌법' → '헌법'(→ 대한민국헌법 매칭)
  (2) 괄호(닫힘/안닫힘) 이후 제거 + 구법 'A(...B)' 정리
  (3) '같은 법 / 동법(시행령)' 상대참조를 직전 모법으로 해소
  (4) 조문 매칭 일관화(양측 canonical_article)
또한 article_missing_in_law(법은 있는데 조문이 없음)이 '임베더 누락'인지
'매칭 글리치'인지 가리기 위해, 해당 법령이 corpus에 실제로 가진 조문 목록을 probe한다.

출력: 기존(old) vs 보강(new) coverage 나란히 + 보강 후 원인별 분포 + 회복 내역.
산출물(./coverage_diag_v2/): summary.txt, recovered.csv, still_missing.csv
"""

import re
import difflib
import logging
from collections import defaultdict, Counter
from functools import lru_cache
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
OUTPUT_DIR      = Path("./coverage_diag_v2")

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("diag2")

ARTICLE_RE   = re.compile(r"제\s*\d+\s*조(?:\s*의\s*\d+)?")
LAW_KEYWORDS = ("법", "령", "규칙", "헌법", "법률", "특별법", "조약", "규정")
REL_RE       = re.compile(r"(같은\s*법|동\s*법)")

def canonical_article(s):
    m = ARTICLE_RE.search(s or "")
    return re.sub(r"\s+", "", m.group(0)) if m else None

def norm_law(s):
    s = re.sub(r"\([^)]*\)", "", s or "")
    s = re.sub(r"^\s*구\s+", "", s)
    return re.sub(r"\s+", "", s)

def law_matches(glaw, aliases):
    g = norm_law(glaw)
    if not g:
        return False
    return any(a and (g == a or a.endswith(g) or g.endswith(a)) for a in aliases)

# ── 기존(old) 파서 ───────────────────────────────────────────────────────────
def _clean_old(name):
    name = re.sub(r"\([^)]*\)", "", name)
    name = re.sub(r"부\s*칙", "", name)
    name = re.sub(r"^\s*구\s+", "", name)
    return re.sub(r"\s+", " ", name).strip()

def parse_old(ref):
    if not ref or not ref.strip():
        return set()
    items = [it.strip() for it in ref.replace("/", ",").split(",") if it.strip()]
    out, law, sec = set(), None, "MAIN"
    for it in items:
        arts = list(ARTICLE_RE.finditer(it))
        if arts:
            prefix = it[:arts[0].start()].strip()
            if prefix and any(k in prefix for k in LAW_KEYWORDS):
                sec = "ADDENDA" if "부칙" in prefix else "MAIN"; law = _clean_old(prefix)
            elif "부칙" in it:
                sec = "ADDENDA"
            for m in arts:
                if law:
                    out.add((law, sec, re.sub(r"\s+","",m.group(0))))
        elif "부칙" in it:
            sec = "ADDENDA"
        elif any(k in it for k in LAW_KEYWORDS):
            sec, law = "MAIN", _clean_old(it)
    return out

# ── 보강(new) 파서 ───────────────────────────────────────────────────────────
def strip_markers(ref):
    ref = re.sub(r"\[\s*\d+\s*\]", " ", ref)
    return re.sub(r"\s+", " ", ref).strip()

def _clean_new(name):
    name = name.split("(")[0]
    name = re.sub(r"부\s*칙", "", name)
    name = re.sub(r"^\s*구\s+", "", name)
    return re.sub(r"\s+", " ", name).strip()

def base_of(law):
    return re.sub(r"\s*시행(령|규칙)\s*$", "", law).strip()

def parse_new(ref):
    if not ref or not ref.strip():
        return set()
    ref = strip_markers(ref)
    items = [it.strip() for it in ref.replace("/", ",").split(",") if it.strip()]
    out, law, sec, last_base = set(), None, "MAIN", None
    for it in items:
        arts = list(ARTICLE_RE.finditer(it))
        prefix = it[:arts[0].start()].strip() if arts else it
        has_kw = any(k in prefix for k in LAW_KEYWORDS)
        is_rel = REL_RE.search(prefix) is not None
        if is_rel and last_base:
            suffix = "시행령" if "시행령" in prefix else ("시행규칙" if "시행규칙" in prefix else "")
            law = (last_base + (" " + suffix if suffix else "")).strip()
            sec = "ADDENDA" if "부칙" in prefix else "MAIN"
        elif arts and has_kw:
            sec = "ADDENDA" if "부칙" in prefix else "MAIN"
            law = _clean_new(prefix); last_base = base_of(law)
        elif "부칙" in it and arts:
            sec = "ADDENDA"
        elif has_kw and not arts:
            sec = "MAIN"; law = _clean_new(it); last_base = base_of(law)
        for m in arts:
            if law:
                out.add((law, sec, re.sub(r"\s+","",m.group(0))))
    return out

# ── 데이터 ───────────────────────────────────────────────────────────────────
def load_refs(pg):
    if USE_SAMPLE:
        sql = """SELECT d.ref_rules FROM eval_sample s
                 JOIN eval_dataset d ON s.eval_id=d.eval_id
                 WHERE COALESCE(d.qa_question,'')<>'' AND COALESCE(d.ref_rules,'')<>''"""
    else:
        sql = """SELECT ref_rules FROM eval_dataset
                 WHERE COALESCE(qa_question,'')<>'' AND COALESCE(ref_rules,'')<>''"""
    return pd.read_sql(sql, pg)["ref_rules"].tolist()

def build_corpus(collection):
    article_index = defaultdict(list)        # 조문 -> [(aliases, section)]
    corpus_alias_set = set()
    law_articles = defaultdict(set)          # alias -> {조문}
    total = collection.count(); off, page = 0, 10_000
    pbar = tqdm(total=total, desc="corpus 인덱싱")
    while off < total:
        got = collection.get(include=["metadatas"], limit=page, offset=off)
        metas = got["metadatas"] or []
        for md in metas:
            al = {norm_law(md.get("title","")), norm_law(md.get("shortName",""))} - {""}
            corpus_alias_set |= al
            art = canonical_article(md.get("articleNo",""))
            if art:
                fa = frozenset(al)
                article_index[art].append((fa, md.get("section","MAIN")))
                for a in al:
                    law_articles[a].add(art)
        off += page; pbar.update(len(metas))
        if not metas:
            break
    pbar.close()
    return article_index, corpus_alias_set, law_articles

# ── 분류기 ───────────────────────────────────────────────────────────────────
def make_classifier(article_index, corpus_alias_set, law_articles):
    alias_list = sorted(corpus_alias_set)

    @lru_cache(maxsize=None)
    def law_present(gn):
        if not gn:
            return False
        if gn in corpus_alias_set:
            return True
        return any(a.endswith(gn) or gn.endswith(a) for a in corpus_alias_set)

    @lru_cache(maxsize=None)
    def matched_alias(gn):
        """glaw(norm)와 매칭되는 corpus alias 하나(probe용)."""
        for a in corpus_alias_set:
            if a == gn or a.endswith(gn) or gn.endswith(a):
                return a
        return None

    @lru_cache(maxsize=None)
    def nearest(gn):
        return " | ".join(difflib.get_close_matches(gn, alias_list, n=3, cutoff=0.6))

    def classify(glaw, gsec, gart):
        entries = article_index.get(gart, [])
        lm = [(al, sec) for (al, sec) in entries if law_matches(glaw, al)]
        if any(sec == gsec for (_, sec) in lm):
            return "COVERED", ""
        if lm:
            return "section_mismatch", ""
        gn = norm_law(glaw)
        if law_present(gn):
            a = matched_alias(gn)
            n_art = len(law_articles.get(a, ()))
            return "article_missing_in_law", f"법존재({a},조문{n_art}개)"
        if "시행령" in glaw or "시행규칙" in glaw or glaw.endswith("규칙"):
            return "law_absent_시행령규칙", nearest(gn)
        return "law_absent_기타", nearest(gn)

    return classify

# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = []
    def out(s=""):
        print(s); lines.append(s)

    pg = psycopg2.connect(**PG_CONFIG)
    refs = load_refs(pg); pg.close()
    log.info("질의 수: %s", f"{len(refs):,}")

    log.info("ChromaDB `%s` 연결/인덱싱 ...", COLLECTION_NAME)
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    article_index, corpus_alias_set, law_articles = build_corpus(collection)
    classify = make_classifier(article_index, corpus_alias_set, law_articles)

    # old / new 파서 각각 gold 빈도 집계
    gold_old, gold_new = Counter(), Counter()
    for ref in refs:
        for p in parse_old(ref):
            gold_old[p] += 1
        for p in parse_new(ref):
            gold_new[p] += 1

    def coverage(gold_counts):
        ru, ri = Counter(), Counter()
        recs = []
        for (glaw, gsec, gart), f in gold_counts.items():
            reason, hint = classify(glaw, gsec, gart)
            ru[reason] += 1; ri[reason] += f
            recs.append((glaw, gsec, gart, reason, f, hint))
        u = sum(ru.values()); i = sum(ri.values())
        return ru, ri, recs, ru["COVERED"]/u, ri["COVERED"]/i

    ru_o, ri_o, _, covu_o, covi_o = coverage(gold_old)
    ru_n, ri_n, recs_n, covu_n, covi_n = coverage(gold_new)

    out("\n" + "="*72)
    out("coverage: 기존 파서(old) vs 보강 파서(new)")
    out("="*72)
    out(f"{'':16}{'고유 coverage':>18}{'인스턴스 coverage':>20}")
    out(f"{'old':16}{covu_o*100:>16.1f}%{covi_o*100:>18.1f}%")
    out(f"{'new':16}{covu_n*100:>16.1f}%{covi_n*100:>18.1f}%")
    out(f"{'회복폭':16}{(covu_n-covu_o)*100:>+16.1f}%{(covi_n-covi_o)*100:>+18.1f}%")

    out("\n보강 파서(new) 원인별 분포")
    out("-"*72)
    tot_u = sum(ru_n.values()); tot_i = sum(ri_n.values())
    order = ["COVERED","section_mismatch","article_missing_in_law",
             "law_absent_시행령규칙","law_absent_기타"]
    out(f"{'원인':<26}{'고유수':>10}{'고유%':>9}{'인스턴스':>12}{'인스턴스%':>11}")
    for r in order:
        u, i = ru_n.get(r,0), ri_n.get(r,0)
        out(f"{r:<26}{u:>10,}{u/tot_u*100:>8.1f}%{i:>12,}{i/tot_i*100:>10.1f}%")

    # 보강으로 새로 COVERED 된 항목 / 여전히 누락
    miss = pd.DataFrame([r for r in recs_n if r[3] != "COVERED"],
                        columns=["law","section","article","reason","freq","hint"])
    miss.sort_values("freq", ascending=False).to_csv(
        OUTPUT_DIR / "still_missing.csv", index=False)

    out("\n" + "-"*72)
    out("보강 후에도 남은 누락 Top 20 (인용 빈도순)")
    out("-"*72)
    by = (miss.groupby(["law","reason"], as_index=False)
              .agg(arts=("article","nunique"), inst=("freq","sum"), hint=("hint","first"))
              .sort_values("inst", ascending=False))
    for _, r in by.head(20).iterrows():
        h = f"  {r['hint']}" if r["hint"] else ""
        out(f"  [{r['reason']:<22}] {r['law'][:26]:<26} 조문{r['arts']:>3}/인용{r['inst']:>4}{h}")
    by.to_csv(OUTPUT_DIR / "still_missing_by_law.csv", index=False)

    out("\n" + "="*72)
    out("판단 가이드")
    out("="*72)
    out("• new coverage가 크게 오르면 → [N]/구법/같은법 파싱이 원인이었고, 이 파서를")
    out("  eval_statute_retrieval.py 에 이식하면 검색을 안 바꿔도 Recall/Hit가 오른다.")
    out("• 남은 article_missing_in_law 의 hint가 '법존재(...조문N개)'면, 그 법은 임베딩됐는데")
    out("  해당 조문만 없다는 뜻 → 임베더의 조문 파싱 누락 or 법 개정 전후 조문번호 차이.")
    out("• 남은 law_absent_기타 중 '구 ...' 폐지법은 현행 corpus에 없는 진짜 천장.")

    (OUTPUT_DIR / "summary.txt").write_text("\n".join(lines), encoding="utf-8")
    log.info("저장 → %s/", OUTPUT_DIR)

if __name__ == "__main__":
    main()