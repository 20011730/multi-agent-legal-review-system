"""
법령 청킹 점검기 (dry-run — 임베딩/Chroma 적재 안 함)   [v4, clean_text 반영]
===========================================================================
`embed_laws_hierarchical.py`(v4)가 raw_content를 어떻게 chunk로 만드는지
실제 임베딩 전에 눈으로 확인하기 위한 도구.
구역 분리(본문/부칙), 조문 파싱, clean_text 정리, 512토큰 분할을 그대로 보여준다.

모델 가중치는 안 띄우고 토크나이저만 로드 → 빠름.

청킹 어떻게 되는지 눈으로 확인하는 코드!

사용법
------
PostgreSQL에서 법령 몇 건의 raw_content를 가져와 청킹을 출력한다.
   - INSPECT_N   : 볼 법령 수 (기본 10)
   - SELECT_MODE : "random"(시드 고정·대표성) | "first"(id순) | "longest"(긴 법령)
   - WHERE_SQL   : 필터, 예) "reference_id = '284651'" 또는 "title LIKE '%민법%'"
   - RAW_PREVIEW : 원문 vs chunk 대조용으로 raw_content 앞부분 출력 글자 수
   - DUMP_CSV    : chunk 한 줄씩 CSV로 저장(엑셀 점검용)

주의: 아래 파싱/청킹/clean_text 함수는 v4 임베더에서 그대로 복사한 것이다.
임베더의 청킹을 바꾸면 여기도 똑같이 복사해 정합성을 유지할 것.

현재 : 이미지테그 제거함.
"""

from __future__ import annotations

import re
import csv
from types import SimpleNamespace

# ═════════════════════════════════════════════════════════════════════════════
# 설정
# ═════════════════════════════════════════════════════════════════════════════
PG_CONFIG   = {"dbname": "legalreview", "user": "legalreview",
               "password": "legalreview", "host": "localhost", "port": "5432"}
MODEL_NAME  = "intfloat/multilingual-e5-base"

INSPECT_N   = 10              # 가져와서 점검할 법령 수
SELECT_MODE = "random"        # "random" | "first" | "longest"
RANDOM_SEED = 0.42            # "random" 재현용 시드
WHERE_SQL   = ""              # 예) "reference_id = '284651'"  /  "title LIKE '%민법%'"
RAW_PREVIEW = 200             # raw_content 미리보기 글자 수(0이면 끔)
PREVIEW     = 90              # chunk 텍스트 미리보기 글자 수
DUMP_CSV    = "chunk_inspection.csv"   # ""이면 CSV 저장 끔

MAX_TOKENS, SAFETY = 512, 12
TOKEN_BUDGET   = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40

# ═════════════════════════════════════════════════════════════════════════════
# 토큰 카운터 (토크나이저만 — 임베더의 n_tokens와 동일하게 동작)
# ═════════════════════════════════════════════════════════════════════════════
class TokenCounter:
    def __init__(self, name=MODEL_NAME):
        from transformers import AutoTokenizer
        print(f"토크나이저 로드: {name} ...")
        self.model = SimpleNamespace(tokenizer=AutoTokenizer.from_pretrained(name))
    def n_tokens(self, text: str) -> int:
        return len(self.model.tokenizer.encode(f"passage: {text}"))

# ═════════════════════════════════════════════════════════════════════════════
# 본문 정리 + 파싱 + 청킹  (v4 임베더에서 그대로 복사)
# ═════════════════════════════════════════════════════════════════════════════
def clean_text(s: str) -> str:
    """조문 body 정리: <img>·태그 제거(내부 텍스트 보존), <개정 ...> 제거, 공백 정리."""
    s = re.sub(r"</?img[^>]*>", " ", s)
    s = re.sub(r"<[^>]*>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

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
# 점검 출력
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
    if RAW_PREVIEW:
        print("  raw: " + repr(re.sub(r"\s+", " ", raw)[:RAW_PREVIEW]))
    print("  sections: " + "  |  ".join(sec_summary))
    print("─"*100)

    used, n_chunks, n_split, max_tok = set(), 0, 0, 0
    def uid(base):
        if base not in used: used.add(base); return base
        k = 2
        while f"{base}_{k}" in used: k += 1
        nid = f"{base}_{k}"; used.add(nid); return nid

    for sec, aid, ordn, no, atitle, body in parsed:
        body = clean_text(body)                 # ★ 임베더와 동일하게 정리 후 청킹
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
          + ("  ‼ 한도 초과 chunk 있음!" if max_tok > TOKEN_BUDGET else "  ✓ 모두 한도 이내"))
    return n_art, n_chunks


def main():
    import psycopg2
    ef = TokenCounter()
    csv_rows = []
    tot_art = tot_chunk = 0

    conn = psycopg2.connect(**PG_CONFIG); cur = conn.cursor()
    where = f"WHERE {WHERE_SQL}" if WHERE_SQL else ""
    if SELECT_MODE == "random":
        cur.execute("SELECT setseed(%s);", (RANDOM_SEED,))   # 재현 가능한 랜덤
        order = "ORDER BY random()"
    elif SELECT_MODE == "longest":
        order = "ORDER BY length(raw_content) DESC"
    else:  # "first"
        order = "ORDER BY id ASC"
    cur.execute(f"""
        SELECT id, reference_id, title, raw_content
        FROM public.law_documents {where}
        {order} LIMIT {INSPECT_N};
    """)
    rows = cur.fetchall(); cur.close(); conn.close()
    if not rows:
        print("⚠️ 조건에 맞는 법령이 없습니다. WHERE_SQL을 확인하세요.")
        return

    print(f"가져온 법령 {len(rows)}건  (mode={SELECT_MODE}"
          + (f", where: {WHERE_SQL}" if WHERE_SQL else "") + ")")
    for rid, ref, title, raw in rows:
        a, c = inspect_law(ef, rid, ref, title, raw or "", csv_rows)
        tot_art += a; tot_chunk += c

    print("\n" + "═"*100)
    print(f"전체  법령={len(rows)}  조문={tot_art}  chunk={tot_chunk}  "
          f"ratio={tot_chunk/max(tot_art,1):.3f}")
    if DUMP_CSV and csv_rows:
        with open(DUMP_CSV, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
            w.writeheader(); w.writerows(csv_rows)
        print(f"chunk 단위 CSV → {DUMP_CSV}  ({len(csv_rows)}행)")

if __name__ == "__main__":
    main()