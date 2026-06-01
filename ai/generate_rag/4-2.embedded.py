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

from __future__ import annotations

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
CHROMA_PATH     = "./chroma_data"           # 판례 컬렉션과 폴더를 공유해도 laws만 건드림
COLLECTION_NAME = "laws"
MODEL_NAME      = "intfloat/multilingual-e5-base"

MAX_TOKENS     = 512                         # 모델 한도
SAFETY         = 12                          # 여유분(특수토큰 + "passage: " 등)
TOKEN_BUDGET   = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40                          # 최후 수단인 윈도우 분할 시 토큰 겹침
ENCODE_BATCH   = 32                          # model.encode 미니배치(MPS 진행 표시 안정화)
UPSERT_BATCH   = 128                         # Chroma upsert/커밋 단위 chunk 수

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s | %(levelname)-7s | %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("law_embed")

# ═════════════════════════════════════════════════════════════════════════════
# 임베딩 함수 (E5, passage 접두사) — 판례 corpus와 동일한 임베딩 공간
# ═════════════════════════════════════════════════════════════════════════════
class E5EmbeddingFunction(EmbeddingFunction):
    def __init__(self, model_name: str = MODEL_NAME):
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
        log.info("모델 로드: %s (device=%s)", model_name, device)
        self.model = SentenceTransformer(model_name, device=device)
        self.model.max_seq_length = MAX_TOKENS

    def __call__(self, input: Documents) -> Embeddings:
        # 적재 문서에는 'passage: ' 접두사를 붙여야 E5 성능이 극대화됨
        return self.model.encode([f"passage: {d}" for d in input],
                                 normalize_embeddings=True,
                                 batch_size=ENCODE_BATCH).tolist()

    def n_tokens(self, text: str) -> int:
        # 실제로 임베딩되는 문자열('passage: '+text)의 토큰 수
        return len(self.model.tokenizer.encode(f"passage: {text}"))

    def truncate_to_budget(self, text: str) -> str:
        # 혹시 한도를 넘는 chunk가 있으면 토큰 단위로 잘라 반드시 한도 내로 맞춤
        if self.n_tokens(text) <= TOKEN_BUDGET:
            return text
        tok = self.model.tokenizer
        prefix_cost = len(tok.encode("passage: ", add_special_tokens=False)) + 2
        ids = tok.encode(text, add_special_tokens=False)[: TOKEN_BUDGET - prefix_cost]
        out = tok.decode(ids).strip()
        # decode→encode 과정에서 토큰이 약간 늘 수 있으니 한도 내로 들어올 때까지 줄임
        while out and self.n_tokens(out) > TOKEN_BUDGET:
            ids = ids[:-8]; out = tok.decode(ids).strip()
        return out

# ═════════════════════════════════════════════════════════════════════════════
# 본문 정리(clean_text) — 이미지 태그·과도한 공백 제거
# ═════════════════════════════════════════════════════════════════════════════
def clean_text(s: str) -> str:
    """조문 body 정리.
    - <img ...> / </img> 는 제거하되 내부 설명 텍스트(수식 말풍선)는 보존
    - <개정 ...>, <br> 등 나머지 <...> 태그·주석 제거
    - 과도한 공백/탭/줄바꿈을 한 칸으로 정리
    ※ 반드시 구역 분리·조문 파싱 이후 body에만 적용할 것."""
    s = re.sub(r"</?img[^>]*>", " ", s)   # <img src=...> 와 </img> 제거(내부 텍스트 유지)
    s = re.sub(r"<[^>]*>", " ", s)         # <개정 ...> 등 나머지 태그/주석 제거
    s = re.sub(r"\s+", " ", s).strip()     # 공백 정리
    return s

# ═════════════════════════════════════════════════════════════════════════════
# 구역 분리 + 조문 파싱
# ═════════════════════════════════════════════════════════════════════════════
# 진짜 조문 제목 = 제N조[의M] 바로 뒤에 '(' 또는 ' 삭제'가 오는 것
# (이렇게 해야 줄바꿈이 없어도 잡히고, '「형법」 제127조' 같은 인라인 참조를 오인하지 않음)
ART_HEADING         = re.compile(r"제\d+조(?:의\d+)?(?=\(|\s*삭제)")
# 제목 없는 옛 법령(제1조 본문...)용 보조 패턴: strict가 0건일 때만 사용
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE           = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")
# 부칙 섹션 헤더: '부칙' 뒤에 <...> 또는 제1조 또는 (시행 이 오는 경우만(본문 내 '부칙 제2조' 참조와 구분)
ADDENDA_HDR         = re.compile(r"부\s*칙\s*(<[^>]*>|\([^)]*시행[^)]*\))?")
BYEOLPYO            = re.compile(r"별\s*[표지]")
HANG_SPLIT          = re.compile(r"(?=[\u2460-\u2473])")   # 항 기호 ①..⑳
HO_SPLIT            = re.compile(r"(?=\s+\d+\.\s)")          # 호 ' 1. ' ' 2. '

def _addenda_id(h: str) -> str:
    # 부칙 헤더에서 공포번호(제NNNN호) 추출
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
    # 주어진 헤더 패턴으로 조문을 끊어 [{articleNo, title, body}] 반환
    heads = [(m.start(), m.group(0)) for m in pattern.finditer(text)]
    out = []
    for i, (pos, no) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        seg = text[pos:end].strip()
        mt = ART_TITLE.match(seg)
        if mt:
            title, body = mt.group(1).strip(), seg[mt.end():].strip()
        else:                                   # 예: "제4조 삭제 <2016.2.3>"
            title, body = "", seg[len(no):].strip()
        out.append({"articleNo": no, "title": title, "body": body})
    return out

def parse_law(raw: str):
    """-> [(section, addendaId, addendaOrd, articleNo, title, body)]"""
    result = []
    for sec, aid, ordn, text in split_sections(raw):
        arts = _parse_with(text, ART_HEADING)
        if not arts and sec == "MAIN":          # 제목 없는 옛 법령 보조 파싱
            arts = _parse_with(text, ART_HEADING_LENIENT)
        for a in arts:
            result.append((sec, aid, ordn, a["articleNo"], a["title"], a["body"]))
    return result

# ═════════════════════════════════════════════════════════════════════════════
# 청킹 (조문 → 512토큰 이하 chunk; 항 → 호 → 토큰 윈도우 순으로 분할)
# ═════════════════════════════════════════════════════════════════════════════
def _window_split(ef, head, text):
    # 구조가 없어 더 못 쪼개는 경우의 최후 수단: 토큰 윈도우로 분할(머리말 반복)
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
    # 조각(항/호)들을 한도 내에서 탐욕적으로 묶음. 각 chunk는 머리말(head)로 시작
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
        else:                                   # 조각 하나가 한도를 넘으면 윈도우 분할
            chunks.extend(_window_split(ef, head, p)); cur = head
    if cur != head:
        chunks.append(cur)
    return chunks

def chunk_article(ef, no, title, body):
    head = f"{no}({title})" if title else no
    whole = f"{head} {body}".strip() if body else head
    if ef.n_tokens(whole) <= TOKEN_BUDGET:      # 한도 이내면 한 chunk
        return [whole]
    hangs = [h.strip() for h in HANG_SPLIT.split(body) if h.strip()]
    if len(hangs) > 1:                          # 1순위: 항(①②) 경계
        return _pack(ef, head, hangs)
    hos = [h.strip() for h in HO_SPLIT.split(body) if h.strip()]
    if len(hos) > 1:                            # 2순위: 호(1.) 경계
        return _pack(ef, head, hos)
    return _window_split(ef, head, body)        # 3순위: 토큰 윈도우

# ═════════════════════════════════════════════════════════════════════════════
# ChromaDB 준비
# ═════════════════════════════════════════════════════════════════════════════
def reset_collection(ef):
    # 기존 laws 컬렉션을 지우고 새로 만듦(판례 등 다른 컬렉션은 보존)
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
        # chunk_id 유일성 보장(혹시 모를 중복은 _2/_3로 분기)
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
            body = clean_text(body)              # ★ 이미지 태그·과도한 공백 정리
            if sec == "MAIN":
                parent = f"law_{reference_id}_{no}"; n_main += 1
            else:
                parent = f"law_{reference_id}_부칙{ordn}_{no}"; n_add += 1
            chunks = chunk_article(ef, no, atitle, body)
            n_parts = len(chunks)
            for pi, text in enumerate(chunks):
                text = ef.truncate_to_budget(text)   # 512 한도 강제 보장
                base = parent if n_parts == 1 else f"{parent}#p{pi+1}"
                buf_ids.append(unique_id(base))
                buf_docs.append(text)
                buf_meta.append({
                    "rowId": rid, "referenceId": str(reference_id),
                    "sourceType": "LAW",
                    "title": title or "", "shortName": short_name or "",
                    "articleNo": no, "articleTitle": atitle,
                    "section": sec,                  # MAIN | ADDENDA  ← 매칭 키
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