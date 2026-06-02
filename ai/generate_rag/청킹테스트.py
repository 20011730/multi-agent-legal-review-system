"""
Law Chunking Inspector  (dry-run, NO embedding, NO Chroma writes)
=================================================================
법 조항 크로마 db에 넣기 전에 잘 청킹되는지 확인하는 코드
Shows exactly how `embed_laws_hierarchical.py` (v3) turns raw_content into chunks,
so you can eyeball section split (MAIN/부칙), article parsing, and 512-token
splitting BEFORE running the real embedder.

Only the tokenizer is loaded (not the full model) → fast.

Usage
-----
1) DB mode (default): inspect a few laws from PostgreSQL.
   - INSPECT_N            : how many laws to show
   - WHERE_SQL            : optional filter, e.g. "reference_id = '284651'"
                            or "title LIKE '%민법%'"
2) Sample mode: set USE_DB=False to use the built-in sample (no DB needed).
3) DUMP_CSV path: also write one row per chunk for bulk inspection.

NOTE: parsing/chunking functions below are COPIED VERBATIM from the v3 embedder.
If you change chunking there, copy the changes here to keep parity.
"""

from __future__ import annotations

import re
import csv
from types import SimpleNamespace

# ═════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═════════════════════════════════════════════════════════════════════════════
USE_DB     = True
PG_CONFIG  = {"dbname": "legalreview", "user": "legalreview",
              "password": "legalreview", "host": "localhost", "port": "5432"}
MODEL_NAME = "intfloat/multilingual-e5-base"

INSPECT_N  = 5                # how many laws to print (DB mode)
WHERE_SQL  = ""               # e.g. "reference_id = '284651'"  /  "title LIKE '%민법%'"
PREVIEW    = 90               # chars of chunk text to preview
DUMP_CSV   = "chunk_inspection.csv"   # set "" to disable

MAX_TOKENS, SAFETY = 512, 12
TOKEN_BUDGET   = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40

# ═════════════════════════════════════════════════════════════════════════════
# TOKEN COUNTER (tokenizer only — mirrors the embedder's n_tokens exactly)
# ═════════════════════════════════════════════════════════════════════════════
class TokenCounter:
    def __init__(self, name=MODEL_NAME):
        from transformers import AutoTokenizer
        print(f"loading tokenizer: {name} ...")
        self.model = SimpleNamespace(tokenizer=AutoTokenizer.from_pretrained(name))
    def n_tokens(self, text: str) -> int:
        return len(self.model.tokenizer.encode(f"passage: {text}"))

# ═════════════════════════════════════════════════════════════════════════════
# PARSING + CHUNKING  (verbatim from embed_laws_hierarchical.py v3)
# ═════════════════════════════════════════════════════════════════════════════
ART_HEADING         = re.compile(r"제\d+조(?:의\d+)?(?=\(|\s*삭제)")
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE           = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")
ADDENDA_HDR         = re.compile(r"부\s*칙\s*(<[^>]*>|\([^)]*시행[^)]*\))?")
BYEOLPYO            = re.compile(r"별\s*[표지]")
HANG_SPLIT          = re.compile(r"(?=[\u2460-\u2473])")
HO_SPLIT            = re.compile(r"(?=\s+\d+\.\s)")

def _addenda_id(h):
    m = re.search(r"제\s*\d+\s*호", h)
    return re.sub(r"\s+", "", m.group(0)) if m else ""

def split_sections(raw):
    addenda = list(ADDENDA_HDR.finditer(raw))
    bp = BYEOLPYO.search(raw)
    bp_pos = bp.start() if bp else len(raw)
    end_main = min([a.start() for a in addenda] + [bp_pos]) if (addenda or bp) else len(raw)
    out = [("MAIN", "", 0, raw[:end_main])]
    for i, m in enumerate(addenda, 1):
        start = m.end()
        nexts = [a.start() for a in addenda[i:i+1]] + ([bp_pos] if bp_pos > start else [])
        end = min(nexts) if nexts else len(raw)
        out.append(("ADDENDA", _addenda_id(m.group(0)), i, raw[start:end]))
    return out

def _parse_with(text, pattern):
    heads = [(m.start(), m.group(0)) for m in pattern.finditer(text)]
    out = []
    for i, (pos, no) in enumerate(heads):
        end = heads[i+1][0] if i+1 < len(heads) else len(text)
        seg = text[pos:end].strip()
        mt = ART_TITLE.match(seg)
        if mt: title, body = mt.group(1).strip(), seg[mt.end():].strip()
        else:  title, body = "", seg[len(no):].strip()
        out.append({"articleNo": no, "title": title, "body": body})
    return out

def parse_law(raw):
    result = []
    for sec, aid, ordn, text in split_sections(raw):
        arts = _parse_with(text, ART_HEADING)
        if not arts and sec == "MAIN":
            arts = _parse_with(text, ART_HEADING_LENIENT)
        for a in arts:
            result.append((sec, aid, ordn, a["articleNo"], a["title"], a["body"]))
    return result

def _window_split(ef, head, text):
    tok = ef.model.tokenizer
    head_cost = len(tok.encode(f"passage: {head} ", add_special_tokens=False))
    budget = max(TOKEN_BUDGET - head_cost, 64)
    ids = tok.encode(text, add_special_tokens=False)
    chunks, i = [], 0
    while i < len(ids):
        chunks.append(f"{head} {tok.decode(ids[i:i+budget]).strip()}".strip())
        if i + budget >= len(ids): break
        i += budget - WINDOW_OVERLAP
    return chunks

def _pack(ef, head, pieces):
    chunks, cur = [], head
    for p in pieces:
        cand = f"{cur} {p}".strip()
        if ef.n_tokens(cand) <= TOKEN_BUDGET: cur = cand; continue
        if cur != head: chunks.append(cur)
        start = f"{head} {p}".strip()
        if ef.n_tokens(start) <= TOKEN_BUDGET: cur = start
        else: chunks.extend(_window_split(ef, head, p)); cur = head
    if cur != head: chunks.append(cur)
    return chunks

def chunk_article(ef, no, title, body):
    head = f"{no}({title})" if title else no
    whole = f"{head} {body}".strip() if body else head
    if ef.n_tokens(whole) <= TOKEN_BUDGET: return [whole]
    hangs = [h.strip() for h in HANG_SPLIT.split(body) if h.strip()]
    if len(hangs) > 1: return _pack(ef, head, hangs)
    hos = [h.strip() for h in HO_SPLIT.split(body) if h.strip()]
    if len(hos) > 1: return _pack(ef, head, hos)
    return _window_split(ef, head, body)

# ═════════════════════════════════════════════════════════════════════════════
# INSPECTION
# ═════════════════════════════════════════════════════════════════════════════
def inspect_law(ef, rid, reference_id, title, raw, csv_rows):
    parsed = parse_law(raw)
    secs = split_sections(raw)
    sec_summary = []
    for s, aid, ordn, _ in secs:
        cnt = sum(1 for p in parsed if p[0] == s and p[2] == ordn)
        tag = "MAIN" if s == "MAIN" else f"ADDENDA#{ordn}{('·'+aid) if aid else ''}"
        sec_summary.append(f"{tag}({cnt}art)")

    print("\n" + "═"*100)
    print(f"[id={rid} ref={reference_id}] {title}   (raw {len(raw):,} chars)")
    print("  sections: " + "  |  ".join(sec_summary))
    print("─"*100)

    used, n_chunks, n_split, max_tok = set(), 0, 0, 0
    def uid(base):
        if base not in used: used.add(base); return base
        k = 2
        while f"{base}_{k}" in used: k += 1
        nid = f"{base}_{k}"; used.add(nid); return nid

    for sec, aid, ordn, no, atitle, body in parsed:
        parent = (f"law_{reference_id}_{no}" if sec == "MAIN"
                  else f"law_{reference_id}_부칙{ordn}_{no}")
        whole_tok = ef.n_tokens((f"{no}({atitle})" if atitle else no) + " " + body)
        chunks = chunk_article(ef, no, atitle, body)
        np_ = len(chunks)
        if np_ > 1: n_split += 1
        flag = f"  ⚠SPLIT×{np_}" if np_ > 1 else ""
        sectag = "MAIN   " if sec == "MAIN" else f"부칙{ordn}  "
        print(f"  {sectag} {no:9} ({atitle[:22]:<22}) body={len(body):>5}c "
              f"whole≈{whole_tok:>4}tok → {np_} chunk{flag}")
        for pi, text in enumerate(chunks):
            tok = ef.n_tokens(text)
            max_tok = max(max_tok, tok)
            cid = uid(parent if np_ == 1 else f"{parent}#p{pi+1}")
            over = "  ‼OVER" if tok > TOKEN_BUDGET else ""
            preview = re.sub(r"\s+", " ", text)[:PREVIEW]
            print(f"        └ {cid:38} {tok:>4}tok{over}  {preview!r}")
            n_chunks += 1
            csv_rows.append({
                "law_id": rid, "reference_id": reference_id, "title": title,
                "section": sec, "addendaOrd": ordn, "addendaId": aid,
                "articleNo": no, "articleTitle": atitle,
                "chunk_id": cid, "part": f"{pi+1}/{np_}", "n_tokens": tok,
                "text": text,
            })

    n_art = len(parsed)
    print("─"*100)
    print(f"  ▶ articles={n_art}  chunks={n_chunks}  ratio={n_chunks/max(n_art,1):.2f}  "
          f"split_articles={n_split}  max_chunk_tokens={max_tok}"
          + ("  ‼ some chunk exceeded budget!" if max_tok > TOKEN_BUDGET else "  ✓ all within budget"))
    return n_art, n_chunks

SAMPLE = ("[법령] 10ㆍ27법난 피해자의 명예회복 등에 관한 법률 (MST=253527)소관부처: 문화체육관광부시행일: 20230808"
 "제1조(목적) 이 법은 10ㆍ27법난과 관련하여 피해를 입은 사람과 불교계의 명예를 회복시켜줌으로써 인권신장과 국민화합에 이바지함을 목적으로 한다. <개정 2023.8.8>"
 "제2조(정의) 이 법에서 사용하는 용어의 정의는 다음과 같다. <개정 2023.8.8>"
 "제3조(피해자 및 피해종교단체의 명예회복)  ① 피해자 또는 피해종교단체(이하\"피해자등\"이라 한다)의 명예회복에 관한 사항을 심의ㆍ의결하기 위하여 문화체육관광부장관 소속으로 10ㆍ27법난피해자명예회복심의위원회(이하 \"위원회\"라 한다)를 둔다. <개정 2016.2.3>  ② 위원회는 다음 각 호의 사항을 심의ㆍ의결한다. <개정 2013.5.22, 2016.2.3>    1.  삭제 <2016.2.3>    2.  피해자등의 명예회복에 관한 사항    3.  피해자에 대한 의료지원금 지급에 관한 사항    4.  10ㆍ27법난 기념관 건립에 관한 사항    5.  그 밖에 피해자등의 명예회복과 관련하여 대통령령으로 정하는 지원에 관한 사항  ③ 위원회는 위원장을 포함한 11인 이내의 위원으로 구성한다.  ④ 위원은 학식과 경험이 풍부한 사람과 관계 공무원 중에서 대통령령으로 정하는 바에 따라 문화체육관광부장관이 위촉 또는 임명하고, 위원장은 위원 중에서 호선한다. <개정 2016.2.3, 2023.8.8>  ⑤ 그 밖에 위원회의 조직ㆍ운영에 필요한 사항은 대통령령으로 정한다."
 "제3조의2(벌칙 적용에서 공무원 의제) 위원회의 위원 중 공무원이 아닌 사람은 「형법」 제127조 및 제129조부터 제132조까지의 규정을 적용할 때에는 공무원으로 본다."
 "제4조 삭제 <2016.2.3>"
 "제5조(의료지원금)  ① 10ㆍ27법난으로 인하여 부상 및 장애를 입은 사람 중에서 이 법 시행 당시 그 부상 및 장애로 인하여 계속적인 치료가 필요하거나 상시 간병 또는 보조장구의 사용이 필요한 사람에게는 비용을 일시에 지급한다.  ② 제1항에 따라 의료지원금을 지급하는 때에는 중간이자를 공제한다."
 "부칙 <법률 제18651호, 2023.8.8>제1조(시행일) 이 법은 공포한 날부터 시행한다.제2조(경과조치) 종전의 규정에 따른다."
 "부칙 <법률 제19000호, 2024.1.1>제1조(시행일) 이 법은 공포 후 6개월이 경과한 날부터 시행한다."
 "별표 1 의료지원금 산정기준 ...")

def main():
    ef = TokenCounter()
    csv_rows = []
    tot_art = tot_chunk = 0

    if USE_DB:
        import psycopg2
        conn = psycopg2.connect(**PG_CONFIG); cur = conn.cursor()
        where = f"WHERE {WHERE_SQL}" if WHERE_SQL else ""
        cur.execute(f"""
            SELECT id, reference_id, title, raw_content
            FROM public.law_documents {where}
            ORDER BY id ASC LIMIT {INSPECT_N};
        """)
        rows = cur.fetchall(); cur.close(); conn.close()
        if not rows:
            print("⚠️ 조건에 맞는 법령이 없습니다. WHERE_SQL을 확인하세요.")
            return
        for rid, ref, title, raw in rows:
            a, c = inspect_law(ef, rid, ref, title, raw or "", csv_rows)
            tot_art += a; tot_chunk += c
    else:
        a, c = inspect_law(ef, 0, "253527",
                           "10ㆍ27법난 피해자의 명예회복 등에 관한 법률", SAMPLE, csv_rows)
        tot_art += a; tot_chunk += c

    print("\n" + "═"*100)
    print(f"TOTAL  articles={tot_art}  chunks={tot_chunk}  "
          f"ratio={tot_chunk/max(tot_art,1):.3f}")
    if DUMP_CSV and csv_rows:
        with open(DUMP_CSV, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
            w.writeheader(); w.writerows(csv_rows)
        print(f"chunk-level CSV → {DUMP_CSV}  ({len(csv_rows)} rows)")

if __name__ == "__main__":
    main()