#!/usr/bin/env python3
"""
Safe current-law body embedding helper.

Reads the merged current-law JSONL, supplements the small set of existing
PostgreSQL law_documents rows with SELECT-only access, chunks law bodies using
the current E5 law chunking policy, and optionally upserts into a new ChromaDB
collection. It never deletes collections and never writes to PostgreSQL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any

DEFAULT_INPUT = Path("~/LexRexData/law_collection_full_20260602/law_bodies_merged_final.jsonl").expanduser()
DEFAULT_OUTPUT_DIR = Path("/tmp/lexrex_law_embedding")
DEFAULT_COLLECTION = "laws_e5_full"
DEFAULT_SAMPLE_COLLECTION = "laws_e5_full_sample"
MODEL_NAME = "intfloat/multilingual-e5-base"
EXPECTED_DIMENSION = 768
MAX_TOKENS = 512
SAFETY = 12
TOKEN_BUDGET = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40
UPSERT_BATCH = 128
PROTECTED_COLLECTIONS = {
    "laws",
    "laws_e5",
    "cases_e5",
    "legal_case_chunks_full",
    "legal_case_chunks_sample",
    "laws_e5_test_20260601",
    "laws_e5_test_full_20260601",
}

ART_HEADING = re.compile(r"제\d+조(?:의\d+)?(?=\(|\s*삭제)")
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")
ADDENDA_HDR = re.compile(r"부\s*칙\s*(<[^>]*>|\([^)]*시행[^)]*\))?")
BYEOLPYO = re.compile(r"별\s*[표지]")
HANG_SPLIT = re.compile(r"(?=[\u2460-\u2473])")
HO_SPLIT = re.compile(r"(?=\s+\d+\.\s)")
SAFE_ID_RE = re.compile(r"[^0-9A-Za-z가-힣_#:-]+")

STOP_REQUESTED = False


@dataclass
class LawRecord:
    law_mst: str
    title: str
    short_name: str
    department: str
    enforce_date: str
    revision_type: str
    url: str
    raw_content: str
    source: str


@dataclass
class LawChunk:
    chunk_id: str
    document: str
    metadata: dict[str, Any]
    token_count: int


class TokenCounter:
    def __init__(self, model_name: str = MODEL_NAME, prefer_fast_estimate: bool = False):
        self.tokenizer = None
        self.model_name = model_name
        if prefer_fast_estimate:
            self.mode = "approx"
            return
        try:
            from transformers import AutoTokenizer

            self.tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=True)
            self.mode = "tokenizer"
        except Exception:
            self.mode = "approx"

    def count(self, text: str) -> int:
        value = f"passage: {text or ''}"
        if self.tokenizer is not None:
            return len(self.tokenizer.encode(value, add_special_tokens=True))
        return max(1, int(len(value) / 1.8))

    def split_window(self, head: str, text: str) -> list[str]:
        if self.tokenizer is None:
            budget_chars = max(256, int(TOKEN_BUDGET * 1.8) - len(head))
            overlap_chars = max(20, int(WINDOW_OVERLAP * 1.8))
            chunks: list[str] = []
            start = 0
            text = text or ""
            while start < len(text):
                part = text[start : start + budget_chars].strip()
                if part:
                    chunks.append(f"{head} {part}".strip())
                if start + budget_chars >= len(text):
                    break
                start += max(1, budget_chars - overlap_chars)
            return chunks or [head]

        tok = self.tokenizer
        head_cost = len(tok.encode(f"passage: {head} ", add_special_tokens=False))
        budget = max(TOKEN_BUDGET - head_cost, 64)
        ids = tok.encode(text or "", add_special_tokens=False)
        chunks: list[str] = []
        cursor = 0
        while cursor < len(ids):
            part = tok.decode(ids[cursor : cursor + budget]).strip()
            chunks.append(f"{head} {part}".strip())
            if cursor + budget >= len(ids):
                break
            cursor += max(1, budget - WINDOW_OVERLAP)
        return chunks or [head]

    def truncate(self, text: str) -> str:
        if self.count(text) <= TOKEN_BUDGET:
            return text
        if self.tokenizer is None:
            return text[: int(TOKEN_BUDGET * 1.8)].strip()
        tok = self.tokenizer
        prefix_cost = len(tok.encode("passage: ", add_special_tokens=False)) + 2
        ids = tok.encode(text, add_special_tokens=False)[: TOKEN_BUDGET - prefix_cost]
        out = tok.decode(ids).strip()
        while out and self.count(out) > TOKEN_BUDGET:
            ids = ids[:-8]
            out = tok.decode(ids).strip()
        return out


def handle_signal(signum: int, frame: Any) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True
    print("\n중단 요청을 받았습니다. 현재 batch 후 checkpoint를 저장합니다.", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely chunk and sample-embed current law bodies into a new Chroma collection.",
    )
    parser.add_argument("--input-jsonl", default=str(DEFAULT_INPUT))
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION)
    parser.add_argument("--dry-run", action="store_true", help="Alias for --estimate-only --no-chroma-write.")
    parser.add_argument("--estimate-only", action="store_true", help="Chunk only. No embedding and no Chroma write.")
    parser.add_argument("--limit-laws", type=int, default=None)
    parser.add_argument("--limit-chunks", type=int, default=None)
    parser.add_argument("--offset-laws", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--collection-upsert-batch", type=int, default=UPSERT_BATCH)
    parser.add_argument("--checkpoint-file", default="")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--device", default="auto", help="auto, cpu, mps, cuda")
    parser.add_argument("--no-chroma-write", action="store_true")
    parser.add_argument("--chroma-mode", choices=("http", "local"), default=os.getenv("CHROMA_CLIENT_MODE", "http").lower())
    parser.add_argument("--chroma-host", default=os.getenv("CHROMA_HOST", "localhost"))
    parser.add_argument("--chroma-port", type=int, default=int(os.getenv("CHROMA_PORT", "8000")))
    parser.add_argument("--chroma-path", default=os.getenv("CHROMA_DB_DIR", "./chroma_data"))
    parser.add_argument("--model-name", default=os.getenv("E5_MODEL_NAME", MODEL_NAME))
    parser.add_argument("--embedding-backend", choices=("server", "local"), default="server")
    parser.add_argument("--embedding-url", default=os.getenv("RAG_EMBEDDING_EXTERNAL_URL", "http://localhost:9100"))
    parser.add_argument(
        "--allow-full-run",
        action="store_true",
        help="Explicitly allow a full laws_e5_full run. Keeps all protected collection guards enabled.",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.dry_run:
        args.estimate_only = True
        args.no_chroma_write = True
    if args.batch_size <= 0 or args.collection_upsert_batch <= 0:
        raise SystemExit("batch sizes must be positive.")
    if args.offset_laws < 0:
        raise SystemExit("--offset-laws must be >= 0.")
    if args.limit_laws is not None and args.limit_laws <= 0:
        raise SystemExit("--limit-laws must be positive.")
    if args.limit_chunks is not None and args.limit_chunks <= 0:
        raise SystemExit("--limit-chunks must be positive.")
    collection = args.collection_name.strip()
    lowered = collection.lower()
    if lowered in PROTECTED_COLLECTIONS:
        raise SystemExit(f"Refusing protected collection name: {collection}")
    if lowered in {"laws_e5_full"} and not (args.estimate_only or args.no_chroma_write):
        if args.limit_chunks is None and not args.allow_full_run:
            raise SystemExit("Refusing full production collection write without --allow-full-run.")
    if not args.estimate_only and not args.no_chroma_write and "sample" not in lowered and "test" not in lowered and args.limit_chunks is not None:
        raise SystemExit("Sample writes must use a collection name containing sample or test.")
    if not Path(args.input_jsonl).expanduser().exists():
        raise SystemExit(f"Input JSONL not found: {args.input_jsonl}")


def safe_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc).splitlines()[0][:160]}"


def db_config() -> dict[str, str]:
    return {
        "dbname": os.getenv("DB_NAME", "legalreview"),
        "user": os.getenv("DB_USER", "legalreview"),
        "password": os.getenv("DB_PASSWORD", "legalreview"),
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
    }


def load_jsonl_records(path: Path) -> dict[str, LawRecord]:
    rows: dict[str, LawRecord] = {}
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            if not line.strip():
                continue
            item = json.loads(line)
            law_mst = str(item.get("lawMst") or item.get("referenceId") or item.get("reference_id") or "").strip()
            if not law_mst:
                continue
            rows[law_mst] = LawRecord(
                law_mst=law_mst,
                title=str(item.get("lawName") or item.get("title") or item.get("lawNameKr") or ""),
                short_name=str(item.get("shortName") or item.get("short_name") or item.get("lawName") or ""),
                department=str(item.get("department") or item.get("ministry") or ""),
                enforce_date=str(item.get("enforceDate") or item.get("enforce_date") or ""),
                revision_type=str(item.get("revisionType") or item.get("revision_type") or ""),
                url=str(item.get("url") or ""),
                raw_content=str(item.get("raw_content") or item.get("rawContent") or ""),
                source="merged_jsonl",
            )
    return rows


def fetch_db_supplement(existing: dict[str, LawRecord]) -> dict[str, LawRecord]:
    query = """
        SELECT json_build_object(
            'reference_id', d.reference_id,
            'title', d.title,
            'short_name', d.short_name,
            'department', d.department,
            'enforce_date', d.enforce_date,
            'revision_type', d.revision_type,
            'url', d.url,
            'raw_content', d.raw_content
        )::text
        FROM public.law_documents d
        JOIN public.law_list l
          ON l.law_mst::text = d.reference_id::text
        WHERE d.raw_content IS NOT NULL
          AND length(trim(d.raw_content)) > 0
          AND (l.law_status IS NULL OR l.law_status::text = '3')
        ORDER BY d.reference_id;
    """
    cfg = db_config()
    env = os.environ.copy()
    if cfg.get("password"):
        env["PGPASSWORD"] = cfg["password"]
    cmd = [
        "psql",
        "-h",
        cfg["host"],
        "-p",
        cfg["port"],
        "-U",
        cfg["user"],
        "-d",
        cfg["dbname"],
        "-t",
        "-A",
        "-c",
        query,
    ]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    except FileNotFoundError:
        print("psql CLI not found; DB supplement skipped.", file=sys.stderr)
        return {}
    except subprocess.CalledProcessError as exc:
        print(f"DB supplement SELECT failed: psql exit {exc.returncode}", file=sys.stderr)
        return {}

    out: dict[str, LawRecord] = {}
    for line in proc.stdout.splitlines():
        value = line.strip()
        if not value:
            continue
        item = json.loads(value)
        law_mst = str(item.get("reference_id") or "").strip()
        if not law_mst or law_mst in existing:
            continue
        out[law_mst] = LawRecord(
            law_mst=law_mst,
            title=str(item.get("title") or ""),
            short_name=str(item.get("short_name") or item.get("title") or ""),
            department=str(item.get("department") or ""),
            enforce_date=str(item.get("enforce_date") or ""),
            revision_type=str(item.get("revision_type") or ""),
            url=str(item.get("url") or ""),
            raw_content=str(item.get("raw_content") or ""),
            source="postgres_readonly",
        )
    return out


def clean_text(text: str) -> str:
    text = re.sub(r"</?img[^>]*>", " ", text or "")
    text = re.sub(r"<[^>]*>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def addenda_id(header: str) -> str:
    match = re.search(r"제\s*\d+\s*호", header or "")
    return re.sub(r"\s+", "", match.group(0)) if match else ""


def split_sections(raw: str) -> list[tuple[str, str, int, str]]:
    addenda = list(ADDENDA_HDR.finditer(raw or ""))
    byeolpyo = BYEOLPYO.search(raw or "")
    byeolpyo_pos = byeolpyo.start() if byeolpyo else len(raw or "")
    main_end = min([a.start() for a in addenda] + [byeolpyo_pos]) if (addenda or byeolpyo) else len(raw or "")
    sections = [("MAIN", "", 0, (raw or "")[:main_end])]
    for index, match in enumerate(addenda, 1):
        start = match.end()
        next_positions = [a.start() for a in addenda[index : index + 1]]
        if byeolpyo_pos > start:
            next_positions.append(byeolpyo_pos)
        end = min(next_positions) if next_positions else len(raw or "")
        sections.append(("ADDENDA", addenda_id(match.group(0)), index, (raw or "")[start:end]))
    return sections


def parse_with(text: str, pattern: re.Pattern[str]) -> list[tuple[str, str, str]]:
    heads = [(match.start(), match.group(0)) for match in pattern.finditer(text or "")]
    parsed: list[tuple[str, str, str]] = []
    for index, (position, article_no) in enumerate(heads):
        end = heads[index + 1][0] if index + 1 < len(heads) else len(text or "")
        segment = (text or "")[position:end].strip()
        title_match = ART_TITLE.match(segment)
        if title_match:
            title = title_match.group(1).strip()
            body = segment[title_match.end() :].strip()
        else:
            title = ""
            body = segment[len(article_no) :].strip()
        parsed.append((article_no, title, body))
    return parsed


def parse_law(raw: str) -> list[tuple[str, str, int, str, str, str]]:
    result: list[tuple[str, str, int, str, str, str]] = []
    for section, aid, ordn, text in split_sections(raw):
        articles = parse_with(text, ART_HEADING)
        if not articles and section == "MAIN":
            articles = parse_with(text, ART_HEADING_LENIENT)
        for article_no, title, body in articles:
            result.append((section, aid, ordn, article_no, title, body))
    return result


def pack(counter: TokenCounter, head: str, pieces: list[str]) -> tuple[list[str], int]:
    chunks: list[str] = []
    cur = head
    window_splits = 0
    for piece in pieces:
        candidate = f"{cur} {piece}".strip()
        if counter.count(candidate) <= TOKEN_BUDGET:
            cur = candidate
            continue
        if cur != head:
            chunks.append(cur)
        start = f"{head} {piece}".strip()
        if counter.count(start) <= TOKEN_BUDGET:
            cur = start
        else:
            split = counter.split_window(head, piece)
            chunks.extend(split)
            window_splits += max(0, len(split) - 1)
            cur = head
    if cur != head:
        chunks.append(cur)
    return chunks, window_splits


def chunk_article(counter: TokenCounter, article_no: str, title: str, body: str) -> tuple[list[str], int]:
    head = f"{article_no}({title})" if title else article_no
    whole = f"{head} {body}".strip() if body else head
    if counter.count(whole) <= TOKEN_BUDGET:
        return [whole], 0
    hangs = [part.strip() for part in HANG_SPLIT.split(body) if part.strip()]
    if len(hangs) > 1:
        return pack(counter, head, hangs)
    hos = [part.strip() for part in HO_SPLIT.split(body) if part.strip()]
    if len(hos) > 1:
        return pack(counter, head, hos)
    split = counter.split_window(head, body)
    return split, max(0, len(split) - 1)


def make_safe_id(value: str) -> str:
    return SAFE_ID_RE.sub("_", value).strip("_")


def build_chunks(records: list[LawRecord], counter: TokenCounter, limit_chunks: int | None) -> tuple[list[LawChunk], dict[str, Any]]:
    chunks: list[LawChunk] = []
    used_ids: set[str] = set()
    per_law_counts: list[int] = []
    stats = {
        "mainChunks": 0,
        "addendaChunks": 0,
        "noParseLaws": 0,
        "windowResplits": 0,
        "duplicateIdsAdjusted": 0,
    }

    def unique_id(base: str) -> str:
        candidate = make_safe_id(base)
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate
        index = 2
        while f"{candidate}_{index}" in used_ids:
            index += 1
        stats["duplicateIdsAdjusted"] += 1
        final = f"{candidate}_{index}"
        used_ids.add(final)
        return final

    for law in records:
        if STOP_REQUESTED:
            break
        before = len(chunks)
        parsed = parse_law(law.raw_content)
        if not parsed:
            stats["noParseLaws"] += 1
            per_law_counts.append(0)
            continue
        for section, aid, ordn, article_no, article_title, body in parsed:
            cleaned_body = clean_text(body)
            parent = (
                f"law_{law.law_mst}_{article_no}"
                if section == "MAIN"
                else f"law_{law.law_mst}_부칙{ordn}_{article_no}"
            )
            article_chunks, resplits = chunk_article(counter, article_no, article_title, cleaned_body)
            stats["windowResplits"] += resplits
            n_parts = len(article_chunks)
            for part_index, text in enumerate(article_chunks, 1):
                text = counter.truncate(text)
                chunk_id_base = parent if n_parts == 1 else f"{parent}#p{part_index}"
                metadata = {
                    "referenceId": law.law_mst,
                    "lawMst": law.law_mst,
                    "lawNo": law.law_mst,
                    "lawNameKr": law.title,
                    "title": law.title,
                    "shortName": law.short_name or law.title,
                    "articleNo": article_no,
                    "articleTitle": article_title,
                    "section": section,
                    "addendaId": aid,
                    "addendaOrd": ordn,
                    "parentId": make_safe_id(parent),
                    "partIndex": part_index,
                    "nParts": n_parts,
                    "department": law.department,
                    "enforceDate": law.enforce_date,
                    "revisionType": law.revision_type,
                    "url": law.url,
                    "chunkIndex": len(chunks) + 1,
                    "chunkingStrategy": "article-hang-ho-window-512",
                    "embeddingProvider": "sentence-transformers",
                    "embeddingModel": MODEL_NAME,
                    "sourceType": "LAW",
                    "sourceOrigin": law.source,
                }
                chunks.append(
                    LawChunk(
                        chunk_id=unique_id(chunk_id_base),
                        document=text,
                        metadata=metadata,
                        token_count=counter.count(text),
                    )
                )
                if section == "MAIN":
                    stats["mainChunks"] += 1
                else:
                    stats["addendaChunks"] += 1
                if limit_chunks is not None and len(chunks) >= limit_chunks:
                    per_law_counts.append(len(chunks) - before)
                    stats["perLawCounts"] = per_law_counts
                    return chunks, stats
        per_law_counts.append(len(chunks) - before)

    stats["perLawCounts"] = per_law_counts
    return chunks, stats


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_device(device_arg: str) -> str:
    if device_arg != "auto":
        return device_arg
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def get_chroma_client(args: argparse.Namespace):
    import chromadb

    if args.chroma_mode == "http":
        return chromadb.HttpClient(host=args.chroma_host, port=args.chroma_port)
    return chromadb.PersistentClient(path=args.chroma_path)


def http_json(url: str, payload: dict[str, Any] | None = None, timeout: int = 60) -> Any:
    if payload is None:
        request = urllib.request.Request(url, method="GET")
    else:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"Chroma HTTP {exc.code}: {body}") from exc
    except Exception as exc:
        raise RuntimeError(f"Chroma request failed: {safe_error(exc)}") from exc


def chroma_base_url(args: argparse.Namespace) -> str:
    return f"http://{args.chroma_host}:{args.chroma_port}"


def chroma_v1_collection_id(args: argparse.Namespace, collection_name: str, create: bool) -> str:
    base = chroma_base_url(args)
    try:
        collections = http_json(base + "/api/v1/collections") or []
    except Exception:
        collections = []
    for item in collections:
        if item.get("name") == collection_name:
            return str(item.get("id") or "")
    if not create:
        return ""
    created = http_json(
        base + "/api/v1/collections",
        {"name": collection_name, "get_or_create": True},
        timeout=60,
    )
    collection_id = str((created or {}).get("id") or "")
    if not collection_id:
        raise RuntimeError(f"Chroma collection id not returned for {collection_name}")
    return collection_id


def chroma_v1_count(args: argparse.Namespace, collection_id: str) -> int:
    count = http_json(chroma_base_url(args) + f"/api/v1/collections/{collection_id}/count")
    return int(count)


def embed_and_upsert(args: argparse.Namespace, chunks: list[LawChunk], out_dir: Path) -> dict[str, Any]:
    checkpoint_path = Path(args.checkpoint_file).expanduser() if args.checkpoint_file else out_dir / "checkpoint.json"
    checkpoint = load_checkpoint(checkpoint_path) if args.resume else {}
    done_ids = set(checkpoint.get("upsertedIds", []))
    remaining = [chunk for chunk in chunks if chunk.chunk_id not in done_ids]

    timings: dict[str, float] = {}
    started = time.perf_counter()
    device = resolve_device(args.device)
    model = None
    if args.embedding_backend == "local":
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(args.model_name, device=device)
        model.max_seq_length = MAX_TOKENS
        sample_embedding = model.encode(["query: dimension check"], normalize_embeddings=True, batch_size=1)
        dimension = len(sample_embedding[0])
    else:
        health_url = args.embedding_url.rstrip("/") + "/health"
        try:
            with urllib.request.urlopen(health_url, timeout=10) as resp:
                health = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            raise SystemExit(f"Embedding server health failed: {safe_error(exc)}") from exc
        dimension = int(health.get("dimension") or 0)
        device = "embedding-server"
    if dimension != EXPECTED_DIMENSION:
        raise SystemExit(f"Embedding dimension mismatch: expected {EXPECTED_DIMENSION}, got {dimension}")
    timings["modelLoadSeconds"] = round(time.perf_counter() - started, 3)

    if args.chroma_mode != "http":
        client = get_chroma_client(args)
        collection = client.get_or_create_collection(
            name=args.collection_name,
            metadata={"hnsw:space": "cosine", "embeddingModel": args.model_name, "sourceType": "LAW"},
        )
        collection_id = ""
    else:
        collection = None
        collection_id = chroma_v1_collection_id(args, args.collection_name, create=True)

    failed_path = out_dir / "failed_chunks.jsonl"
    total_embed_time = 0.0
    total_upsert_time = 0.0
    upserted = 0
    failed = 0
    batch_size = args.batch_size
    write_batch = args.collection_upsert_batch

    pending_ids: list[str] = []
    pending_docs: list[str] = []
    pending_meta: list[dict[str, Any]] = []
    pending_embeddings: list[list[float]] = []

    def flush() -> None:
        nonlocal total_upsert_time, upserted
        if not pending_ids:
            return
        t0 = time.perf_counter()
        if args.chroma_mode == "http":
            http_json(
                chroma_base_url(args) + f"/api/v1/collections/{collection_id}/upsert",
                {
                    "ids": list(pending_ids),
                    "documents": list(pending_docs),
                    "metadatas": list(pending_meta),
                    "embeddings": list(pending_embeddings),
                },
                timeout=180,
            )
        else:
            collection.upsert(
                ids=list(pending_ids),
                documents=list(pending_docs),
                metadatas=list(pending_meta),
                embeddings=list(pending_embeddings),
            )
        total_upsert_time += time.perf_counter() - t0
        upserted += len(pending_ids)
        done_ids.update(pending_ids)
        save_checkpoint(
            checkpoint_path,
            {
                "collectionName": args.collection_name,
                "upsertedIds": sorted(done_ids),
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            },
        )
        pending_ids.clear()
        pending_docs.clear()
        pending_meta.clear()
        pending_embeddings.clear()

    with failed_path.open("a", encoding="utf-8") as failed_fh:
        for offset in range(0, len(remaining), batch_size):
            if STOP_REQUESTED:
                break
            batch = remaining[offset : offset + batch_size]
            try:
                t0 = time.perf_counter()
                if args.embedding_backend == "local":
                    vectors = model.encode(
                        [f"passage: {chunk.document}" for chunk in batch],
                        normalize_embeddings=True,
                        batch_size=batch_size,
                    ).tolist()
                else:
                    vectors = embed_with_server(args.embedding_url, [chunk.document for chunk in batch], mode="passage")
                total_embed_time += time.perf_counter() - t0
                for chunk, vector in zip(batch, vectors):
                    pending_ids.append(chunk.chunk_id)
                    pending_docs.append(chunk.document)
                    pending_meta.append(chunk.metadata)
                    pending_embeddings.append(vector)
                    if len(pending_ids) >= write_batch:
                        flush()
            except Exception as exc:
                failed += len(batch)
                for chunk in batch:
                    failed_fh.write(
                        json.dumps(
                            {"chunkId": chunk.chunk_id, "referenceId": chunk.metadata.get("referenceId"), "error": safe_error(exc)},
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            processed = min(offset + len(batch), len(remaining))
            if processed % max(batch_size * 10, 1) == 0 or processed == len(remaining):
                print(f"embedding progress: {processed}/{len(remaining)} chunks, upserted={upserted}, failed={failed}")
        flush()

    timings["embeddingSeconds"] = round(total_embed_time, 3)
    timings["chromaUpsertSeconds"] = round(total_upsert_time, 3)
    count = chroma_v1_count(args, collection_id) if args.chroma_mode == "http" else collection.count()
    return {
        "device": device,
        "embeddingBackend": args.embedding_backend,
        "batchSize": batch_size,
        "embeddingDimension": dimension,
        "model": args.model_name,
        "inputChunks": len(chunks),
        "alreadyUpsertedSkipped": len(chunks) - len(remaining),
        "upsertedThisRun": upserted,
        "failedChunks": failed,
        "collectionName": args.collection_name,
        "collectionCount": count,
        "timings": timings,
        "checkpointFile": str(checkpoint_path),
        "failedChunkLog": str(failed_path),
    }


def embed_with_server(base_url: str, texts: list[str], mode: str) -> list[list[float]]:
    payload = json.dumps({"texts": texts, "mode": mode}).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + "/embed/passage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Embedding server HTTP {exc.code}") from exc
    except Exception as exc:
        raise RuntimeError(f"Embedding server request failed: {safe_error(exc)}") from exc
    vectors = body.get("embeddings") or []
    if len(vectors) != len(texts):
        raise RuntimeError("Embedding server returned unexpected vector count.")
    return vectors


def summarize(records: list[LawRecord], chunks: list[LawChunk], stats: dict[str, Any], timings: dict[str, float]) -> dict[str, Any]:
    per_law = stats.get("perLawCounts", [])
    token_counts = [chunk.token_count for chunk in chunks]
    return {
        "inputLawCount": len(records),
        "totalChunks": len(chunks),
        "avgChunksPerLaw": round(mean(per_law), 2) if per_law else 0,
        "minChunksPerLaw": min(per_law) if per_law else 0,
        "maxChunksPerLaw": max(per_law) if per_law else 0,
        "mainChunks": stats.get("mainChunks", 0),
        "addendaChunks": stats.get("addendaChunks", 0),
        "windowResplits": stats.get("windowResplits", 0),
        "noParseLaws": stats.get("noParseLaws", 0),
        "duplicateIdsAdjusted": stats.get("duplicateIdsAdjusted", 0),
        "maxTokenCount": max(token_counts) if token_counts else 0,
        "tokenCounterMode": timings.get("tokenCounterMode", ""),
        "chunkingSeconds": timings.get("chunkingSeconds", 0),
        "model": MODEL_NAME,
        "embeddingDimension": EXPECTED_DIMENSION,
        "tokenLimit": MAX_TOKENS,
        "tokenBudget": TOKEN_BUDGET,
        "overlap": WINDOW_OVERLAP,
    }


def main() -> int:
    signal.signal(signal.SIGINT, handle_signal)
    args = parse_args()
    validate_args(args)
    out_dir = Path(args.output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    jsonl_records = load_jsonl_records(Path(args.input_jsonl).expanduser())
    db_supplement = fetch_db_supplement(jsonl_records)
    all_records = {**jsonl_records, **db_supplement}
    ordered = sorted(
        all_records.values(),
        key=lambda item: (0, int(item.law_mst)) if item.law_mst.isdigit() else (1, item.law_mst),
    )
    if args.offset_laws:
        ordered = ordered[args.offset_laws :]
    if args.limit_laws is not None:
        ordered = ordered[: args.limit_laws]

    counter = TokenCounter(
        args.model_name,
        prefer_fast_estimate=bool(args.estimate_only or args.embedding_backend == "server"),
    )
    chunk_start = time.perf_counter()
    chunks, chunk_stats = build_chunks(ordered, counter, args.limit_chunks)
    timings = {
        "loadSeconds": round(chunk_start - t0, 3),
        "chunkingSeconds": round(time.perf_counter() - chunk_start, 3),
        "tokenCounterMode": counter.mode,
    }

    summary = summarize(ordered, chunks, chunk_stats, timings)
    summary.update(
        {
            "jsonlLawCount": len(jsonl_records),
            "dbSupplementLawCount": len(db_supplement),
            "dedupedCurrentLawCount": len(all_records),
            "collectionName": args.collection_name,
            "estimateOnly": bool(args.estimate_only),
            "noChromaWrite": bool(args.no_chroma_write),
            "inputJsonl": str(Path(args.input_jsonl).expanduser()),
        }
    )
    write_json(out_dir / "summary.json", summary)

    samples_path = out_dir / "chunk_samples.jsonl"
    with samples_path.open("w", encoding="utf-8") as fh:
        for chunk in chunks[:20]:
            fh.write(
                json.dumps(
                    {
                        "id": chunk.chunk_id,
                        "textPreview": chunk.document[:180],
                        "metadata": chunk.metadata,
                        "tokenCount": chunk.token_count,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    run_result: dict[str, Any] | None = None
    if not args.estimate_only and not args.no_chroma_write:
        run_result = embed_and_upsert(args, chunks, out_dir)
        write_json(out_dir / "embedding_summary.json", run_result)
        summary["embeddingRun"] = run_result
        write_json(out_dir / "summary.json", summary)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if run_result:
        print(json.dumps(run_result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
