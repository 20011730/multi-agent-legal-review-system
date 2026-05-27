"""
Phase 10.62 — legal_rag_export 의 legal_case_chunks 에서 샘플 N건을 운영 Chroma 로 복사.

특징:
  - 원본 chroma_legal_db 의 사전 계산 embedding 을 그대로 복사 → 모델 의존성 없음.
  - 운영 Chroma 의 기존 cases_e5 / laws_e5 / laws 는 절대 건드리지 않음.
  - 별도 collection name (기본 ``legal_case_chunks_sample``) 으로 격리.
  - 재실행 안전: 이미 존재하면 drop 후 재생성.

사용:
  python ai/generate_rag/5-6.import_legal_case_chunks_sample.py [--n 1000]

전제:
  - 운영 Chroma 가 http://localhost:8000 에 실행 중
  - data/legal_rag_export/chroma_legal_db 디렉터리 존재
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import json

import chromadb
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_PATH = REPO_ROOT / "data" / "legal_rag_export" / "chroma_legal_db"
SRC_SQLITE = REPO_ROOT / "data" / "legal_rag_export" / "case_chunks.db"
SRC_COLLECTION = "legal_case_chunks"
DST_COLLECTION_DEFAULT = "legal_case_chunks_sample"

# Phase 10.62 — 샘플이 검색 테스트에 유의미하게 사용되려면 다양한 토픽이 포함되어야 함.
# sqlite 에서 토픽별 키워드로 chunk_id 를 골라 import (모두 합해 N건).
TOPIC_KEYWORDS = [
    ("crawl", "%크롤링%"),
    ("privacy", "%개인정보%"),
    ("funding", "%환수%"),
    ("ip", "%지식재산권%"),
    ("invest", "%주식 양도%"),
    ("outsource", "%외주%"),
    ("contract", "%계약 위반%"),
    ("labor", "%근로계약%"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000, help="복사할 chunk 수 (기본 1000)")
    ap.add_argument("--dst-collection", default=DST_COLLECTION_DEFAULT)
    ap.add_argument("--chroma-host", default="localhost")
    ap.add_argument("--chroma-port", type=int, default=8000)
    args = ap.parse_args()

    if not SRC_PATH.exists():
        log.error("원본 경로 없음: %s", SRC_PATH)
        return 2

    log.info("원본 Chroma 읽기 — %s / collection=%s", SRC_PATH, SRC_COLLECTION)
    src_client = chromadb.PersistentClient(path=str(SRC_PATH))
    src = src_client.get_collection(SRC_COLLECTION)
    total = src.count()
    log.info("  원본 총 chunk = %d", total)
    n = min(args.n, total)

    # Phase 10.62 — 토픽별로 sqlite 에서 chunk_id 와 content 를 미리 가져온다.
    #   원본 Chroma 는 documents 가 비어 있으므로(원래 sqlite 가 raw text 보유) 본 import 는
    #   sqlite 의 content 를 documents 필드로 동봉하여 운영 Chroma 에 넣는다.
    import sqlite3
    log.info("sqlite 에서 토픽별 chunk 선택 — %s", SRC_SQLITE)
    sdb = sqlite3.connect(str(SRC_SQLITE))
    per_topic = max(1, n // len(TOPIC_KEYWORDS))
    selected: dict[str, tuple[str, str, str, str, str]] = {}
    for tag, pattern in TOPIC_KEYWORDS:
        rows = sdb.execute(
            "SELECT chunk_id, case_number, court, section_type, content "
            "FROM case_chunks WHERE content LIKE ? LIMIT ?",
            (pattern, per_topic),
        ).fetchall()
        for row in rows:
            chunk_id, case_number, court, section_type, content = row
            if chunk_id not in selected:
                selected[chunk_id] = (chunk_id, case_number or "", court or "", section_type or "", content or "")
        log.info("  topic=%s 수집=%d (누적 %d)", tag, len(rows), len(selected))
    selected_ids = list(selected.keys())[:n]
    log.info("최종 선택된 chunk_id = %d 건", len(selected_ids))

    # client(1.5.x) vs server(0.5.x) 버전 차이로 chromadb HttpClient 가 KeyError 를 던지는 경우가 있어
    # 운영 Chroma 와는 REST API (v1) 로 직접 통신.
    base = f"http://{args.chroma_host}:{args.chroma_port}/api/v1"
    http = httpx.Client(timeout=60.0)
    log.info("운영 Chroma 연결 — %s", base)

    # 기존 동일 이름 collection 있으면 drop
    try:
        r = http.delete(f"{base}/collections/{args.dst_collection}")
        if r.status_code in (200, 204, 404):
            log.info("  기존 %s drop (HTTP %d)", args.dst_collection, r.status_code)
    except Exception:
        pass

    # collection 생성 — get_or_create=true 로 idempotent
    r = http.post(
        f"{base}/collections",
        json={"name": args.dst_collection, "get_or_create": True},
    )
    r.raise_for_status()
    coll = r.json()
    coll_id = coll["id"]
    log.info("  생성: %s id=%s", args.dst_collection, coll_id[:8])

    # 배치 단위로 복사 — embeddings 는 원본 Chroma 에서, documents/metadata 는 sqlite 에서 가져온다.
    batch = 100
    copied = 0
    for start in range(0, len(selected_ids), batch):
        batch_ids = selected_ids[start : start + batch]
        page = src.get(
            ids=batch_ids,
            include=["embeddings", "metadatas"],
        )
        # 일부 chunk_id 가 원본 Chroma 에 없을 가능성 대비 — 반환된 id 만 사용
        returned = page["ids"]
        if not returned:
            continue
        embeddings = [list(map(float, e)) for e in page["embeddings"]]
        metadatas = page["metadatas"]
        # documents 는 sqlite 의 content 사용
        documents = []
        safe_metas = []
        for rid, m in zip(returned, metadatas):
            chunk_id, case_number, court, section_type, content = selected[rid]
            documents.append(content)
            mm = {k: (v if v is not None else "") for k, v in (m or {}).items()}
            safe_metas.append(mm)
        r = http.post(
            f"{base}/collections/{coll_id}/upsert",
            json={
                "ids": returned,
                "embeddings": embeddings,
                "documents": documents,
                "metadatas": safe_metas,
            },
        )
        r.raise_for_status()
        copied += len(returned)
        log.info("  복사 %d / %d", copied, len(selected_ids))

    cnt = http.get(f"{base}/collections/{coll_id}/count").json()
    log.info("완료: %s count=%s (목표 %d)", args.dst_collection, cnt, len(selected_ids))
    return 0


if __name__ == "__main__":
    sys.exit(main())
