#!/usr/bin/env python3
"""Export tax tribunal Chroma snapshot rows into resumable shard files.

Default mode is dry-run. Shard files are written only with --apply.
The source snapshot must be a disposable copy, not the shared original.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXPORTER_VERSION = "tax-shard-export-v1"
DEFAULT_COLLECTION = "tax_precedents"
DEFAULT_EXPECTED_COUNT = 499_361
EXPECTED_DIMENSION = 768
EXPECTED_METRIC = "cosine"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export tax Chroma snapshot into shard files.")
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--source-collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--output-dir", default="/tmp/lexrex_tax_export")
    parser.add_argument("--shard-size", type=int, default=5000)
    parser.add_argument("--expected-count", type=int, default=DEFAULT_EXPECTED_COUNT)
    parser.add_argument("--checkpoint-file")
    parser.add_argument("--manifest-file")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true", help="Actually create shard files")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def resolve_snapshot(source_dir: str) -> Path:
    root = Path(source_dir).expanduser().resolve()
    candidate = root / "chroma_tax_db"
    return candidate if candidate.exists() else root


def safe_output_path(path: Path) -> Path:
    path = path.expanduser().resolve()
    home_data = (Path.home() / "LexRexData").resolve()
    allowed = ("/tmp/", "/private/tmp/", str(home_data) + "/")
    if not str(path).startswith(allowed):
        raise ValueError("output paths must be under /tmp or ~/LexRexData")
    return path


def sqlite_info(snapshot: Path, collection_name: str) -> dict[str, Any]:
    sqlite_path = snapshot / "chroma.sqlite3"
    if not sqlite_path.exists():
        raise FileNotFoundError(f"missing source sqlite: {sqlite_path}")
    conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id, name, dimension FROM collections WHERE name = ?",
            (collection_name,),
        ).fetchone()
        if not row:
            raise ValueError(f"source collection not found: {collection_name}")
        metric_row = cur.execute(
            "SELECT str_value FROM collection_metadata WHERE collection_id = ? AND key = 'hnsw:space'",
            (row[0],),
        ).fetchone()
        count = cur.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
        unique_count = cur.execute("SELECT COUNT(DISTINCT embedding_id) FROM embeddings").fetchone()[0]
        missing_docs = cur.execute(
            """
            SELECT COUNT(*)
            FROM embeddings e
            LEFT JOIN embedding_metadata m
              ON e.id = m.id AND m.key = 'chroma:document'
            WHERE m.string_value IS NULL OR TRIM(m.string_value) = ''
            """
        ).fetchone()[0]
        stat = sqlite_path.stat()
        payload = {
            "sqliteSize": stat.st_size,
            "sqliteMtimeNs": stat.st_mtime_ns,
            "collectionId": row[0],
            "collectionName": row[1],
            "dimension": row[2],
            "metric": metric_row[0] if metric_row else "",
            "count": count,
            "uniqueCount": unique_count,
        }
        payload["snapshotHash"] = hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        payload["missingDocuments"] = missing_docs
        return payload
    finally:
        conn.close()


def validate_args(args: argparse.Namespace, info: dict[str, Any]) -> None:
    if args.shard_size <= 0 or args.shard_size > 50_000:
        raise ValueError("shard-size must be between 1 and 50000")
    if args.expected_count <= 0:
        raise ValueError("expected-count must be positive")
    if info["uniqueCount"] != args.expected_count:
        raise ValueError(f"source unique count mismatch: expected={args.expected_count}, actual={info['uniqueCount']}")
    if info["count"] != info["uniqueCount"]:
        raise ValueError(f"duplicate source IDs detected: rows={info['count']}, unique={info['uniqueCount']}")
    if info["dimension"] != EXPECTED_DIMENSION:
        raise ValueError(f"dimension mismatch: {info['dimension']}")
    if (info["metric"] or "").lower() != EXPECTED_METRIC:
        raise ValueError(f"metric mismatch: {info['metric']}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_checkpoint(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "processedOffset": 0,
        "processedRows": 0,
        "completedShardIndexes": [],
        "lastExportedId": "",
        "failedShardIndexes": [],
        "lastUpdatedAt": utc_now(),
    }


def save_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    payload["lastUpdatedAt"] = utc_now()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def import_chromadb():
    try:
        import chromadb  # type: ignore
    except Exception as exc:
        raise RuntimeError("chromadb import failed. Use the isolated compatible reader venv.") from exc
    return chromadb


def prepare_chromadb_0523_compat(snapshot: Path, collection_name: str) -> dict[str, Any]:
    """Patch a disposable snapshot copy so chromadb 0.5.23 can read it.

    The shared source snapshot was produced with a newer on-disk schema. The
    original files must stay untouched; this function is intended only for the
    APFS clone/copy used as the export source.
    """
    sqlite_path = snapshot / "chroma.sqlite3"
    conn = sqlite3.connect(sqlite_path)
    patched: dict[str, Any] = {
        "collectionConfigPatched": False,
        "indexMetadataPatched": False,
        "collectionConfigBackup": "",
        "indexMetadataBackup": "",
    }
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id, config_json_str FROM collections WHERE name = ?",
            (collection_name,),
        ).fetchone()
        if not row:
            raise ValueError(f"source collection not found: {collection_name}")
        collection_id, config_json = row
        try:
            parsed_config = json.loads(config_json or "{}")
        except json.JSONDecodeError:
            parsed_config = {}
        if parsed_config.get("_type") != "CollectionConfigurationInternal":
            backup = snapshot / "lexrex_collection_config_backup.json"
            if not backup.exists():
                backup.write_text(
                    json.dumps(
                        {
                            "collection": collection_name,
                            "originalConfigJsonStr": config_json,
                            "backedUpAt": utc_now(),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            compat_config = {
                "hnsw_configuration": {
                    "space": EXPECTED_METRIC,
                    "ef_construction": 100,
                    "ef_search": 100,
                    "num_threads": 23,
                    "M": 16,
                    "resize_factor": 1.2,
                    "batch_size": 100,
                    "sync_threshold": 1000,
                    "_type": "HNSWConfigurationInternal",
                },
                "_type": "CollectionConfigurationInternal",
            }
            cur.execute(
                "UPDATE collections SET config_json_str = ? WHERE id = ?",
                (json.dumps(compat_config), collection_id),
            )
            conn.commit()
            patched["collectionConfigPatched"] = True
            patched["collectionConfigBackup"] = str(backup)

        segment_row = cur.execute(
            "SELECT id FROM segments WHERE collection = ? AND scope = 'VECTOR'",
            (collection_id,),
        ).fetchone()
        if not segment_row:
            raise ValueError(f"vector segment not found for collection: {collection_name}")
        segment_id = segment_row[0]
    finally:
        conn.close()

    metadata_path = snapshot / segment_id / "index_metadata.pickle"
    if not metadata_path.exists():
        raise FileNotFoundError(f"missing index metadata: {metadata_path}")

    # Import only inside the isolated compatible reader environment.
    from chromadb.segment.impl.vector.local_persistent_hnsw import PersistentData  # type: ignore

    with metadata_path.open("rb") as f:
        loaded = pickle_load(f)
    if isinstance(loaded, dict):
        backup = metadata_path.with_name("index_metadata.lexrex_original_dict.pickle")
        if not backup.exists():
            shutil.copy2(metadata_path, backup)
        obj = PersistentData(
            dimensionality=loaded.get("dimensionality") or EXPECTED_DIMENSION,
            total_elements_added=loaded.get("total_elements_added")
            or len(loaded.get("id_to_label", {})),
            id_to_label=loaded.get("id_to_label", {}),
            label_to_id=loaded.get("label_to_id", {}),
            id_to_seq_id=loaded.get("id_to_seq_id", {}),
        )
        with metadata_path.open("wb") as f:
            pickle_dump(obj, f)
        patched["indexMetadataPatched"] = True
        patched["indexMetadataBackup"] = str(backup)
    return patched


def pickle_load(file_obj):
    import pickle

    return pickle.load(file_obj)


def pickle_dump(obj: Any, file_obj) -> None:
    import pickle

    pickle.dump(obj, file_obj)


def export_shards(args: argparse.Namespace, snapshot: Path, info: dict[str, Any]) -> dict[str, Any]:
    import numpy as np  # type: ignore

    compat_patch = prepare_chromadb_0523_compat(snapshot, args.source_collection)
    chromadb = import_chromadb()
    client = chromadb.PersistentClient(path=str(snapshot))
    collection = client.get_collection(args.source_collection)

    output_dir = safe_output_path(Path(args.output_dir))
    shards_dir = output_dir / "shards"
    checkpoint_file = safe_output_path(Path(args.checkpoint_file or output_dir / "checkpoint.json"))
    manifest_file = safe_output_path(Path(args.manifest_file or output_dir / "manifest.json"))
    shards_dir.mkdir(parents=True, exist_ok=True)

    target_rows = min(args.limit or info["uniqueCount"], info["uniqueCount"])
    total_shards = math.ceil(target_rows / args.shard_size)
    checkpoint = load_checkpoint(checkpoint_file) if args.resume else load_checkpoint(Path("__missing_checkpoint__"))
    completed = set(int(i) for i in checkpoint.get("completedShardIndexes", []))

    shard_entries: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    missing_embeddings = 0
    metadata_only = 0
    missing_documents = 0
    exported = 0

    for shard_index in range(total_shards):
        if shard_index in completed:
            continue
        offset = shard_index * args.shard_size
        limit = min(args.shard_size, target_rows - offset)
        result = collection.get(
            limit=limit,
            offset=offset,
            include=["documents", "metadatas", "embeddings"],
        )
        ids = [str(v) for v in result.get("ids", [])]
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        embeddings = result.get("embeddings")
        if embeddings is None:
            missing_embeddings += len(ids)
            raise ValueError(f"missing embeddings at shard {shard_index}")
        arr = np.asarray(embeddings, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[1] != EXPECTED_DIMENSION:
            raise ValueError(f"embedding shape mismatch at shard {shard_index}: {arr.shape}")
        meta_path = shards_dir / f"shard_{shard_index:05d}.meta.jsonl.gz"
        emb_path = shards_dir / f"shard_{shard_index:05d}.embeddings.npy"
        with gzip.open(meta_path, "wt", encoding="utf-8") as f:
            for row_id, doc, meta in zip(ids, documents, metadatas):
                if row_id in seen_ids:
                    raise ValueError(f"duplicate ID during export: {row_id}")
                seen_ids.add(row_id)
                doc_text = "" if doc is None else str(doc)
                if not doc_text.strip():
                    missing_documents += 1
                if not doc_text.strip() and meta:
                    metadata_only += 1
                f.write(json.dumps({"id": row_id, "document": doc_text, "metadata": meta or {}}, ensure_ascii=False) + "\n")
        np.save(emb_path, arr)
        entry = {
            "shardIndex": shard_index,
            "rowCount": len(ids),
            "firstId": ids[0] if ids else "",
            "lastId": ids[-1] if ids else "",
            "metadataPath": str(meta_path),
            "embeddingsPath": str(emb_path),
            "metadataSha256": sha256_file(meta_path),
            "embeddingsSha256": sha256_file(emb_path),
            "embeddingShape": list(arr.shape),
            "embeddingDtype": str(arr.dtype),
        }
        shard_entries.append(entry)
        exported += len(ids)
        checkpoint["processedOffset"] = offset + len(ids)
        checkpoint["processedRows"] = checkpoint.get("processedRows", 0) + len(ids)
        checkpoint["completedShardIndexes"] = sorted(set(checkpoint.get("completedShardIndexes", [])) | {shard_index})
        checkpoint["lastExportedId"] = entry["lastId"]
        save_checkpoint(checkpoint_file, checkpoint)
        print(
            f"[export] shard={shard_index + 1}/{total_shards} rows={len(ids)} "
            f"exported={exported}/{target_rows}",
            file=sys.stderr,
            flush=True,
        )

    manifest = {
        "sourceSnapshotPath": str(snapshot),
        "sourceCollection": args.source_collection,
        "sourceUniqueCount": info["uniqueCount"],
        "sourceSnapshotHash": info["snapshotHash"],
        "compatibilityPatch": compat_patch,
        "embeddingDimension": EXPECTED_DIMENSION,
        "distanceMetric": EXPECTED_METRIC,
        "shardSize": args.shard_size,
        "totalShards": total_shards,
        "totalExportedRows": exported,
        "duplicateIds": 0,
        "missingDocuments": missing_documents,
        "missingEmbeddings": missing_embeddings,
        "metadataOnlyRows": metadata_only,
        "createdAt": utc_now(),
        "exporterVersion": EXPORTER_VERSION,
        "shards": shard_entries,
    }
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    started = time.time()
    args = parse_args()
    snapshot = resolve_snapshot(args.source_dir)
    output_dir = safe_output_path(Path(args.output_dir))
    checkpoint_file = safe_output_path(Path(args.checkpoint_file or output_dir / "checkpoint.json"))
    manifest_file = safe_output_path(Path(args.manifest_file or output_dir / "manifest.json"))
    info = sqlite_info(snapshot, args.source_collection)
    validate_args(args, info)
    target_rows = min(args.limit or info["uniqueCount"], info["uniqueCount"])
    base_summary = {
        "mode": "apply" if args.apply else "dry-run",
        "sourceSnapshotPath": str(snapshot),
        "sourceCollection": args.source_collection,
        "sourceUniqueCount": info["uniqueCount"],
        "sourceSnapshotHash": info["snapshotHash"],
        "embeddingDimension": info["dimension"],
        "distanceMetric": info["metric"],
        "targetRows": target_rows,
        "shardSize": args.shard_size,
        "expectedShards": math.ceil(target_rows / args.shard_size),
        "checkpointFile": str(checkpoint_file),
        "manifestFile": str(manifest_file),
        "dryRunCreatesShards": False,
    }
    if not args.apply:
        print(json.dumps(base_summary, ensure_ascii=False, indent=2))
        return 0
    manifest = export_shards(args, snapshot, info)
    manifest["elapsedSeconds"] = round(time.time() - started, 3)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
