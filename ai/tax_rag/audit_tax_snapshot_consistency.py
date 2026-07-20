#!/usr/bin/env python3
"""Read-only consistency audit for a shared tax tribunal Chroma snapshot."""

from __future__ import annotations

import argparse
import csv
import json
import pickle
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit tax tribunal Chroma snapshot and BM25 chunk metadata without modifying sources."
    )
    parser.add_argument("--snapshot-dir", required=True, help="Directory containing chroma.sqlite3")
    parser.add_argument("--chunk-meta", required=True, help="Path to chunk_meta.pkl")
    parser.add_argument("--output-dir", default="/tmp/lexrex_tax_snapshot_audit")
    parser.add_argument("--sample-size", type=int, default=50)
    return parser.parse_args()


def connect_readonly(sqlite_path: Path) -> sqlite3.Connection:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"chroma sqlite file not found: {sqlite_path}")
    uri = f"file:{sqlite_path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def iter_rows(cursor: sqlite3.Cursor, sql: str, params: tuple[Any, ...] = ()) -> Iterable[tuple[Any, ...]]:
    cursor.execute(sql, params)
    while True:
        rows = cursor.fetchmany(10_000)
        if not rows:
            break
        yield from rows


def load_chunk_meta(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    if not path.exists():
        raise FileNotFoundError(f"chunk_meta file not found: {path}")
    with path.open("rb") as f:
        raw = pickle.load(f)

    records: list[dict[str, Any]] = []
    ids: list[str] = []
    if isinstance(raw, dict):
        iterable = raw.items()
        for key, value in iterable:
            record = value if isinstance(value, dict) else {"value": value}
            record = dict(record)
            record.setdefault("id", str(key))
            records.append(record)
            ids.append(str(record.get("id") or key))
    elif isinstance(raw, list):
        for idx, value in enumerate(raw):
            if isinstance(value, str):
                record = {"id": value}
            else:
                record = value if isinstance(value, dict) else {"value": value}
            record = dict(record)
            chunk_id = (
                record.get("id")
                or record.get("chunk_id")
                or record.get("embedding_id")
                or record.get("chunkId")
                or f"bm25_row_{idx}"
            )
            record.setdefault("id", str(chunk_id))
            records.append(record)
            ids.append(str(chunk_id))
    else:
        raise TypeError(f"unsupported chunk_meta type: {type(raw).__name__}")
    return records, ids


def text_from_record(record: dict[str, Any]) -> str:
    for key in ("text", "body", "content", "document", "chunk", "raw_content"):
        value = record.get(key)
        if value:
            return str(value)
    return ""


def doc_number_from_record(record: dict[str, Any]) -> str:
    for key in ("doc_number", "docNumber", "decision_id", "case_number"):
        value = record.get(key)
        if value:
            return str(value)
    return ""


def main() -> int:
    args = parse_args()
    snapshot_dir = Path(args.snapshot_dir).expanduser()
    sqlite_path = snapshot_dir / "chroma.sqlite3"
    chunk_meta_path = Path(args.chunk_meta).expanduser()
    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    conn = connect_readonly(sqlite_path)
    cur = conn.cursor()

    chroma_ids: list[str] = []
    chroma_by_rowid: dict[int, str] = {}
    for rowid, embedding_id in iter_rows(cur, "SELECT id, embedding_id FROM embeddings"):
        embedding_id = str(embedding_id)
        chroma_by_rowid[int(rowid)] = embedding_id
        chroma_ids.append(embedding_id)

    metadata_counts: Counter[str] = Counter()
    doc_numbers: dict[str, str] = {}
    document_lengths: dict[str, int] = {}
    for rowid, key, string_value in iter_rows(
        cur,
        "SELECT id, key, string_value FROM embedding_metadata",
    ):
        metadata_counts[str(key)] += 1
        embedding_id = chroma_by_rowid.get(int(rowid))
        if not embedding_id:
            continue
        if key in ("doc_number", "docNumber", "decision_id") and string_value:
            doc_numbers[embedding_id] = str(string_value)
        elif key == "chroma:document" and string_value is not None:
            document_lengths[embedding_id] = len(str(string_value).strip())

    bm25_records, bm25_ids = load_chunk_meta(chunk_meta_path)
    bm25_lengths = {record["id"]: len(text_from_record(record).strip()) for record in bm25_records}
    bm25_doc_numbers = {record["id"]: doc_number_from_record(record) for record in bm25_records}

    chroma_id_counts = Counter(chroma_ids)
    bm25_id_counts = Counter(bm25_ids)
    chroma_set = set(chroma_ids)
    bm25_set = set(bm25_ids)
    bm25_only = sorted(bm25_set - chroma_set)
    chroma_only = sorted(chroma_set - bm25_set)

    all_lengths = list(document_lengths.values()) or list(bm25_lengths.values())
    empty_chunks = sum(1 for length in all_lengths if length == 0)
    short_counts = {
        "lt_20": sum(1 for length in all_lengths if length < 20),
        "lt_50": sum(1 for length in all_lengths if length < 50),
        "lt_100": sum(1 for length in all_lengths if length < 100),
    }

    affected_docs: dict[str, list[str]] = defaultdict(list)
    for chunk_id in bm25_only:
        doc_number = bm25_doc_numbers.get(chunk_id, "")
        if doc_number:
            affected_docs[doc_number].append(chunk_id)

    metadata_ratios = {
        key: {
            "count": count,
            "ratio": round(count / max(1, len(chroma_ids)), 6),
        }
        for key, count in metadata_counts.most_common()
    }

    summary = {
        "snapshotDir": str(snapshot_dir),
        "chunkMeta": str(chunk_meta_path),
        "chromaEmbeddingRows": len(chroma_ids),
        "chromaUniqueEmbeddingIds": len(chroma_set),
        "bm25ChunkMetaRows": len(bm25_ids),
        "bm25UniqueIds": len(bm25_set),
        "bm25OnlyIds": len(bm25_only),
        "chromaOnlyIds": len(chroma_only),
        "duplicateChromaIds": sum(1 for _id, count in chroma_id_counts.items() if count > 1),
        "duplicateBm25Ids": sum(1 for _id, count in bm25_id_counts.items() if count > 1),
        "uniqueDocNumbersInChroma": len(set(v for v in doc_numbers.values() if v)),
        "uniqueDocNumbersInBm25": len(set(v for v in bm25_doc_numbers.values() if v)),
        "emptyChunks": empty_chunks,
        "shortChunkCounts": short_counts,
        "metadataKeyRatios": metadata_ratios,
        "affectedDocNumbersByBm25OnlyIds": {
            doc: ids[: args.sample_size]
            for doc, ids in list(affected_docs.items())[: args.sample_size]
        },
        "bm25OnlyIdSample": bm25_only[: args.sample_size],
        "chromaOnlyIdSample": chroma_only[: args.sample_size],
        "duplicateBm25IdSample": [
            {"id": chunk_id, "count": count}
            for chunk_id, count in bm25_id_counts.items()
            if count > 1
        ][: args.sample_size],
    }

    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with (output_dir / "bm25_only_ids.jsonl").open("w", encoding="utf-8") as f:
        for chunk_id in bm25_only:
            f.write(json.dumps({
                "id": chunk_id,
                "doc_number": bm25_doc_numbers.get(chunk_id, ""),
                "text_length": bm25_lengths.get(chunk_id, 0),
            }, ensure_ascii=False) + "\n")

    with (output_dir / "chroma_only_ids.jsonl").open("w", encoding="utf-8") as f:
        for chunk_id in chroma_only:
            f.write(json.dumps({
                "id": chunk_id,
                "doc_number": doc_numbers.get(chunk_id, ""),
                "text_length": document_lengths.get(chunk_id, 0),
            }, ensure_ascii=False) + "\n")

    with (output_dir / "duplicate_bm25_ids.jsonl").open("w", encoding="utf-8") as f:
        for chunk_id, count in bm25_id_counts.items():
            if count > 1:
                f.write(json.dumps({
                    "id": chunk_id,
                    "count": count,
                    "in_chroma": chunk_id in chroma_set,
                }, ensure_ascii=False) + "\n")

    with (output_dir / "metadata_key_ratios.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["key", "count", "ratio"])
        for key, payload in metadata_ratios.items():
            writer.writerow([key, payload["count"], payload["ratio"]])

    print(json.dumps({
        "chromaEmbeddingRows": summary["chromaEmbeddingRows"],
        "bm25ChunkMetaRows": summary["bm25ChunkMetaRows"],
        "bm25OnlyIds": summary["bm25OnlyIds"],
        "chromaOnlyIds": summary["chromaOnlyIds"],
        "duplicateChromaIds": summary["duplicateChromaIds"],
        "duplicateBm25Ids": summary["duplicateBm25Ids"],
        "emptyChunks": summary["emptyChunks"],
        "shortChunkCounts": summary["shortChunkCounts"],
        "outputDir": str(output_dir),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
