#!/usr/bin/env python3
"""Guarded add-only importer for tax tribunal Chroma snapshots.

Default mode is dry-run. Apply mode is intentionally strict and is meant to be
used only after copying the shared snapshot to a disposable working directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROTECTED_COLLECTIONS = {
    "laws",
    "laws_e5",
    "laws_e5_full",
    "laws_e5_full_sample",
    "cases_e5",
    "legal_case_chunks_full",
}
SOURCE_COLLECTION = "tax_precedents"
DEFAULT_DESTINATION = "tax_tribunal_e5_full"
DEFAULT_EXPECTED_SOURCE_COUNT = 499_361
EXPECTED_DIMENSION = 768
EXPECTED_METRIC = "cosine"
PROTECTED_COUNT_COLLECTIONS = ("laws_e5_full", "legal_case_chunks_full")


class StepLogger:
    def __init__(self) -> None:
        self.started_at = time.time()
        self.last_at = self.started_at

    def log(self, label: str) -> None:
        now = time.time()
        total = now - self.started_at
        delta = now - self.last_at
        self.last_at = now
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        print(f"[{stamp}] {label} (+{delta:.3f}s, total={total:.3f}s)", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dry-run or guarded add-only import from a tax tribunal Chroma snapshot."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--source-snapshot", help="Directory containing source chroma.sqlite3")
    source_group.add_argument("--source-dir", help="Extracted tax_db_export directory containing chroma_tax_db")
    parser.add_argument("--destination-collection", default=DEFAULT_DESTINATION)
    parser.add_argument("--expected-source-count", type=int, default=DEFAULT_EXPECTED_SOURCE_COUNT)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--checkpoint-file", default="/tmp/lexrex_tax_import/checkpoint.json")
    parser.add_argument("--output-dir", default="/tmp/lexrex_tax_import")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Actually write to destination ChromaDB")
    parser.add_argument(
        "--source-is-copy",
        action="store_true",
        help="Confirms the source snapshot is a disposable copy, not the shared original",
    )
    parser.add_argument("--chroma-host", default="localhost")
    parser.add_argument("--chroma-port", type=int, default=8000)
    parser.add_argument(
        "--destination-local-path",
        help="For isolated /tmp tests only. Writes to a local Chroma persist directory instead of HTTP.",
    )
    return parser.parse_args()


def resolve_source_snapshot(args: argparse.Namespace) -> Path:
    if args.source_snapshot:
        return Path(args.source_snapshot).expanduser().resolve()
    source_dir = Path(args.source_dir).expanduser().resolve()
    candidate = source_dir / "chroma_tax_db"
    return candidate if candidate.exists() else source_dir


def connect_readonly(sqlite_path: Path) -> sqlite3.Connection:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"source chroma sqlite not found: {sqlite_path}")
    return sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)


def safe_output_path(path_text: str, field_name: str) -> Path:
    path = Path(path_text).expanduser().resolve()
    home_data = (Path.home() / "LexRexData").resolve()
    allowed_prefixes = ("/tmp/", "/private/tmp/", str(home_data) + "/")
    if not str(path).startswith(allowed_prefixes):
        raise ValueError(f"{field_name} must be under /tmp or ~/LexRexData")
    return path


def validate_args(args: argparse.Namespace) -> None:
    destination = args.destination_collection.strip()
    if destination in PROTECTED_COLLECTIONS:
        raise ValueError(f"protected collection cannot be used as destination: {destination}")
    if destination != DEFAULT_DESTINATION and not destination.startswith("tax_"):
        raise ValueError("destination collection must be tax-specific")
    if args.batch_size <= 0 or args.batch_size > 10_000:
        raise ValueError("batch-size must be between 1 and 10000")
    if args.expected_source_count <= 0:
        raise ValueError("expected-source-count must be positive")
    safe_output_path(args.checkpoint_file, "checkpoint-file")
    safe_output_path(args.output_dir, "output-dir")
    if args.apply and not args.source_is_copy:
        raise ValueError("--apply requires --source-is-copy so the shared snapshot is never opened by a writer client")
    if args.destination_local_path:
        local_path = Path(args.destination_local_path).expanduser().resolve()
        if not str(local_path).startswith(("/tmp/", "/private/tmp/")):
            raise ValueError("destination-local-path is allowed only under /tmp for isolated tests")


def inspect_source(snapshot: Path) -> dict[str, Any]:
    conn = connect_readonly(snapshot / "chroma.sqlite3")
    try:
        cur = conn.cursor()
        collection_rows = cur.execute("SELECT id, name, dimension FROM collections ORDER BY name").fetchall()
        collection_ids = [row[0] for row in collection_rows]
        metric_rows = []
        if collection_ids:
            placeholders = ",".join("?" for _ in collection_ids)
            metric_rows = cur.execute(
                f"SELECT collection_id, key, str_value FROM collection_metadata "
                f"WHERE collection_id IN ({placeholders}) AND key = 'hnsw:space'",
                collection_ids,
            ).fetchall()
        metrics_by_collection_id = {row[0]: row[2] for row in metric_rows}
        collections = [
            {
                "id": row[0],
                "name": row[1],
                "dimension": row[2],
                "metric": metrics_by_collection_id.get(row[0], ""),
            }
            for row in collection_rows
        ]
        embeddings = cur.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
        unique_ids = cur.execute("SELECT COUNT(DISTINCT embedding_id) FROM embeddings").fetchone()[0]
        metadata_keys = {
            key: count
            for key, count in cur.execute(
                "SELECT key, COUNT(*) FROM embedding_metadata GROUP BY key ORDER BY COUNT(*) DESC"
            ).fetchall()
        }
        source_ids = None
        if embeddings <= 100_000:
            source_ids = {
                row[0]
                for row in cur.execute("SELECT embedding_id FROM embeddings")
            }
        return {
            "collections": collections,
            "embeddingRows": embeddings,
            "uniqueEmbeddingIds": unique_ids,
            "metadataKeys": metadata_keys,
            "sourceIds": source_ids,
        }
    finally:
        conn.close()


def snapshot_fingerprint(snapshot: Path, source_info: dict[str, Any]) -> str:
    sqlite_path = snapshot / "chroma.sqlite3"
    stat = sqlite_path.stat()
    payload = {
        "sqliteSize": stat.st_size,
        "sqliteMtimeNs": stat.st_mtime_ns,
        "collections": source_info["collections"],
        "embeddingRows": source_info["embeddingRows"],
        "uniqueEmbeddingIds": source_info["uniqueEmbeddingIds"],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_failure(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def validate_source_info(source_info: dict[str, Any], expected_count: int) -> None:
    names = {c["name"] for c in source_info["collections"]}
    if SOURCE_COLLECTION not in names:
        raise ValueError(f"source collection not found: {SOURCE_COLLECTION}")
    if source_info["uniqueEmbeddingIds"] != expected_count:
        raise ValueError(
            f"source unique ID count mismatch: expected={expected_count}, actual={source_info['uniqueEmbeddingIds']}"
        )
    if source_info["embeddingRows"] != source_info["uniqueEmbeddingIds"]:
        raise ValueError(
            f"source duplicate embedding IDs detected: rows={source_info['embeddingRows']}, "
            f"unique={source_info['uniqueEmbeddingIds']}"
        )
    source_collection = next(c for c in source_info["collections"] if c["name"] == SOURCE_COLLECTION)
    if source_collection.get("dimension") != EXPECTED_DIMENSION:
        raise ValueError(f"source dimension mismatch: {source_collection.get('dimension')}")
    metric = (source_collection.get("metric") or "").lower()
    if metric and metric != EXPECTED_METRIC:
        raise ValueError(f"source metric mismatch: {metric}")


def import_chromadb():
    try:
        import chromadb  # type: ignore
    except Exception as exc:
        raise RuntimeError("chromadb package is required only for apply/isolated fixture mode") from exc
    return chromadb


def get_destination_client(args: argparse.Namespace):
    chromadb = import_chromadb()
    if args.destination_local_path:
        return chromadb.PersistentClient(path=str(Path(args.destination_local_path).expanduser().resolve()))
    return chromadb.HttpClient(host=args.chroma_host, port=args.chroma_port)


def count_collection_if_exists(client: Any, name: str) -> int | None:
    try:
        return int(client.get_collection(name).count())
    except Exception:
        return None


def get_collection_ids(collection: Any, batch_size: int = 5000) -> set[str]:
    total = int(collection.count())
    ids: set[str] = set()
    for offset in range(0, total, batch_size):
        batch = collection.get(include=[], limit=min(batch_size, total - offset), offset=offset)
        ids.update(batch.get("ids") or [])
    return ids


def verify_protected_counts(client: Any, before: dict[str, int | None]) -> None:
    after = {name: count_collection_if_exists(client, name) for name in PROTECTED_COUNT_COLLECTIONS}
    changed = {
        name: {"before": before.get(name), "after": after.get(name)}
        for name in PROTECTED_COUNT_COLLECTIONS
        if before.get(name) != after.get(name)
    }
    if changed:
        raise RuntimeError(f"protected collection count changed: {changed}")


def prepare_destination(client: Any, destination: str, source_ids: set[str], resume: bool) -> tuple[Any, set[str]]:
    try:
        destination_collection = client.get_collection(destination)
        existing_count = int(destination_collection.count())
    except Exception:
        destination_collection = None
        existing_count = 0

    if destination_collection is None:
        destination_collection = client.create_collection(
            destination,
            metadata={"hnsw:space": EXPECTED_METRIC, "source": "tax_tribunal"},
        )
        return destination_collection, set()

    existing_ids = get_collection_ids(destination_collection)
    unexpected_ids = sorted(existing_ids - source_ids)
    if unexpected_ids:
        raise RuntimeError(f"destination contains unexpected IDs, sample={unexpected_ids[:5]}")
    if existing_count > 0 and not resume:
        raise RuntimeError("destination collection already has data; use --resume after verifying it is the same import")
    return destination_collection, existing_ids


@dataclass
class ImportStats:
    processed_batches: int = 0
    processed_ids: int = 0
    added_ids: int = 0
    skipped_existing_ids: int = 0
    failed_batches: int = 0


def write_checkpoint(
    checkpoint: Path,
    *,
    source_hash: str,
    destination: str,
    expected_source_count: int,
    stats: ImportStats,
) -> None:
    write_json(
        checkpoint,
        {
            "sourceSnapshotHash": source_hash,
            "destinationCollection": destination,
            "expectedSourceCount": expected_source_count,
            "processedBatchIndex": stats.processed_batches,
            "processedIdCount": stats.processed_ids,
            "addedIdCount": stats.added_ids,
            "skippedExistingIdCount": stats.skipped_existing_ids,
            "failedBatchCount": stats.failed_batches,
            "lastUpdatedAt": datetime.now(timezone.utc).isoformat(),
        },
    )


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for idx in range(0, len(values), size):
        yield values[idx:idx + size]


def run_apply(
    args: argparse.Namespace,
    snapshot: Path,
    source_info: dict[str, Any],
    source_hash: str,
    steps: StepLogger,
) -> dict[str, Any]:
    steps.log("[STEP 04] opening source PersistentClient")
    source_client = import_chromadb().PersistentClient(path=str(snapshot))
    steps.log("[STEP 05] source PersistentClient opened")
    steps.log("[STEP 06] locating source collection")
    source_collection = source_client.get_collection(SOURCE_COLLECTION)
    steps.log("[STEP 07] source collection opened")
    steps.log("[STEP 08] checking source count")
    source_count = int(source_collection.count())
    if source_count != args.expected_source_count:
        raise RuntimeError(f"source collection count mismatch: expected={args.expected_source_count}, actual={source_count}")

    steps.log("[STEP 09] connecting destination HttpClient")
    destination_client = get_destination_client(args)
    protected_before = {
        name: count_collection_if_exists(destination_client, name)
        for name in PROTECTED_COUNT_COLLECTIONS
    }
    steps.log("[STEP 10] destination preflight completed")

    source_ids = get_collection_ids(source_collection, args.batch_size)
    if len(source_ids) != args.expected_source_count:
        raise RuntimeError(f"source ID set mismatch: expected={args.expected_source_count}, actual={len(source_ids)}")

    destination_collection, existing_ids = prepare_destination(
        destination_client,
        args.destination_collection,
        source_ids,
        args.resume,
    )

    pending_ids = sorted(source_ids - existing_ids)
    output_dir = safe_output_path(args.output_dir, "output-dir")
    failure_log = output_dir / "failed_batches.jsonl"
    checkpoint = safe_output_path(args.checkpoint_file, "checkpoint-file")
    stats = ImportStats(skipped_existing_ids=len(existing_ids))
    started_at = time.time()

    try:
        for batch_ids in chunks(pending_ids, args.batch_size):
            stats.processed_batches += 1
            batch = source_collection.get(
                ids=batch_ids,
                include=["documents", "metadatas", "embeddings"],
            )
            ids = batch.get("ids")
            documents = batch.get("documents")
            metadatas = batch.get("metadatas")
            embeddings = batch.get("embeddings")
            ids = [] if ids is None else list(ids)
            documents = [] if documents is None else list(documents)
            metadatas = [] if metadatas is None else list(metadatas)
            embeddings = [] if embeddings is None else embeddings.tolist() if hasattr(embeddings, "tolist") else list(embeddings)
            try:
                if not (len(ids) == len(documents) == len(metadatas) == len(embeddings)):
                    raise RuntimeError("source batch lengths are inconsistent")
                destination_collection.add(
                    ids=ids,
                    documents=documents,
                    metadatas=metadatas,
                    embeddings=embeddings,
                )
                stats.processed_ids += len(ids)
                stats.added_ids += len(ids)
            except Exception as exc:
                stats.failed_batches += 1
                append_failure(
                    failure_log,
                    {
                        "batchIndex": stats.processed_batches,
                        "firstId": ids[0] if ids else "",
                        "count": len(ids),
                        "error": str(exc)[:500],
                    },
                )
                raise
            finally:
                write_checkpoint(
                    checkpoint,
                    source_hash=source_hash,
                    destination=args.destination_collection,
                    expected_source_count=args.expected_source_count,
                    stats=stats,
                )
    except KeyboardInterrupt:
        write_checkpoint(
            checkpoint,
            source_hash=source_hash,
            destination=args.destination_collection,
            expected_source_count=args.expected_source_count,
            stats=stats,
        )
        raise

    final_count = int(destination_collection.count())
    if final_count != args.expected_source_count:
        raise RuntimeError(f"destination final count mismatch: expected={args.expected_source_count}, actual={final_count}")
    destination_ids = get_collection_ids(destination_collection, args.batch_size)
    if destination_ids != source_ids:
        missing = sorted(source_ids - destination_ids)[:5]
        extra = sorted(destination_ids - source_ids)[:5]
        raise RuntimeError(f"destination ID set mismatch: missing={missing}, extra={extra}")
    verify_protected_counts(destination_client, protected_before)

    return {
        "processedBatches": stats.processed_batches,
        "processedIds": stats.processed_ids,
        "addedIds": stats.added_ids,
        "skippedExistingIds": stats.skipped_existing_ids,
        "failedBatches": stats.failed_batches,
        "finalDestinationCount": final_count,
        "elapsedSeconds": round(time.time() - started_at, 3),
        "failureLog": str(failure_log),
        "checkpointFile": str(checkpoint),
        "protectedCountsBefore": protected_before,
    }


def build_plan(args: argparse.Namespace, snapshot: Path, source_info: dict[str, Any], source_hash: str) -> dict[str, Any]:
    source_collection_names = [c["name"] for c in source_info["collections"]]
    source_dimensions = sorted({c["dimension"] for c in source_info["collections"] if c.get("dimension") is not None})
    source_metrics = sorted({c["metric"] for c in source_info["collections"] if c.get("metric")})
    return {
        "mode": "apply" if args.apply else "dry-run",
        "preflightOnly": bool(args.preflight_only),
        "sourceSnapshot": str(snapshot),
        "sourceSnapshotHash": source_hash,
        "sourceCollections": source_collection_names,
        "destinationCollection": args.destination_collection,
        "expectedSourceCount": args.expected_source_count,
        "batchSize": args.batch_size,
        "expectedBatches": math.ceil(source_info["uniqueEmbeddingIds"] / args.batch_size),
        "resume": args.resume,
        "sourceInfo": {
            "embeddingRows": source_info["embeddingRows"],
            "uniqueEmbeddingIds": source_info["uniqueEmbeddingIds"],
            "dimensions": source_dimensions,
            "metrics": source_metrics,
        },
        "safety": {
            "deleteCollectionImplemented": False,
            "upsertImplemented": False,
            "addOnly": True,
            "sourceOpenedReadOnlyForPreflight": True,
            "protectedCollections": sorted(PROTECTED_COLLECTIONS),
            "protectedCountCollections": list(PROTECTED_COUNT_COLLECTIONS),
            "applyRequiresSourceCopy": True,
            "checkpointFile": str(safe_output_path(args.checkpoint_file, "checkpoint-file")),
            "outputDir": str(safe_output_path(args.output_dir, "output-dir")),
        },
    }


def main() -> int:
    steps = StepLogger()
    args = parse_args()
    steps.log("[STEP 01] CLI parsed")
    validate_args(args)
    snapshot = resolve_source_snapshot(args)
    steps.log("[STEP 02] checkpoint loaded")
    source_info = inspect_source(snapshot)
    validate_source_info(source_info, args.expected_source_count)
    source_hash = snapshot_fingerprint(snapshot, source_info)
    steps.log("[STEP 03] source hash calculated")
    plan = build_plan(args, snapshot, source_info, source_hash)
    checkpoint = safe_output_path(args.checkpoint_file, "checkpoint-file")
    write_json(
        checkpoint,
        {
            "sourceSnapshotHash": source_hash,
            "destinationCollection": args.destination_collection,
            "expectedSourceCount": args.expected_source_count,
            "processedBatchIndex": 0,
            "processedIdCount": 0,
            "addedIdCount": 0,
            "skippedExistingIdCount": 0,
            "failedBatchCount": 0,
            "lastUpdatedAt": datetime.now(timezone.utc).isoformat(),
            "mode": plan["mode"],
        },
    )

    if args.preflight_only or not args.apply:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    result = run_apply(args, snapshot, source_info, source_hash, steps)
    plan["applyResult"] = result
    summary_path = safe_output_path(args.output_dir, "output-dir") / "summary.json"
    write_json(summary_path, plan)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
