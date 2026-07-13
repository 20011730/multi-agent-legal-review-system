#!/usr/bin/env python3
"""Guarded add-only importer for tax shard exports.

Default mode is dry-run. Writes occur only with --apply.
For fixture tests, use --destination-local-path under /tmp.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path
from typing import Any


PROTECTED_COLLECTIONS = {
    "laws",
    "laws_e5",
    "laws_e5_full",
    "laws_e5_full_sample",
    "cases_e5",
    "legal_case_chunks_full",
}
DEFAULT_DESTINATION = "tax_tribunal_e5_full"
EXPECTED_DIMENSION = 768


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run or add-only import tax shard export.")
    parser.add_argument("--manifest-file", required=True)
    parser.add_argument("--destination-collection", default=DEFAULT_DESTINATION)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--checkpoint-file", default="/tmp/lexrex_tax_shard_import/checkpoint.json")
    parser.add_argument("--output-dir", default="/tmp/lexrex_tax_shard_import")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--add-batch-size", type=int, default=1000)
    parser.add_argument("--destination-local-path", help="Allowed only under /tmp for isolated fixture tests")
    parser.add_argument("--chroma-host", default="localhost")
    parser.add_argument("--chroma-port", type=int, default=8000)
    return parser.parse_args()


def safe_path(path_text: str, field_name: str) -> Path:
    path = Path(path_text).expanduser().resolve()
    home_data = (Path.home() / "LexRexData").resolve()
    allowed = ("/tmp/", "/private/tmp/", str(home_data) + "/")
    if not str(path).startswith(allowed):
        raise ValueError(f"{field_name} must be under /tmp or ~/LexRexData")
    return path


def validate_args(args: argparse.Namespace) -> None:
    dest = args.destination_collection.strip()
    if dest in PROTECTED_COLLECTIONS:
        raise ValueError(f"protected collection cannot be destination: {dest}")
    if dest != DEFAULT_DESTINATION and not dest.startswith("tax_"):
        raise ValueError("destination collection must be tax-specific")
    safe_path(args.checkpoint_file, "checkpoint-file")
    safe_path(args.output_dir, "output-dir")
    if args.destination_local_path:
        local = Path(args.destination_local_path).expanduser().resolve()
        if not str(local).startswith(("/tmp/", "/private/tmp/")):
            raise ValueError("destination-local-path is allowed only under /tmp")
    if args.add_batch_size <= 0 or args.add_batch_size > 1000:
        raise ValueError("add-batch-size must be between 1 and 1000")


def load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("embeddingDimension") != EXPECTED_DIMENSION:
        raise ValueError(f"manifest dimension mismatch: {manifest.get('embeddingDimension')}")
    if manifest.get("sourceUniqueCount") and manifest["sourceUniqueCount"] < manifest.get("totalExportedRows", 0):
        raise ValueError("manifest source count is smaller than exported rows")
    return manifest


def read_meta_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def import_numpy():
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        raise RuntimeError("numpy import failed") from exc
    return np


def import_chromadb():
    try:
        import chromadb  # type: ignore
    except Exception as exc:
        raise RuntimeError("chromadb import failed. Use an isolated compatible venv.") from exc
    return chromadb


def load_checkpoint(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"completedShardIndexes": [], "addedIdCount": 0, "skippedExistingIdCount": 0, "failedShardIndexes": []}


def save_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def create_client(args: argparse.Namespace):
    chromadb = import_chromadb()
    if args.destination_local_path:
        return chromadb.PersistentClient(path=str(Path(args.destination_local_path).expanduser().resolve()))
    return chromadb.HttpClient(host=args.chroma_host, port=args.chroma_port)


def existing_ids(collection) -> set[str]:
    try:
        count = collection.count()
        if count <= 0:
            return set()
        got = collection.get(limit=count, include=[])
        return set(str(v) for v in got.get("ids", []))
    except Exception:
        return set()


def source_ids_from_manifest(manifest: dict[str, Any]) -> set[str]:
    source_ids = set()
    for shard in manifest.get("shards", []):
        rows = read_meta_rows(Path(shard["metadataPath"]))
        source_ids.update(str(r["id"]) for r in rows)
    return source_ids


def destination_preflight(args: argparse.Namespace, source_ids: set[str]) -> dict[str, Any]:
    client = create_client(args)
    collections = {c.name: c for c in client.list_collections()}
    if args.destination_collection not in collections:
        return {
            "destinationExists": False,
            "destinationCount": 0,
            "existingSourceIdCount": 0,
            "unexpectedDestinationIdCount": 0,
            "expectedAddCount": len(source_ids),
            "expectedSkipCount": 0,
        }
    collection = collections[args.destination_collection]
    current_ids = existing_ids(collection)
    unexpected = current_ids - source_ids
    return {
        "destinationExists": True,
        "destinationCount": len(current_ids),
        "existingSourceIdCount": len(current_ids & source_ids),
        "unexpectedDestinationIdCount": len(unexpected),
        "unexpectedDestinationIdSample": sorted(unexpected)[:5],
        "expectedAddCount": len(source_ids - current_ids),
        "expectedSkipCount": len(current_ids & source_ids),
    }


def main() -> int:
    started = time.time()
    args = parse_args()
    validate_args(args)
    manifest_path = safe_path(args.manifest_file, "manifest-file")
    checkpoint_file = safe_path(args.checkpoint_file, "checkpoint-file")
    manifest = load_manifest(manifest_path)
    expected = args.expected_count
    exported_rows = int(manifest.get("totalExportedRows", 0))
    if exported_rows != expected:
        raise ValueError(f"expected-count mismatch: expected={expected}, manifestRows={exported_rows}")
    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "destinationCollection": args.destination_collection,
        "expectedCount": expected,
        "manifestRows": exported_rows,
        "shardCount": len(manifest.get("shards", [])),
        "writePerformed": False,
    }
    if not args.apply:
        source_ids = source_ids_from_manifest(manifest)
        summary["sourceUniqueIds"] = len(source_ids)
        summary["duplicateSourceIds"] = exported_rows - len(source_ids)
        try:
            summary["destinationPreflight"] = destination_preflight(args, source_ids)
        except Exception as exc:
            summary["destinationPreflightError"] = str(exc)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    np = import_numpy()
    client = create_client(args)
    collection = client.get_or_create_collection(
        name=args.destination_collection,
        metadata={"hnsw:space": "cosine"},
    )
    source_ids = source_ids_from_manifest(manifest)
    current_ids = existing_ids(collection)
    unexpected = sorted(current_ids - source_ids)
    if unexpected:
        raise ValueError(f"destination has unexpected IDs: {unexpected[:5]}")

    checkpoint = load_checkpoint(checkpoint_file) if args.resume else load_checkpoint(Path("__missing_checkpoint__"))
    completed = set(int(v) for v in checkpoint.get("completedShardIndexes", []))
    added = 0
    skipped = 0
    for shard in manifest.get("shards", []):
        idx = int(shard["shardIndex"])
        if idx in completed:
            continue
        rows = read_meta_rows(Path(shard["metadataPath"]))
        ids = [str(r["id"]) for r in rows]
        docs = [str(r.get("document") or "") for r in rows]
        metas = [r.get("metadata") or {} for r in rows]
        emb = np.load(shard["embeddingsPath"]).astype("float32")
        if emb.ndim != 2 or emb.shape[1] != EXPECTED_DIMENSION:
            raise ValueError(f"embedding shape mismatch in shard {idx}: {emb.shape}")
        keep = [i for i, row_id in enumerate(ids) if row_id not in current_ids]
        if keep:
            for start in range(0, len(keep), args.add_batch_size):
                batch_indexes = keep[start : start + args.add_batch_size]
                collection.add(
                    ids=[ids[i] for i in batch_indexes],
                    documents=[docs[i] for i in batch_indexes],
                    metadatas=[metas[i] for i in batch_indexes],
                    embeddings=emb[batch_indexes].tolist(),
                )
                for i in batch_indexes:
                    current_ids.add(ids[i])
                added += len(batch_indexes)
                checkpoint["addedIdCount"] = checkpoint.get("addedIdCount", 0) + len(batch_indexes)
                checkpoint["lastShardIndex"] = idx
                checkpoint["lastShardAddedCount"] = start + len(batch_indexes)
                save_checkpoint(checkpoint_file, checkpoint)
        skipped += len(ids) - len(keep)
        checkpoint["completedShardIndexes"] = sorted(set(checkpoint.get("completedShardIndexes", [])) | {idx})
        checkpoint["skippedExistingIdCount"] = checkpoint.get("skippedExistingIdCount", 0) + (len(ids) - len(keep))
        save_checkpoint(checkpoint_file, checkpoint)
        print(
            f"[import] shard={idx + 1}/{len(manifest.get('shards', []))} "
            f"added={added} skipped={skipped} elapsed={time.time() - started:.1f}s",
            file=sys.stderr,
            flush=True,
        )

    final_ids = existing_ids(collection)
    if final_ids != source_ids:
        raise ValueError(f"final ID set mismatch: source={len(source_ids)}, destination={len(final_ids)}")
    summary.update({"writePerformed": True, "addedIdCount": added, "skippedExistingIdCount": skipped})
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
