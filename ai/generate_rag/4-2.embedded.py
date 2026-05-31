"""
Law (법령) Embedding Pipeline  — hierarchical, section-aware, 512-token  [v3]
============================================================================
Embeds `law_documents.raw_content` into ChromaDB collection `laws`
(intfloat/multilingual-e5-base, "passage: " prefix).

v3 change — keep 부칙 instead of dropping it
-------------------------------------------
~4% of gold `ref_rules` cite 부칙(Addenda) articles, so we now KEEP them. The
problem 부칙 caused (article numbering restarts at 제1조, colliding with the body)
is solved by tagging each chunk with a SECTION and a 부칙 block id:

  section  = "MAIN" | "ADDENDA"
  addendaId / addendaOrd  distinguish multiple 부칙 blocks (one per amendment)

The matcher (eval side) compares on (law, SECTION, articleNo), so a body gold
"○○법 제1조" matches only the MAIN 제1조, never a 부칙 제1조. 별표/별지 are dropped.

chunk_id:  MAIN     → law_{ref}_제3조[#pN]
           ADDENDA  → law_{ref}_부칙{ord}_제1조[#pN]
A unique-id guard appends _2/_3 as a final safety net.

Hierarchy/oversized articles: split 항(①②)→호(1.)→token-window; sub-chunks share
articleNo/parentId so the evaluator (dedup by section+articleNo) treats them as one.
"""

from __future__ import annotations

import re
import logging

import psycopg2
import chromadb
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
from sentence_transformers import SentenceTransformer
import torch

# ═════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═════════════════════════════════════════════════════════════════════════════
DB_CONFIG = {
    "dbname": "legalreview", "user": "legalreview", "password": "legalreview",
    "host": "localhost", "port": "5432",
}
CHROMA_PATH     = "./chroma_data"
COLLECTION_NAME = "laws"
MODEL_NAME      = "intfloat/multilingual-e5-base"

MAX_TOKENS     = 512
SAFETY         = 12
TOKEN_BUDGET   = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40
ENCODE_BATCH   = 32
UPSERT_BATCH   = 128

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s | %(levelname)-7s | %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("law_embed")

# ═════════════════════════════════════════════════════════════════════════════
# EMBEDDING FUNCTION
# ═════════════════════════════════════════════════════════════════════════════
class E5EmbeddingFunction(EmbeddingFunction):
    def __init__(self, model_name: str = MODEL_NAME):
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
        log.info("Loading %s (device=%s)", model_name, device)
        self.model = SentenceTransformer(model_name, device=device)
        self.model.max_seq_length = MAX_TOKENS

    def __call__(self, input: Documents) -> Embeddings:
        return self.model.encode([f"passage: {d}" for d in input],
                                 normalize_embeddings=True,
                                 batch_size=ENCODE_BATCH).tolist()

    def n_tokens(self, text: str) -> int:
        return len(self.model.tokenizer.encode(f"passage: {text}"))

    def truncate_to_budget(self, text: str) -> str:
        if self.n_tokens(text) <= TOKEN_BUDGET:
            return text
        tok = self.model.tokenizer
        prefix_cost = len(tok.encode("passage: ", add_special_tokens=False)) + 2
        ids = tok.encode(text, add_special_tokens=False)[: TOKEN_BUDGET - prefix_cost]
        out = tok.decode(ids).strip()
        while out and self.n_tokens(out) > TOKEN_BUDGET:
            ids = ids[:-8]; out = tok.decode(ids).strip()
        return out

# ═════════════════════════════════════════════════════════════════════════════
# SECTION SPLIT + ARTICLE PARSE
# ═════════════════════════════════════════════════════════════════════════════
ART_HEADING         = re.compile(r"제\d+조(?:의\d+)?(?=\(|\s*삭제)")
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE           = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")
ADDENDA_HDR         = re.compile(r"부\s*칙\s*(<[^>]*>|\([^)]*시행[^)]*\))?")
BYEOLPYO            = re.compile(r"별\s*[표지]")
HANG_SPLIT          = re.compile(r"(?=[\u2460-\u2473])")   # ①..⑳
HO_SPLIT            = re.compile(r"(?=\s+\d+\.\s)")

def _addenda_id(header_text: str) -> str:
    m = re.search(r"제\s*\d+\s*호", header_text)
    return re.sub(r"\s+", "", m.group(0)) if m else ""

def split_sections(raw: str):
    """[(section, addendaId, addendaOrd, text)] — MAIN + each 부칙 block. 별표 dropped."""
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

def _parse_with(text: str, pattern):
    heads = [(m.start(), m.group(0)) for m in pattern.finditer(text)]
    out = []
    for i, (pos, no) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        seg = text[pos:end].strip()
        mt = ART_TITLE.match(seg)
        if mt:
            title, body = mt.group(1).strip(), seg[mt.end():].strip()
        else:
            title, body = "", seg[len(no):].strip()
        out.append({"articleNo": no, "title": title, "body": body})
    return out

def parse_law(raw: str):
    """-> [(section, addendaId, addendaOrd, articleNo, title, body)]"""
    result = []
    for sec, aid, ordn, text in split_sections(raw):
        arts = _parse_with(text, ART_HEADING)
        if not arts and sec == "MAIN":          # title-less old laws
            arts = _parse_with(text, ART_HEADING_LENIENT)
        for a in arts:
            result.append((sec, aid, ordn, a["articleNo"], a["title"], a["body"]))
    return result

# ═════════════════════════════════════════════════════════════════════════════
# CHUNKING
# ═════════════════════════════════════════════════════════════════════════════
def _window_split(ef, head, text):
    tok = ef.model.tokenizer
    head_cost = len(tok.encode(f"passage: {head} ", add_special_tokens=False))
    budget = max(TOKEN_BUDGET - head_cost, 64)
    ids = tok.encode(text, add_special_tokens=False)
    chunks, i = [], 0
    while i < len(ids):
        chunks.append(f"{head} {tok.decode(ids[i:i+budget]).strip()}".strip())
        if i + budget >= len(ids):
            break
        i += budget - WINDOW_OVERLAP
    return chunks

def _pack(ef, head, pieces):
    chunks, cur = [], head
    for p in pieces:
        cand = f"{cur} {p}".strip()
        if ef.n_tokens(cand) <= TOKEN_BUDGET:
            cur = cand; continue
        if cur != head:
            chunks.append(cur)
        start = f"{head} {p}".strip()
        if ef.n_tokens(start) <= TOKEN_BUDGET:
            cur = start
        else:
            chunks.extend(_window_split(ef, head, p)); cur = head
    if cur != head:
        chunks.append(cur)
    return chunks

def chunk_article(ef, no, title, body):
    head = f"{no}({title})" if title else no
    whole = f"{head} {body}".strip() if body else head
    if ef.n_tokens(whole) <= TOKEN_BUDGET:
        return [whole]
    hangs = [h.strip() for h in HANG_SPLIT.split(body) if h.strip()]
    if len(hangs) > 1:
        return _pack(ef, head, hangs)
    hos = [h.strip() for h in HO_SPLIT.split(body) if h.strip()]
    if len(hos) > 1:
        return _pack(ef, head, hos)
    return _window_split(ef, head, body)

# ═════════════════════════════════════════════════════════════════════════════
# CHROMA
# ═════════════════════════════════════════════════════════════════════════════
def reset_collection(ef):
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    try:
        client.delete_collection(COLLECTION_NAME)
        log.info("dropped existing `%s` collection", COLLECTION_NAME)
    except Exception:
        pass
    return client.create_collection(name=COLLECTION_NAME, embedding_function=ef,
                                    metadata={"hnsw:space": "cosine"})

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════
def run():
    ef = E5EmbeddingFunction()
    collection = reset_collection(ef)

    conn = psycopg2.connect(**DB_CONFIG); cur = conn.cursor()
    cur.execute("UPDATE public.law_documents SET chunked = false;"); conn.commit()
    cur.execute("""
        SELECT id, reference_id, title, short_name, department,
               enforce_date, revision_type, url, raw_content
        FROM public.law_documents WHERE chunked = false ORDER BY id ASC;
    """)
    rows = cur.fetchall()
    log.info("laws to process: %s", f"{len(rows):,}")

    used_ids: set[str] = set()
    buf_ids, buf_docs, buf_meta = [], [], []
    n_laws = n_main = n_add = n_chunks = n_empty = n_dup = 0

    def unique_id(base):
        nonlocal n_dup
        if base not in used_ids:
            used_ids.add(base); return base
        n_dup += 1; k = 2
        while f"{base}_{k}" in used_ids: k += 1
        nid = f"{base}_{k}"; used_ids.add(nid); return nid

    def flush():
        if buf_ids:
            collection.upsert(ids=buf_ids, documents=buf_docs, metadatas=buf_meta)
            buf_ids.clear(); buf_docs.clear(); buf_meta.clear()

    for idx, row in enumerate(rows, 1):
        (rid, reference_id, title, short_name, department,
         enforce_date, revision_type, url, raw_content) = row
        parsed = parse_law(raw_content)
        if not parsed:
            n_empty += 1
            log.warning("[%d/%d] no articles parsed: %s", idx, len(rows), title)
            continue

        for sec, aid, ordn, no, atitle, body in parsed:
            if sec == "MAIN":
                parent = f"law_{reference_id}_{no}"; n_main += 1
            else:
                parent = f"law_{reference_id}_부칙{ordn}_{no}"; n_add += 1
            chunks = chunk_article(ef, no, atitle, body)
            n_parts = len(chunks)
            for pi, text in enumerate(chunks):
                text = ef.truncate_to_budget(text)
                base = parent if n_parts == 1 else f"{parent}#p{pi+1}"
                buf_ids.append(unique_id(base))
                buf_docs.append(text)
                buf_meta.append({
                    "rowId": rid, "referenceId": str(reference_id),
                    "sourceType": "LAW",
                    "title": title or "", "shortName": short_name or "",
                    "articleNo": no, "articleTitle": atitle,
                    "section": sec,                 # MAIN | ADDENDA  ← 매칭 키
                    "addendaId": aid, "addendaOrd": ordn,
                    "parentId": parent, "partIndex": pi + 1, "nParts": n_parts,
                    "department": department or "",
                    "enforceDate": str(enforce_date) if enforce_date else "",
                    "revisionType": revision_type or "", "url": url or "",
                })
                n_chunks += 1
            if len(buf_ids) >= UPSERT_BATCH:
                flush()

        cur.execute("UPDATE public.law_documents SET chunked=true, updated_at=NOW() "
                    "WHERE id=%s;", (rid,)); conn.commit()
        n_laws += 1
        if idx % 50 == 0 or idx == len(rows):
            log.info("[%d/%d] laws=%s main_art=%s addenda_art=%s chunks=%s dup=%s",
                     idx, len(rows), f"{n_laws:,}", f"{n_main:,}",
                     f"{n_add:,}", f"{n_chunks:,}", f"{n_dup:,}")

    flush(); cur.close(); conn.close()
    log.info("DONE laws=%s main_art=%s addenda_art=%s chunks=%s empty=%s dup_fixed=%s",
             f"{n_laws:,}", f"{n_main:,}", f"{n_add:,}", f"{n_chunks:,}",
             f"{n_empty:,}", f"{n_dup:,}")

if __name__ == "__main__":
    run()