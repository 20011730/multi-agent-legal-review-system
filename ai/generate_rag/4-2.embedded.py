
from __future__ import annotations

"""
법령(法令) 임베딩 파이프라인 — 계층 구조 + 512토큰 + 본문 정리   [v5]
====================================================================
v4 → v5 변경점 (조문 누락 버그 수정)
-----------------------------------
원인: split_sections()의 별표/부칙 헤더 정규식이 '본문 속 평범한 단어'에 오탐하여
      본문(MAIN)을 앞부분에서 통째로 잘라냈다.
  - BYEOLPYO  : '별' + '표/지' 만 보던 패턴이 "특별지방", "개별지역"의 '별지'에 매칭(!)
                 예: 지방자치법이 508자에서 잘려 조문 214개 중 2개만 임베딩됨.
  - ADDENDA_HDR 도 '종전의 부칙 제2조' 같은 본문 참조에 오탐할 위험.
수정:
  - BYEOLPYO  : 줄 시작(또는 '[') + '별표/별지' + 번호/서식/'제N호' 가 따라오는
                '진짜 첨부 헤더'만 인식. 본문 단어("특별지방" 등) 제외.
  - ADDENDA_HDR: 줄 시작 + '부칙' + <...> 또는 (…시행…/법률 제…호) 메타가
                '반드시' 있는 경우만. 본문 속 '부칙' 단어 참조 제외.
  - ART_HEADING: '제N조(...)' 중 괄호 안이 편제(제M장/절/관/편)면 제외하여
                "제1조 제1장 총강(總綱)" 같은 편제 표기를 조문으로 오인하지 않음.
그 외(clean_text, 청킹, chunk_id, 부칙 ordn, metadata)는 v4와 동일.

※ 재임베딩 전 확인: 이 버그로 corpus 전체가 부분 임베딩(과거 chunk≈13만)되었으므로
   반드시 reset 후 전체 재임베딩한다.
"""
"""
법령(法令) 임베딩 파이프라인 — 계층 구조 + 512토큰 + 본문 정리   [v4]
====================================================================
`law_documents.raw_content`를 "조문 단위"로 잘라 ChromaDB의 `laws` 컬렉션에
임베딩한다(intfloat/multilingual-e5-base, "passage: " 접두사).

v4 변경점 — clean_text()로 본문 정리 후 임베딩
---------------------------------------------
일부 조문에는 수식이 <img src="..."> 태그로 들어 있고, 그 주변 텍스트에
과도한 공백·줄바꿈·탭이 섞여 있다(공백이 본문의 40%에 달하는 경우도 있음).
그대로 임베딩하면 (1) URL 등 노이즈가 섞이고 (2) 공백이 토큰을 낭비해 불필요한
분할을 유발한다. 따라서 조문 body에 clean_text()를 적용해
  - <img ...>·</img> 태그는 제거하되 내부 설명 텍스트는 보존
  - <개정 ...> 같은 나머지 <...> 주석/태그도 제거
  - 과도한 공백을 한 칸으로 정리
한다. 단, 반드시 "구역 분리·조문 파싱 이후, body에만" 적용한다
(raw 전체에 먼저 적용하면 부칙 헤더 '부칙 <법률 제18651호>'의 <...>가 지워져
 부칙 id 추출이 깨짐).

v3에서 이어진 핵심 설계
----------------------
- 부칙(附則)은 조문 번호를 1조부터 다시 매기므로, 본문 제1조와 부칙 제1조가 충돌한다.
  → 구역(section)을 MAIN(본문) / ADDENDA(부칙)으로 태그하고 부칙 블록마다 ordn(순번)을 부여해 구분.
  → 매칭(평가)도 (법령, section, 조문)으로 비교하므로 본문 gold가 부칙에 오매칭되지 않음.
- 조문이 512토큰을 넘으면 항(①②) → 호(1.) → 토큰 윈도우 순으로 분할.
  분할된 조각은 같은 articleNo / parentId를 공유 → 평가기가 한 조문으로 합산.
- 별표/별지는 제외.

chunk_id:  본문    → law_{ref}_제3조[#pN]
           부칙    → law_{ref}_부칙{ordn}_제1조[#pN]
           (혹시 모를 중복은 unique_id가 _2/_3로 자동 분기)
"""



import re
import logging

import psycopg2
import chromadb
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
from sentence_transformers import SentenceTransformer
import torch

# ═════════════════════════════════════════════════════════════════════════════
# 설정
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
# 임베딩 함수 (E5, passage 접두사)
# ═════════════════════════════════════════════════════════════════════════════
class E5EmbeddingFunction(EmbeddingFunction):
    def __init__(self, model_name: str = MODEL_NAME):
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
        log.info("모델 로드: %s (device=%s)", model_name, device)
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
# 본문 정리(clean_text)
# ═════════════════════════════════════════════════════════════════════════════
def clean_text(s: str) -> str:
    s = re.sub(r"</?img[^>]*>", " ", s)
    s = re.sub(r"<[^>]*>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

# ═════════════════════════════════════════════════════════════════════════════
# 구역 분리 + 조문 파싱  [v5: 헤더 정규식 엄격화]
# ═════════════════════════════════════════════════════════════════════════════
# [v5] '제N조(...)' 헤더 — 괄호 안이 편제(제M장/절/관/편)면 조문으로 보지 않음
#      예: "제1조 제1장 총강(總綱)"의 '제1조'는 제외, "제1조(목적)"만 인식.
ART_HEADING         = re.compile(r"제\d+조(?:의\d+)?(?=\((?!\s*제?\s*\d+\s*[장절관편])|\s*삭제)")
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE           = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")

# [v5] 부칙 헤더 — 줄 시작 + '부칙' + (<...> | (…시행…/법률 제…호)) 메타가 '반드시' 있을 때만
#      본문 속 '부칙 제2조' 같은 단순 참조는 제외.
ADDENDA_HDR         = re.compile(
    r"(?:^|\n)\s*부\s*칙\s*(<[^>]*>|\([^)]*(?:시행|법률\s*제)[^)]*\))")

# [v5] 별표/별지 헤더 — 줄 시작(또는 '[') + '별표/별지' + 번호/서식/'제N호'
#      본문 속 "특별지방", "개별지역" 등의 '별지/별표' 오탐 제거.
BYEOLPYO            = re.compile(r"(?:^|\n)\s*\[?\s*별\s*(?:표|지)\s*(?:\d|제\s*\d+\s*호|서식)")

HANG_SPLIT          = re.compile(r"(?=[\u2460-\u2473])")
HO_SPLIT            = re.compile(r"(?=\s+\d+\.\s)")

def _addenda_id(h: str) -> str:
    m = re.search(r"제\s*\d+\s*호", h)
    return re.sub(r"\s+", "", m.group(0)) if m else ""

def split_sections(raw: str):
    """[(section, addendaId, addendaOrd, text)] : 본문(MAIN) + 부칙 블록들. 별표 이후는 버림."""
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
        if not arts and sec == "MAIN":
            arts = _parse_with(text, ART_HEADING_LENIENT)
        for a in arts:
            result.append((sec, aid, ordn, a["articleNo"], a["title"], a["body"]))
    return result

# ═════════════════════════════════════════════════════════════════════════════
# 청킹
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
# ChromaDB 준비
# ═════════════════════════════════════════════════════════════════════════════
def reset_collection(ef):
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    try:
        client.delete_collection(COLLECTION_NAME)
        log.info("기존 `%s` 컬렉션 삭제 완료", COLLECTION_NAME)
    except Exception:
        log.info("기존 컬렉션 없음 → 새로 생성")
    return client.create_collection(name=COLLECTION_NAME, embedding_function=ef,
                                    metadata={"hnsw:space": "cosine"})

# ═════════════════════════════════════════════════════════════════════════════
# 메인
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
    log.info("처리할 법령 수: %s", f"{len(rows):,}")

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
            log.warning("[%d/%d] 조문 파싱 0건: %s", idx, len(rows), title)
            continue

        for sec, aid, ordn, no, atitle, body in parsed:
            body = clean_text(body)
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
                    "section": sec,
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
            log.info("[%d/%d] 법령=%s 본문조문=%s 부칙조문=%s chunk=%s 중복보정=%s",
                     idx, len(rows), f"{n_laws:,}", f"{n_main:,}",
                     f"{n_add:,}", f"{n_chunks:,}", f"{n_dup:,}")

    flush(); cur.close(); conn.close()
    log.info("완료 법령=%s 본문조문=%s 부칙조문=%s chunk=%s 조문0건=%s 중복보정=%s",
             f"{n_laws:,}", f"{n_main:,}", f"{n_add:,}", f"{n_chunks:,}",
             f"{n_empty:,}", f"{n_dup:,}")

if __name__ == "__main__":
    run()