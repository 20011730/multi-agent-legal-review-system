"""
5-2.insert_cases_e5.py — 판례 RAG 확장 2단계: cases_e5 컬렉션 E5 임베딩 + 적재 스캐폴딩.

⚠️ 기본 모드는 **dry-run** 입니다. ``--apply`` 플래그 없이는 ChromaDB에 한 줄도
쓰지 않습니다. 또한 ``CASES_COLLECTION`` 이 ``laws`` / ``laws_e5`` 와 겹치면
즉시 RuntimeError로 거부합니다 (case_config.require_safe_cases_collection 가드).

입력
----
``CASES_OUTPUT_DIR/cases_index.jsonl`` (5-1.collect_cases.py가 생성한 JSONL)
또는 ``--input <path>`` 로 명시.

처리
----
한 판례 row → 여러 chunk:
    - 판시사항 (issue)          → text_type=issue
    - 판결요지 (holding)        → text_type=holding
    - 참조조문 (referenced_laws) → text_type=referenced_laws
    - 판례본문 (body)           → text_type=body, length>800 시 분할

chunk_id 포맷::
    case_{case_id}_{text_type}_{chunk_idx:04d}

metadata (Chroma) ::
    source_type = "case"
    case_id, case_name, court, decision_date, case_number,
    issue, holding, summary, referenced_laws, source_url,
    collected_at, chunk_index, text_type

E5 prefix 정책
-------------
적재(passage) 측은 항상 ``"passage: "`` prefix 부착 — laws 측 4-2 스크립트와 동일 정책.
검색(query) 측은 backend → ``embedding_server.py:9100`` → ``"query: "`` 자동 부착.

본 스크립트가 **수행하지 않는 것**
- 컬렉션 삭제 / reset (어떤 옵션도 제공하지 않음)
- 기존 laws/laws_e5 컬렉션 접근
- PostgreSQL 쓰기
- 외부 API 호출 (수집은 5-1 담당)

사용 예
-------
    # 도움말 + dry-run 미리보기
    python ai/generate_rag/5-2.insert_cases_e5.py

    # 입력 JSONL 검증만 (실제 적재 X)
    python ai/generate_rag/5-2.insert_cases_e5.py --input ./cases_data/cases_index.jsonl

    # 실제 적재 (Docker ChromaDB HTTP 모드, cases_e5 컬렉션)
    CHROMA_CLIENT_MODE=http CHROMA_HOST=localhost CHROMA_PORT=8000 \\
    python ai/generate_rag/5-2.insert_cases_e5.py --apply --limit 10
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from case_config import (
    CASES_OUTPUT_DIR,
    CASES_COLLECTION,
    describe_case_target,
    require_safe_cases_collection,
)
from config import (
    CHROMA_CLIENT_MODE,
    CHROMA_DB_DIR,
    CHROMA_HOST,
    CHROMA_PORT,
    E5_MODEL_NAME,
    EMBEDDING_DIMENSION,
)

LOG = logging.getLogger("insert_cases_e5")

# ── 안전: ID 정규화 (laws 측 4-2와 동일 정책) ────────────────────────
_SAFE_RE = re.compile(r"[^0-9A-Za-z가-힣]+")


def _safe_token(s: str) -> str:
    if not s:
        return "unknown"
    out = _SAFE_RE.sub("_", str(s))
    out = re.sub(r"_+", "_", out).strip("_")
    return out or "unknown"


# ── 텍스트 → chunks ────────────────────────────────────────────────
def _split_long_text(text: str, max_chars: int = 800) -> List[str]:
    """긴 본문을 문단/문장 경계 기반으로 분할 (단순 휴리스틱)."""
    if not text:
        return []
    text = text.strip()
    if len(text) <= max_chars:
        return [text]
    parts: List[str] = []
    buf = ""
    for sentence in re.split(r"(?<=[.!?。\n])\s+", text):
        if len(buf) + len(sentence) + 1 > max_chars and buf:
            parts.append(buf.strip())
            buf = sentence
        else:
            buf = (buf + " " + sentence).strip()
    if buf:
        parts.append(buf.strip())
    return parts


def _build_chunks(row: Dict) -> List[Dict]:
    """판례 1건 → chunks list. 각 chunk = {id, text, metadata}."""
    case_id = str(row.get("case_id", "")).strip()
    if not case_id:
        return []

    common_meta = {
        "source_type": "case",
        "case_id": case_id,
        "case_name": row.get("case_name", "") or "",
        "court": row.get("court", "") or "",
        "decision_date": row.get("decision_date", "") or "",
        "case_number": row.get("case_number", "") or "",
        "summary": row.get("summary", "") or "",
        "referenced_laws": row.get("referenced_laws", "") or "",
        "source_url": row.get("source_url", "") or "",
        "collected_at": row.get("collected_at", "") or "",
        # 본문 보강 진단용 — 5-3 이 채운 값 (ok / empty-root:<tag> / all-empty / xml-parse-error)
        # 메타 fallback chunk 가 왜 body 없이 만들어졌는지 사후 식별 가능.
        "body_status": row.get("body_status", "") or "",
        "detail_root": row.get("detail_root", "") or "",
        # 데이터출처 — "" 이면 법제처 직영(본문 조회 가능), 다른 값(예: "국세법령정보시스템")이면
        # lawService.do?target=prec 으로 본문 조회 불가. body 부재의 결정적 원인 식별.
        "data_source": row.get("data_source", "") or "",
        "case_type_name": row.get("case_type_name", "") or "",
    }
    chunks: List[Dict] = []
    safe_cid = _safe_token(case_id)

    def _emit(section_key: str, text: str, text_type: str) -> None:
        parts = _split_long_text(text)
        for i, p in enumerate(parts):
            cid = f"case_{safe_cid}_{text_type}_{i:04d}"
            md = dict(common_meta)
            md["text_type"] = text_type
            md["chunk_index"] = i
            chunks.append({"id": cid, "text": p, "metadata": md})

    # 우선 검색 가능 영역
    _emit("issue", row.get("issue", "") or "", "issue")
    _emit("holding", row.get("holding", "") or "", "holding")
    _emit("referenced_laws", row.get("referenced_laws", "") or "", "referenced_laws")
    _emit("referenced_cases", row.get("referenced_cases", "") or "", "referenced_cases")
    # 본문 (길면 분할 — _split_long_text 가 max_chars 단위로 잘라 chunk_index 부여)
    _emit("body", row.get("body", "") or "", "body")

    # ── meta fallback chunk ─────────────────────────────────────
    # 본문/판시사항 등이 비어 있을 때(법제처 lawSearch.do 목록 응답만 있는 경우)도
    # 검색이 동작하도록 사건명 + 법원 + 선고일 + 사건번호 를 묶은 한 chunk를
    # 항상 1건 emit 한다. text_type="meta" 로 식별.
    if not chunks:
        meta_text_parts = [
            common_meta.get("case_name") or "",
            common_meta.get("court") or "",
            common_meta.get("decision_date") or "",
            common_meta.get("case_number") or "",
        ]
        meta_text = " | ".join(p for p in meta_text_parts if p).strip()
        if meta_text:
            cid = f"case_{safe_cid}_meta_0000"
            md = dict(common_meta)
            md["text_type"] = "meta"
            md["chunk_index"] = 0
            chunks.append({"id": cid, "text": meta_text, "metadata": md})

    return chunks


# ── ChromaDB client ───────────────────────────────────────────────
def _build_chroma_client():
    import chromadb
    if CHROMA_CLIENT_MODE == "http":
        LOG.info("Chroma 모드: HTTP %s:%d", CHROMA_HOST, CHROMA_PORT)
        return chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    LOG.info("Chroma 모드: LOCAL %s", CHROMA_DB_DIR)
    return chromadb.PersistentClient(path=CHROMA_DB_DIR)


def _build_embedder_and_ef():
    """E5 SentenceTransformer 인스턴스 + Chroma EmbeddingFunction 래퍼.

    - 반환 1: ``embed(texts)`` — 본 스크립트가 upsert 전에 직접 벡터를 계산할 때 사용
    - 반환 2: ``ef``       — Chroma 컬렉션 생성/조회 시 첨부할 EmbeddingFunction
                             (Chroma 0.5.23 client가 create_collection에서 ``_type`` 필드를
                              만드는 데 필요. upsert에 embeddings를 명시 전달하면 ef는 호출되지 않음)
    """
    from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
    from sentence_transformers import SentenceTransformer

    LOG.info("E5 모델 로드: %s (dim=%d)", E5_MODEL_NAME, EMBEDDING_DIMENSION)
    model = SentenceTransformer(E5_MODEL_NAME)

    class _PassageE5EF(EmbeddingFunction):
        def __call__(self, input: Documents) -> Embeddings:
            prefixed = [f"passage: {t or ''}" for t in input]
            vecs = model.encode(prefixed, normalize_embeddings=True)
            return vecs.tolist()

    ef = _PassageE5EF()

    def embed(texts: List[str]) -> List[List[float]]:
        prefixed = [f"passage: {t or ''}" for t in texts]
        vecs = model.encode(prefixed, normalize_embeddings=True)
        return [v.tolist() for v in vecs]

    return embed, ef


# ── 메인 적재 ──────────────────────────────────────────────────────
def _load_input(path: str) -> List[Dict]:
    rows: List[Dict] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                LOG.warning("JSON 파싱 실패 (skip): %s", e)
    return rows


def _existing_ids(collection, candidate_ids: List[str]) -> Set[str]:
    """이미 적재된 ID는 skip — collection.get(ids=[...]) 으로 read-only 확인."""
    try:
        got = collection.get(ids=candidate_ids, include=[])
        return set(got.get("ids", []) or [])
    except Exception as e:
        LOG.warning("existing_ids 조회 실패 (skip-duplicate 비활성): %s", e)
        return set()


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="cases_e5 컬렉션에 판례 chunk 적재 — 기본 dry-run, --apply 명시 시 실제 적재.",
    )
    parser.add_argument("--input", default=os.path.join(CASES_OUTPUT_DIR, "cases_index.jsonl"),
                        help="입력 JSONL (5-1.collect_cases.py 결과)")
    parser.add_argument("--apply", action="store_true",
                        help="실제 ChromaDB upsert. 미지정 시 dry-run.")
    parser.add_argument("--limit", type=int, default=0,
                        help="처리할 판례 row 수 제한 (0=전부, default 0)")
    parser.add_argument("--batch-size", type=int, default=32,
                        help="ChromaDB upsert 배치 크기")
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    # 안전 가드: 절대 laws / laws_e5 컬렉션을 건드리지 않도록
    safe_name = require_safe_cases_collection()
    LOG.info("== insert_cases_e5 — target=%s (dry-run=%s) ==",
             describe_case_target(), not args.apply)
    LOG.info("collection (safe-guarded): %s", safe_name)

    if not os.path.exists(args.input):
        LOG.warning("입력 파일 없음: %s", args.input)
        LOG.warning("먼저 `python ai/generate_rag/5-1.collect_cases.py --apply ...` 로 수집하세요.")
        return 0

    rows = _load_input(args.input)
    if args.limit:
        rows = rows[: args.limit]
    LOG.info("입력 row: %d건 (limit=%d)", len(rows), args.limit)

    total_chunks = 0
    sample_id = None
    for row in rows:
        chunks = _build_chunks(row)
        total_chunks += len(chunks)
        if chunks and sample_id is None:
            sample_id = chunks[0]["id"]
    LOG.info("총 chunk 생성 예상: %d건  sample_id=%s", total_chunks, sample_id)

    if not args.apply:
        LOG.info("dry-run 완료 — 실제 적재는 --apply 와 함께 다시 실행하세요.")
        LOG.info("실행 전 안전 점검:")
        LOG.info("  1) CHROMA_CLIENT_MODE=http (Docker ChromaDB 적재 시)")
        LOG.info("  2) CHROMA_HOST/PORT 가 운영 Chroma 와 일치")
        LOG.info("  3) CASES_COLLECTION=cases_e5 (laws/laws_e5 와 분리)")
        LOG.info("  4) embedding_server.py 가 떠 있을 필요는 없음 — 본 스크립트는 로컬 E5 모델로 직접 임베딩")
        return 0

    # apply 모드 — chromadb 클라이언트 버전과 무관한 raw HTTP 경로를 사용.
    #
    # 배경: 시스템에 설치된 chromadb 클라이언트(1.x)와 Docker 서버(0.5.x) 간 메이저 버전 차이로
    # client.create_collection이 KeyError('_type')으로 실패함. backend Java ChromaSearchService가
    # 사용하는 안정적인 /api/v1/collections REST endpoint를 직접 호출하여 회피한다.
    if CHROMA_CLIENT_MODE != "http":
        raise SystemExit(
            "본 적재 경로는 Docker ChromaDB HTTP 모드 전용입니다. "
            "CHROMA_CLIENT_MODE=http 환경변수와 함께 재실행하세요."
        )
    try:
        import requests
    except ImportError as e:
        raise SystemExit("requests 패키지 필요. pip install requests") from e

    base = f"http://{CHROMA_HOST}:{CHROMA_PORT}"

    # 1) 컬렉션 보장 (POST /api/v1/collections, get_or_create=true)
    r = requests.post(f"{base}/api/v1/collections",
                      json={"name": safe_name, "get_or_create": True},
                      timeout=15)
    if not r.ok:
        raise SystemExit(f"컬렉션 보장 실패: HTTP {r.status_code} {r.text[:200]}")
    collection_uuid = r.json().get("id")
    if not collection_uuid:
        raise SystemExit(f"컬렉션 응답에 id 없음: {r.text[:200]}")
    LOG.info("collection 준비: name='%s' uuid=%s", safe_name, collection_uuid)

    # 2) 임베딩 모델 (passage prefix 적용)
    try:
        embed, _ef = _build_embedder_and_ef()
    except Exception as e:
        raise SystemExit(f"E5 모델 로드 실패: {e}")

    # 3) upsert / get 헬퍼 (raw HTTP)
    def _http_existing_ids(candidate_ids: List[str]) -> Set[str]:
        try:
            resp = requests.post(
                f"{base}/api/v1/collections/{collection_uuid}/get",
                json={"ids": candidate_ids, "include": []},
                timeout=15,
            )
            if not resp.ok:
                LOG.warning("existing_ids 조회 실패: HTTP %s", resp.status_code)
                return set()
            return set(resp.json().get("ids", []) or [])
        except Exception as exc:
            LOG.warning("existing_ids 조회 예외 (skip-dup 비활성): %s", exc)
            return set()

    def _http_upsert(ids: List[str], docs: List[str], metas: List[Dict], vecs: List[List[float]]):
        resp = requests.post(
            f"{base}/api/v1/collections/{collection_uuid}/upsert",
            json={"ids": ids, "documents": docs, "metadatas": metas, "embeddings": vecs},
            timeout=60,
        )
        if not resp.ok:
            raise RuntimeError(f"upsert HTTP {resp.status_code}: {resp.text[:300]}")

    # collection 객체를 함수형으로 정의해 기존 _flush 흐름 재사용
    class _HttpCollection:
        def get(self, ids, include=()):
            return {"ids": list(_http_existing_ids(ids))}
        def upsert(self, ids, documents, metadatas, embeddings):
            _http_upsert(ids, documents, metadatas, embeddings)
    collection = _HttpCollection()

    inserted = 0
    skipped = 0
    batch_ids: List[str] = []
    batch_docs: List[str] = []
    batch_metas: List[Dict] = []

    def _flush():
        nonlocal inserted, skipped, batch_ids, batch_docs, batch_metas
        if not batch_ids:
            return
        # 중복 skip
        already = _existing_ids(collection, batch_ids)
        if already:
            keep = [(i, batch_ids[i]) for i in range(len(batch_ids)) if batch_ids[i] not in already]
            skipped += len(batch_ids) - len(keep)
            if not keep:
                batch_ids, batch_docs, batch_metas = [], [], []
                return
            new_ids = [batch_ids[i] for i, _ in keep]
            new_docs = [batch_docs[i] for i, _ in keep]
            new_metas = [batch_metas[i] for i, _ in keep]
        else:
            new_ids, new_docs, new_metas = batch_ids, batch_docs, batch_metas

        # batch 내부 중복 가드
        if len(new_ids) != len(set(new_ids)):
            raise RuntimeError(f"[BATCH DUP] 동일 batch 내 chunk_id 중복: {len(new_ids) - len(set(new_ids))}건")

        vecs = embed(new_docs)
        collection.upsert(ids=new_ids, documents=new_docs, metadatas=new_metas, embeddings=vecs)
        inserted += len(new_ids)
        LOG.info("  └ upsert OK +%d (누적 %d, skip %d)", len(new_ids), inserted, skipped)
        batch_ids, batch_docs, batch_metas = [], [], []

    for idx, row in enumerate(rows, 1):
        for c in _build_chunks(row):
            batch_ids.append(c["id"])
            batch_docs.append(c["text"])
            batch_metas.append(c["metadata"])
            if len(batch_ids) >= args.batch_size:
                _flush()
        if idx % 10 == 0:
            LOG.info("진행 %d/%d (누적 upsert=%d, skip=%d)", idx, len(rows), inserted, skipped)
    _flush()

    LOG.info("완료 — upsert=%d skip=%d (collection=%s, dim=%d, time=%s)",
             inserted, skipped, safe_name, EMBEDDING_DIMENSION,
             datetime.now(timezone.utc).isoformat())
    return 0


if __name__ == "__main__":
    sys.exit(main())
