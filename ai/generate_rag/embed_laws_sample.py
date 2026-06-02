#!/usr/bin/env python3
"""
Safe sample-only law embedding helper.

This script is intentionally isolated from production collections. It reads a
small number of rows from law_documents, chunks them with the same broad policy
as the latest law embedding draft, and can upsert only into an explicitly named
test/sample collection after dry-run review.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

PROTECTED_COLLECTIONS = {
    "laws",
    "laws_e5",
    "cases_e5",
    "legal_case_chunks_full",
    "legal_case_chunks_sample",
}
DEFAULT_COLLECTION = "laws_e5_test_sample"
DEFAULT_LIMIT = 10
MAX_LIMIT = 100
EXPECTED_DIMENSION = 768
MODEL_NAME = "intfloat/multilingual-e5-base"
MAX_TOKENS = 512
SAFETY = 12
TOKEN_BUDGET = MAX_TOKENS - SAFETY
WINDOW_OVERLAP = 40
ENCODE_BATCH = 32
UPSERT_BATCH = 128


ART_HEADING = re.compile(r"제\d+조(?:의\d+)?(?=\(|\s*삭제)")
ART_HEADING_LENIENT = re.compile(r"(?<![\d조항호의])제\d+조(?:의\d+)?(?=\s)")
ART_TITLE = re.compile(r"제\d+조(?:의\d+)?\(([^)]*)\)")
ADDENDA_HDR = re.compile(r"부\s*칙\s*(<[^>]*>|\([^)]*시행[^)]*\))?")
BYEOLPYO = re.compile(r"별\s*[표지]")
HANG_SPLIT = re.compile(r"(?=[\u2460-\u2473])")
HO_SPLIT = re.compile(r"(?=\s+\d+\.\s)")
SAFE_ID_RE = re.compile(r"[^0-9A-Za-z가-힣_#:-]+")


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
LOG = logging.getLogger("law_embed_sample")


@dataclass(frozen=True)
class LawArticle:
    section: str
    addenda_id: str
    addenda_ord: int
    article_no: str
    article_title: str
    body: str


@dataclass(frozen=True)
class LawChunk:
    chunk_id: str
    document: str
    metadata: dict[str, Any]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely dry-run or sample-upsert law embeddings into a test/sample collection.",
    )
    parser.add_argument(
        "--collection-name",
        default=DEFAULT_COLLECTION,
        help=f"Test collection name. Must include 'test' or 'sample'. Default: {DEFAULT_COLLECTION}",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Number of law_documents rows to read. Default: {DEFAULT_LIMIT}, max: {MAX_LIMIT}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and chunk rows only. Does not load the embedding model and does not write to ChromaDB.",
    )
    parser.add_argument(
        "--chroma-mode",
        choices=("http", "local"),
        default=os.getenv("CHROMA_CLIENT_MODE", "http").lower(),
        help="Chroma client mode for non-dry-run sample upsert. Default: env CHROMA_CLIENT_MODE or http.",
    )
    parser.add_argument(
        "--chroma-host",
        default=os.getenv("CHROMA_HOST", "localhost"),
        help="Chroma host for --chroma-mode http.",
    )
    parser.add_argument(
        "--chroma-port",
        type=int,
        default=int(os.getenv("CHROMA_PORT", "8000")),
        help="Chroma port for --chroma-mode http.",
    )
    parser.add_argument(
        "--chroma-path",
        default=os.getenv("CHROMA_DB_DIR", "./chroma_data"),
        help="Local Chroma path for --chroma-mode local.",
    )
    return parser


def validate_args(args: argparse.Namespace) -> None:
    collection = args.collection_name.strip()
    lowered = collection.lower()
    if lowered in PROTECTED_COLLECTIONS:
        raise SystemExit(f"Refusing protected collection name: {collection}")
    if "test" not in lowered and "sample" not in lowered:
        raise SystemExit("Collection name must include 'test' or 'sample'.")
    if args.limit <= 0:
        raise SystemExit("--limit must be positive.")
    if args.limit > MAX_LIMIT:
        raise SystemExit(f"--limit must be <= {MAX_LIMIT}.")


def db_config() -> dict[str, str]:
    return {
        "dbname": os.getenv("DB_NAME", "legalreview"),
        "user": os.getenv("DB_USER", "legalreview"),
        "password": os.getenv("DB_PASSWORD", ""),
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
    }


def fetch_law_rows(limit: int) -> list[dict[str, Any]]:
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except Exception as exc:
        LOG.info("psycopg2 unavailable; falling back to psql CLI for SELECT-only read.")
        return fetch_law_rows_with_psql(limit)

    query = """
        SELECT id, reference_id, title, short_name, department,
               enforce_date, revision_type, url, raw_content
        FROM public.law_documents
        WHERE raw_content IS NOT NULL
          AND length(trim(raw_content)) > 0
        ORDER BY id ASC
        LIMIT %s;
    """
    try:
        with psycopg2.connect(**db_config()) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, (limit,))
                return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        raise SystemExit(f"PostgreSQL SELECT failed: {safe_error(exc)}") from exc


def fetch_law_rows_with_psql(limit: int) -> list[dict[str, Any]]:
    cfg = db_config()
    query = f"""
        SELECT json_build_object(
            'id', id,
            'reference_id', reference_id,
            'title', title,
            'short_name', short_name,
            'department', department,
            'enforce_date', enforce_date,
            'revision_type', revision_type,
            'url', url,
            'raw_content', raw_content
        )::text
        FROM public.law_documents
        WHERE raw_content IS NOT NULL
          AND length(trim(raw_content)) > 0
        ORDER BY id ASC
        LIMIT {int(limit)};
    """
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
    except FileNotFoundError as exc:
        raise SystemExit("Neither psycopg2 nor psql CLI is available for PostgreSQL SELECT.") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"PostgreSQL SELECT failed: psql exit {exc.returncode}") from exc
    rows: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        value = line.strip()
        if not value:
            continue
        rows.append(json.loads(value))
    return rows


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


def parse_law(raw: str) -> list[LawArticle]:
    articles: list[LawArticle] = []
    for section, addenda, order, text in split_sections(raw):
        parsed = parse_with(text, ART_HEADING)
        if not parsed and section == "MAIN":
            parsed = parse_with(text, ART_HEADING_LENIENT)
        for article_no, title, body in parsed:
            articles.append(
                LawArticle(
                    section=section,
                    addenda_id=addenda,
                    addenda_ord=order,
                    article_no=article_no,
                    article_title=title,
                    body=body,
                )
            )
    return articles


def rough_token_count(text: str) -> int:
    return max(1, len(text or "") // 2)


def window_split_by_chars(head: str, text: str, max_chars: int = 1200, overlap_chars: int = 120) -> list[str]:
    body = text or ""
    if len(f"{head} {body}".strip()) <= max_chars:
        return [f"{head} {body}".strip()]
    chunks: list[str] = []
    step = max(1, max_chars - overlap_chars)
    for start in range(0, len(body), step):
        part = body[start : start + max_chars]
        chunks.append(f"{head} {part}".strip())
        if start + max_chars >= len(body):
            break
    return chunks


def chunk_article_dry(article: LawArticle) -> list[str]:
    head = f"{article.article_no}({article.article_title})" if article.article_title else article.article_no
    body = clean_text(article.body)
    whole = f"{head} {body}".strip() if body else head
    if rough_token_count(whole) <= TOKEN_BUDGET:
        return [whole]
    hangs = [piece.strip() for piece in HANG_SPLIT.split(body) if piece.strip()]
    if len(hangs) > 1:
        return pack_dry(head, hangs)
    hos = [piece.strip() for piece in HO_SPLIT.split(body) if piece.strip()]
    if len(hos) > 1:
        return pack_dry(head, hos)
    return window_split_by_chars(head, body)


def pack_dry(head: str, pieces: list[str]) -> list[str]:
    chunks: list[str] = []
    current = head
    for piece in pieces:
        candidate = f"{current} {piece}".strip()
        if rough_token_count(candidate) <= TOKEN_BUDGET:
            current = candidate
            continue
        if current != head:
            chunks.append(current)
        current = f"{head} {piece}".strip()
    if current != head:
        chunks.append(current)
    return chunks


def normalize_id_part(value: str) -> str:
    normalized = SAFE_ID_RE.sub("_", value or "").strip("_")
    return re.sub(r"_+", "_", normalized) or "unknown"


def unique_id(base: str, used: set[str]) -> str:
    if base not in used:
        used.add(base)
        return base
    index = 2
    while f"{base}_{index}" in used:
        index += 1
    value = f"{base}_{index}"
    used.add(value)
    return value


def build_chunks(rows: list[dict[str, Any]], tokenizer: Any | None = None) -> list[LawChunk]:
    used_ids: set[str] = set()
    chunks: list[LawChunk] = []
    for row in rows:
        articles = parse_law(str(row.get("raw_content") or ""))
        for article in articles:
            body = clean_text(article.body)
            article_for_chunk = LawArticle(
                section=article.section,
                addenda_id=article.addenda_id,
                addenda_ord=article.addenda_ord,
                article_no=article.article_no,
                article_title=article.article_title,
                body=body,
            )
            texts = chunk_article_with_tokenizer(article_for_chunk, tokenizer) if tokenizer else chunk_article_dry(article_for_chunk)
            parent = parent_id(row, article_for_chunk)
            for part_index, text in enumerate(texts, 1):
                base = parent if len(texts) == 1 else f"{parent}#p{part_index}"
                chunk_id = unique_id(base, used_ids)
                metadata = build_metadata(row, article_for_chunk, parent, part_index, len(texts))
                validate_metadata(metadata)
                chunks.append(LawChunk(chunk_id=chunk_id, document=text, metadata=metadata))
    return chunks


def parent_id(row: dict[str, Any], article: LawArticle) -> str:
    reference_id = normalize_id_part(str(row.get("reference_id") or row.get("id") or "unknown"))
    article_no = normalize_id_part(article.article_no)
    if article.section == "MAIN":
        return f"law_{reference_id}_{article_no}"
    return f"law_{reference_id}_부칙{article.addenda_ord}_{article_no}"


def build_metadata(
    row: dict[str, Any],
    article: LawArticle,
    parent: str,
    part_index: int,
    total_parts: int,
) -> dict[str, Any]:
    reference_id = str(row.get("reference_id") or "")
    title = str(row.get("title") or "")
    return {
        "rowId": row.get("id") or "",
        "referenceId": reference_id,
        "lawNo": reference_id,
        "lawNameKr": title,
        "title": title,
        "shortName": str(row.get("short_name") or ""),
        "articleNo": article.article_no,
        "articleTitle": article.article_title,
        "section": article.section,
        "addendaId": article.addenda_id,
        "addendaOrd": article.addenda_ord,
        "parentId": parent,
        "partIndex": part_index,
        "nParts": total_parts,
        "chunkIndex": part_index - 1,
        "chunkingStrategy": "law-article-token-window-sample-v1",
        "embeddingProvider": "sentence-transformers",
        "embeddingModel": MODEL_NAME,
        "department": str(row.get("department") or ""),
        "enforceDate": str(row.get("enforce_date") or ""),
        "revisionType": str(row.get("revision_type") or ""),
        "url": str(row.get("url") or ""),
        "sourceType": "LAW",
    }


def validate_metadata(metadata: dict[str, Any]) -> None:
    required = ("sourceType", "title", "referenceId", "articleNo")
    if all(not str(metadata.get(key) or "").strip() for key in required):
        raise SystemExit("Metadata validation failed: required identifying fields are empty.")


def chunk_article_with_tokenizer(article: LawArticle, tokenizer: Any) -> list[str]:
    head = f"{article.article_no}({article.article_title})" if article.article_title else article.article_no
    body = clean_text(article.body)
    whole = f"{head} {body}".strip() if body else head
    if token_count(tokenizer, whole) <= TOKEN_BUDGET:
        return [whole]
    hangs = [piece.strip() for piece in HANG_SPLIT.split(body) if piece.strip()]
    if len(hangs) > 1:
        return pack_with_tokenizer(tokenizer, head, hangs)
    hos = [piece.strip() for piece in HO_SPLIT.split(body) if piece.strip()]
    if len(hos) > 1:
        return pack_with_tokenizer(tokenizer, head, hos)
    return window_split_with_tokenizer(tokenizer, head, body)


def token_count(tokenizer: Any, text: str) -> int:
    return len(tokenizer.encode(f"passage: {text}"))


def pack_with_tokenizer(tokenizer: Any, head: str, pieces: list[str]) -> list[str]:
    chunks: list[str] = []
    current = head
    for piece in pieces:
        candidate = f"{current} {piece}".strip()
        if token_count(tokenizer, candidate) <= TOKEN_BUDGET:
            current = candidate
            continue
        if current != head:
            chunks.append(current)
        start = f"{head} {piece}".strip()
        if token_count(tokenizer, start) <= TOKEN_BUDGET:
            current = start
        else:
            chunks.extend(window_split_with_tokenizer(tokenizer, head, piece))
            current = head
    if current != head:
        chunks.append(current)
    return chunks


def window_split_with_tokenizer(tokenizer: Any, head: str, text: str) -> list[str]:
    head_cost = len(tokenizer.encode(f"passage: {head} ", add_special_tokens=False))
    budget = max(TOKEN_BUDGET - head_cost, 64)
    token_ids = tokenizer.encode(text or "", add_special_tokens=False)
    chunks: list[str] = []
    index = 0
    while index < len(token_ids):
        piece = tokenizer.decode(token_ids[index : index + budget]).strip()
        chunks.append(f"{head} {piece}".strip())
        if index + budget >= len(token_ids):
            break
        index += budget - WINDOW_OVERLAP
    return chunks


def load_embedding_model() -> Any:
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:
        raise SystemExit("sentence-transformers is required for non-dry-run sample embedding.") from exc
    model = SentenceTransformer(MODEL_NAME)
    model.max_seq_length = MAX_TOKENS
    dimension = int(model.get_sentence_embedding_dimension())
    if dimension != EXPECTED_DIMENSION:
        raise SystemExit(f"Embedding dimension mismatch: expected {EXPECTED_DIMENSION}, got {dimension}.")
    return model


def create_chroma_collection(args: argparse.Namespace) -> Any:
    if args.chroma_mode == "http":
        return create_chroma_collection_http(args)
    try:
        import chromadb
    except Exception as exc:
        raise SystemExit("chromadb is required for non-dry-run sample embedding.") from exc
    client = chromadb.PersistentClient(path=args.chroma_path)
    # Some local Chroma server/client combinations reject collection metadata.
    # Keep creation minimal; embeddings are already normalized by the E5 model.
    return client.get_or_create_collection(name=args.collection_name)


def create_chroma_collection_http(args: argparse.Namespace) -> dict[str, str]:
    base_url = f"http://{args.chroma_host}:{args.chroma_port}/api/v1"
    response = post_json(
        f"{base_url}/collections",
        {"name": args.collection_name, "get_or_create": True},
    )
    collection_id = str(response.get("id") or "")
    if not collection_id:
        raise SystemExit("Chroma collection creation failed: missing collection id.")
    return {"base_url": base_url, "collection_id": collection_id}


def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200]
        raise SystemExit(f"Chroma HTTP request failed: HTTP {exc.code} {detail}") from exc
    except Exception as exc:
        raise SystemExit(f"Chroma HTTP request failed: {safe_error(exc)}") from exc


def upsert_sample(args: argparse.Namespace, rows: list[dict[str, Any]]) -> None:
    model = load_embedding_model()
    chunks = build_chunks(rows, tokenizer=model.tokenizer)
    if not chunks:
        raise SystemExit("No chunks were produced from selected law_documents rows.")
    collection = create_chroma_collection(args)
    LOG.info("Sample chunks prepared: %d", len(chunks))
    for start in range(0, len(chunks), UPSERT_BATCH):
        batch = chunks[start : start + UPSERT_BATCH]
        documents = [chunk.document for chunk in batch]
        embeddings = model.encode(
            [f"passage: {doc}" for doc in documents],
            normalize_embeddings=True,
            batch_size=ENCODE_BATCH,
        ).tolist()
        ids = [chunk.chunk_id for chunk in batch]
        metadatas = [chunk.metadata for chunk in batch]
        if isinstance(collection, dict):
            post_json(
                f"{collection['base_url']}/collections/{collection['collection_id']}/upsert",
                {
                    "ids": ids,
                    "documents": documents,
                    "metadatas": metadatas,
                    "embeddings": embeddings,
                },
            )
        else:
            collection.upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=embeddings)
    LOG.info("Sample upsert complete: collection=%s chunks=%d", args.collection_name, len(chunks))


def safe_error(exc: Exception) -> str:
    return exc.__class__.__name__


def print_dry_run_summary(rows: list[dict[str, Any]], chunks: list[LawChunk], collection: str) -> None:
    law_titles = [str(row.get("title") or "") for row in rows[:3]]
    print("DRY_RUN_OK")
    print(f"collection={collection}")
    print(f"rows={len(rows)}")
    print(f"chunks={len(chunks)}")
    print(f"model={MODEL_NAME}")
    print(f"dimension={EXPECTED_DIMENSION}")
    print(f"token_limit={MAX_TOKENS}")
    print(f"window_overlap={WINDOW_OVERLAP}")
    print("sample_titles=" + " | ".join(title[:40] for title in law_titles if title))
    if chunks:
        first = chunks[0]
        print(f"first_chunk_id={first.chunk_id}")
        print("metadata_keys=" + ",".join(sorted(first.metadata.keys())))


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args)

    rows = fetch_law_rows(args.limit)
    if not rows:
        raise SystemExit("No law_documents rows found for SELECT-only sample.")

    if args.dry_run:
        chunks = build_chunks(rows, tokenizer=None)
        print_dry_run_summary(rows, chunks, args.collection_name)
        return 0

    upsert_sample(args, rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
