#!/usr/bin/env python3
"""Isolated tests for the guarded tax snapshot importer."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("import_tax_snapshot_safe.py")


def load_importer():
    spec = importlib.util.spec_from_file_location("import_tax_snapshot_safe", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load importer module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ImportTaxSnapshotSafeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="lexrex_tax_importer_test_", dir="/tmp"))
        self.source = self.tmp / "source"
        self.destination = self.tmp / "destination"
        self.output = self.tmp / "output"
        self.checkpoint = self.tmp / "checkpoint.json"
        self.importer = load_importer()
        chromadb = self.importer.import_chromadb()
        client = chromadb.PersistentClient(path=str(self.source))
        collection = client.create_collection(
            self.importer.SOURCE_COLLECTION,
            metadata={"hnsw:space": self.importer.EXPECTED_METRIC},
        )
        ids = [f"tax-fixture-{idx:03d}" for idx in range(100)]
        collection.add(
            ids=ids,
            documents=[f"조세 심판례 fixture 본문 {idx}" for idx in range(100)],
            metadatas=[
                {
                    "doc_number": f"조심-{idx // 3:03d}",
                    "tax_type": "부가가치세",
                    "decision_type": "기각",
                    "attr_year": "2026",
                    "section_type": "상세내용",
                }
                for idx in range(100)
            ],
            embeddings=[[float(idx % 7) / 10.0 for _ in range(self.importer.EXPECTED_DIMENSION)] for idx in range(100)],
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_importer(self, *extra: str) -> subprocess.CompletedProcess[str]:
        cmd = [
            sys.executable,
            str(SCRIPT),
            "--source-snapshot",
            str(self.source),
            "--destination-collection",
            "tax_tribunal_e5_full",
            "--expected-source-count",
            "100",
            "--batch-size",
            "25",
            "--checkpoint-file",
            str(self.checkpoint),
            "--output-dir",
            str(self.output),
            *extra,
        ]
        return subprocess.run(cmd, text=True, capture_output=True, check=False)

    def test_dry_run_does_not_create_destination(self) -> None:
        result = self.run_importer("--dry-run", "--destination-local-path", str(self.destination))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.destination.exists())
        self.assertTrue(self.checkpoint.exists())

    def test_protected_destination_is_rejected(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--source-snapshot",
                str(self.source),
                "--destination-collection",
                "laws_e5_full",
                "--expected-source-count",
                "100",
                "--checkpoint-file",
                str(self.checkpoint),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("protected collection", result.stderr)

    def test_apply_add_only_and_resume(self) -> None:
        first = self.run_importer(
            "--apply",
            "--source-is-copy",
            "--destination-local-path",
            str(self.destination),
        )
        self.assertEqual(first.returncode, 0, first.stderr)
        chromadb = self.importer.import_chromadb()
        client = chromadb.PersistentClient(path=str(self.destination))
        collection = client.get_collection("tax_tribunal_e5_full")
        self.assertEqual(collection.count(), 100)

        blocked = self.run_importer(
            "--apply",
            "--source-is-copy",
            "--destination-local-path",
            str(self.destination),
        )
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("already has data", blocked.stderr)

        resumed = self.run_importer(
            "--apply",
            "--source-is-copy",
            "--resume",
            "--destination-local-path",
            str(self.destination),
        )
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(collection.count(), 100)

    def test_source_count_mismatch_is_rejected(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--source-snapshot",
                str(self.source),
                "--destination-collection",
                "tax_tribunal_e5_full",
                "--expected-source-count",
                "101",
                "--checkpoint-file",
                str(self.checkpoint),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source unique ID count mismatch", result.stderr)

    def test_unexpected_destination_id_is_rejected(self) -> None:
        first = self.run_importer(
            "--apply",
            "--source-is-copy",
            "--destination-local-path",
            str(self.destination),
        )
        self.assertEqual(first.returncode, 0, first.stderr)
        chromadb = self.importer.import_chromadb()
        client = chromadb.PersistentClient(path=str(self.destination))
        collection = client.get_collection("tax_tribunal_e5_full")
        collection.add(
            ids=["unexpected-tax-id"],
            documents=["예상 밖 ID"],
            metadatas=[{"doc_number": "unexpected"}],
            embeddings=[[0.1 for _ in range(self.importer.EXPECTED_DIMENSION)]],
        )

        resumed = self.run_importer(
            "--apply",
            "--source-is-copy",
            "--resume",
            "--destination-local-path",
            str(self.destination),
        )
        self.assertNotEqual(resumed.returncode, 0)
        self.assertIn("unexpected IDs", resumed.stderr)


if __name__ == "__main__":
    unittest.main()
