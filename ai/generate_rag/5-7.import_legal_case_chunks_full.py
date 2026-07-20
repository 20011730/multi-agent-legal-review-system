"""
Phase 10.66 — legal_rag_export 의 전체 legal_case_chunks 를 운영 Chroma 로 batch import.

특징:
  - 원본 chroma_legal_db 의 사전 계산 embedding 그대로 복사 → 모델 의존성 0
  - documents 필드는 sqlite (case_chunks) 의 content 사용 (chunk-id 매핑)
  - 운영 Chroma 의 laws / laws_e5 / cases_e5 / legal_case_chunks_sample 은 **건드리지 않음**
  - 신규 collection name (기본 ``legal_case_chunks_full``)
  - **resume 지원**: 중간 실패 / 부분 import 후 재실행 시 이미 존재하는 chunk_id 자동 skip
  - 진행률 / ETA 로그
  - --limit 옵션으로 부분 import (테스트용)

사용:
  # 10,000건 부분 import (검증)
  python ai/generate_rag/5-7.import_legal_case_chunks_full.py --limit 10000

  # 전체 1.86M 적재 (백그라운드 권장)
  python ai/generate_rag/5-7.import_legal_case_chunks_full.py

  # rollback
  curl -X DELETE http://localhost:8000/api/v1/collections/legal_case_chunks_full
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from pathlib import Path

import chromadb
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_CHROMA = REPO_ROOT / "data" / "legal_rag_export" / "chroma_legal_db"
SRC_SQLITE = REPO_ROOT / "data" / "legal_rag_export" / "case_chunks.db"
SRC_COLLECTION = "legal_case_chunks"
DST_COLLECTION_DEFAULT = "legal_case_chunks_full"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0=전체, 양수=상위 N건만")
    ap.add_argument("--batch", type=int, default=1000, help="batch size (기본 1000)")
    ap.add_argument("--dst-collection", default=DST_COLLECTION_DEFAULT)
    ap.add_argument("--chroma-host", default="localhost")
    ap.add_argument("--chroma-port", type=int, default=8000)
    args = ap.parse_args()

    if not SRC_CHROMA.exists() or not SRC_SQLITE.exists():
        log.error("원본 데이터 없음 — %s / %s", SRC_CHROMA, SRC_SQLITE)
        return 2

    # 원본 Chroma (read-only)
    log.info("원본 Chroma 읽기 — %s", SRC_CHROMA)
    src_client = chromadb.PersistentClient(path=str(SRC_CHROMA))
    src = src_client.get_collection(SRC_COLLECTION)
    src_total = src.count()
    target_n = src_total if args.limit <= 0 else min(args.limit, src_total)
    log.info("  원본 총 chunk = %d, 적재 목표 = %d", src_total, target_n)

    # 운영 Chroma (REST API — 운영 server 0.5.x 와 호환)
    base = f"http://{args.chroma_host}:{args.chroma_port}/api/v1"
    http = httpx.Client(timeout=120.0)
    log.info("운영 Chroma — %s", base)

    # collection get_or_create
    r = http.post(f"{base}/collections", json={"name": args.dst_collection, "get_or_create": True})
    r.raise_for_status()
    coll_id = r.json()["id"]
    existing = int(http.get(f"{base}/collections/{coll_id}/count").json())
    log.info("  collection=%s id=%s 기존 count=%d", args.dst_collection, coll_id[:8], existing)

    # 이미 적재된 id (resume 지원)
    seen: set[str] = set()
    if existing > 0:
        log.info("  기존 id 집합 캐싱 (resume) — count=%d", existing)
        # /get with limit, offset 으로 id 만 읽음 (메모리 절약)
        offset = 0
        page_size = 5000
        while offset < existing:
            page = http.post(
                f"{base}/collections/{coll_id}/get",
                json={"limit": page_size, "offset": offset, "include": []},
            ).json()
            for cid in page.get("ids", []):
                seen.add(cid)
            offset += page_size
        log.info("  resume seen=%d", len(seen))

    # sqlite — content 읽기
    sdb = sqlite3.connect(str(SRC_SQLITE))

    # 원본 Chroma 를 chunk_id 순서대로 pagination (PersistentClient 가 안정 ordering 보장 안 함 → batch=batch_size)
    # 따라서 sqlite 의 chunk_id 순회로 driver, Chroma 는 ids 조회 모드.
    log.info("적재 시작 — batch=%d", args.batch)
    t0 = time.time()
    copied = 0
    cursor = sdb.execute(
        "SELECT chunk_id, case_number, court, section_type, content FROM case_chunks "
        "ORDER BY case_db_id LIMIT ?",
        (target_n,),
    )

    buf_meta: dict[str, tuple[str, str, str, str]] = {}
    batch_ids: list[str] = []
    for row in cursor:
        chunk_id, case_number, court, section_type, content = row
        if chunk_id in seen:
            continue
        buf_meta[chunk_id] = (case_number or "", court or "", section_type or "", content or "")
        batch_ids.append(chunk_id)
        if len(batch_ids) < args.batch:
            continue
        copied += upsert_batch(http, base, coll_id, src, batch_ids, buf_meta)
        batch_ids.clear()
        buf_meta.clear()
        if copied % (args.batch * 5) == 0:
            rate = copied / max(0.1, time.time() - t0)
            eta = (target_n - existing - copied) / max(rate, 0.1)
            log.info("  진행 %d (rate=%.0f/s, ETA=%.0fs)", copied, rate, eta)

    if batch_ids:
        copied += upsert_batch(http, base, coll_id, src, batch_ids, buf_meta)

    final = int(http.get(f"{base}/collections/{coll_id}/count").json())
    elapsed = time.time() - t0
    log.info("완료: %s count=%d (이번 실행 추가 %d, %.1fs)", args.dst_collection, final, copied, elapsed)
    return 0


def upsert_batch(http, base, coll_id, src, batch_ids, buf_meta) -> int:
    """원본 Chroma 에서 embedding 만 가져와 운영 Chroma 에 upsert. documents = sqlite content."""
    if not batch_ids:
        return 0
    src_page = src.get(ids=batch_ids, include=["embeddings", "metadatas"])
    if not src_page["ids"]:
        return 0
    embeddings = [list(map(float, e)) for e in src_page["embeddings"]]
    metadatas = src_page["metadatas"]
    documents: list[str] = []
    safe_metas: list[dict] = []
    for rid, m in zip(src_page["ids"], metadatas):
        case_number, court, section_type, content = buf_meta.get(rid, ("", "", "", ""))
        documents.append(content)
        mm = {k: (v if v is not None else "") for k, v in (m or {}).items()}
        safe_metas.append(mm)
    r = http.post(
        f"{base}/collections/{coll_id}/upsert",
        json={
            "ids": src_page["ids"],
            "embeddings": embeddings,
            "documents": documents,
            "metadatas": safe_metas,
        },
    )
    r.raise_for_status()
    return len(src_page["ids"])


if __name__ == "__main__":
    sys.exit(main())
