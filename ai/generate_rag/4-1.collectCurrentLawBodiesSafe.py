#!/usr/bin/env python3
"""
Safe current-law body collector.

Default behavior is read-only for PostgreSQL and writes JSONL files only under
the requested output directory. PostgreSQL updates require --write-db.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    def _load_env_file(path: Path) -> None:
        if not path.exists():
            return
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    _script_dir = Path(__file__).resolve().parent
    _load_env_file(_script_dir / ".env")
    _load_env_file(_script_dir.parent.parent / ".env")
    from config import DB_CONFIG, LAW_API_OC
except Exception:  # pragma: no cover - script fallback when imported elsewhere
    DB_CONFIG = {
        "dbname": os.getenv("DB_NAME", "legalreview"),
        "user": os.getenv("DB_USER", "legalreview"),
        "password": os.getenv("DB_PASSWORD", ""),
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
    }
    LAW_API_OC = os.getenv("LAW_API_OC", "")

DB_CONFIG["dbname"] = os.getenv("DB_NAME", os.getenv("POSTGRES_DB", DB_CONFIG.get("dbname", "legalreview")))
DB_CONFIG["user"] = os.getenv("DB_USER", os.getenv("POSTGRES_USER", DB_CONFIG.get("user", "legalreview")))
DB_CONFIG["password"] = os.getenv("DB_PASSWORD", os.getenv("POSTGRES_PASSWORD", DB_CONFIG.get("password", "")))
DB_CONFIG["host"] = os.getenv("DB_HOST", os.getenv("POSTGRES_HOST", DB_CONFIG.get("host", "localhost")))
DB_CONFIG["port"] = os.getenv("DB_PORT", os.getenv("POSTGRES_PORT", str(DB_CONFIG.get("port", "5432"))))
LAW_API_OC = os.getenv("LAW_API_OC", LAW_API_OC)

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except Exception:  # pragma: no cover - handled at runtime
    psycopg2 = None
    RealDictCursor = None


DEFAULT_OUTPUT_DIR = "/tmp/lexrex_law_collection"
DEFAULT_CHECKPOINT = "checkpoint.json"
DEFAULT_FAILURE_LOG = "failures.jsonl"
SAFE_DEFAULT_DELAY_SECONDS = 0.5


@dataclass
class LawMeta:
    law_mst: str
    law_id: str
    law_name_kr: str
    law_name_short: str
    dept_name: str
    enforce_date: str
    amend_type: str
    detail_link: str
    law_status: str
    existing_reference_id: str
    existing_raw_length: int


@dataclass
class Stats:
    requested: int = 0
    success: int = 0
    failed: int = 0
    empty_body: int = 0
    skipped: int = 0
    db_written: int = 0
    total_response_ms: int = 0


STOP_REQUESTED = False


def handle_stop(signum: int, frame: Any) -> None:  # noqa: ARG001
    global STOP_REQUESTED
    STOP_REQUESTED = True


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def require_psycopg() -> None:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 is required for PostgreSQL metadata reads.")


def connect_db():
    require_psycopg()
    return psycopg2.connect(**DB_CONFIG)


def psql_json(sql: str) -> Any:
    env = os.environ.copy()
    if DB_CONFIG.get("password"):
        env["PGPASSWORD"] = str(DB_CONFIG["password"])
    cmd = [
        "psql",
        "-h", str(DB_CONFIG.get("host", "localhost")),
        "-U", str(DB_CONFIG.get("user", "legalreview")),
        "-d", str(DB_CONFIG.get("dbname", "legalreview")),
        "-p", str(DB_CONFIG.get("port", "5432")),
        "-tA",
        "-c", sql,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    except FileNotFoundError as exc:
        raise RuntimeError("psql CLI is required when psycopg2 is unavailable.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or exc.stdout or "psql failed").strip()[:300]) from exc
    payload = result.stdout.strip()
    return json.loads(payload) if payload else None


def fetch_current_metadata(limit: int, offset: int, force: bool) -> list[LawMeta]:
    """
    Current law scope:
    - law_status is NULL in the current local DB for 5,583 rows.
    - law_status='2' is scheduled law.
    - law_status='3' is accepted for compatibility with older scripts.
    """
    sql = """
        SELECT
            l.law_mst::text AS law_mst,
            COALESCE(l.law_id, '') AS law_id,
            COALESCE(l.law_name_kr, '') AS law_name_kr,
            COALESCE(l.law_name_short, '') AS law_name_short,
            COALESCE(l.dept_name, '') AS dept_name,
            COALESCE(l.enforce_date, '') AS enforce_date,
            COALESCE(l.amend_type, '') AS amend_type,
            COALESCE(l.detail_link, '') AS detail_link,
            COALESCE(l.law_status, '') AS law_status,
            COALESCE(d.reference_id, '') AS existing_reference_id,
            COALESCE(length(trim(d.raw_content)), 0) AS existing_raw_length
        FROM public.law_list l
        LEFT JOIN public.law_documents d
               ON d.reference_id = l.law_mst::text
        WHERE (l.law_status IS NULL OR l.law_status::text = '3')
        ORDER BY l.law_mst
        LIMIT %s OFFSET %s
    """
    if force:
        params = (limit, offset)
    else:
        sql = sql.replace(
            "ORDER BY l.law_mst",
            "AND COALESCE(length(trim(d.raw_content)), 0) = 0\n        ORDER BY l.law_mst",
        )
        params = (limit, offset)
    if psycopg2 is not None:
        with connect_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                return [LawMeta(**dict(row)) for row in cur.fetchall()]

    rendered = sql
    for value in params:
        rendered = rendered.replace("%s", str(int(value)), 1)
    rows = psql_json(f"SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM ({rendered}) t")
    return [LawMeta(**row) for row in rows]


def count_scope() -> dict[str, int]:
    sql = """
        SELECT
            COUNT(*) FILTER (WHERE law_status IS NULL OR law_status::text = '3') AS current_count,
            COUNT(*) FILTER (WHERE law_status::text = '2') AS scheduled_count,
            COUNT(*) AS total_count
        FROM public.law_list
    """
    doc_sql = """
        SELECT
            COUNT(*) AS document_count,
            COUNT(*) FILTER (WHERE raw_content IS NOT NULL AND length(trim(raw_content)) > 0) AS with_raw_count
        FROM public.law_documents
    """
    if psycopg2 is not None:
        with connect_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql)
                scope = dict(cur.fetchone())
                cur.execute(doc_sql)
                docs = dict(cur.fetchone())
    else:
        scope = psql_json(f"SELECT row_to_json(t) FROM ({sql}) t")
        docs = psql_json(f"SELECT row_to_json(t) FROM ({doc_sql}) t")
    return {k: int(v or 0) for k, v in {**scope, **docs}.items()}


def text_or_empty(node: ET.Element | None, tag: str) -> str:
    if node is None:
        return ""
    found = node.find(tag)
    return "" if found is None or found.text is None else found.text.strip()


def iter_texts(root: ET.Element, tag: str) -> Iterable[str]:
    for el in root.findall(f".//{tag}"):
        if el.text and el.text.strip():
            yield el.text.strip()


def build_raw_content(root: ET.Element, meta: LawMeta) -> tuple[str, dict[str, int]]:
    parts: list[str] = []
    counters = {"articles": 0, "addenda": 0, "tables": 0}
    parts.append(f"[법령] {meta.law_name_kr} (MST={meta.law_mst})")
    if meta.law_id:
        parts.append(f"법령ID: {meta.law_id}")
    if meta.dept_name:
        parts.append(f"소관부처: {meta.dept_name}")
    if meta.enforce_date:
        parts.append(f"시행일: {meta.enforce_date}")
    parts.append("")

    for jo in root.findall(".//조문단위"):
        jo_num = text_or_empty(jo, "조문번호")
        jo_title = text_or_empty(jo, "조문제목")
        jo_content = text_or_empty(jo, "조문내용")
        if not (jo_num or jo_title or jo_content):
            continue
        counters["articles"] += 1
        if jo_num and jo_content.startswith(f"제{jo_num}조"):
            parts.append(jo_content)
        else:
            line = ""
            if jo_num:
                line += f"제{jo_num}조"
            if jo_title:
                line += f"({jo_title})"
            if jo_content:
                line += f" {jo_content}"
            parts.append(line.strip())

        for hang in jo.findall(".//항"):
            hang_content = text_or_empty(hang, "항내용")
            if hang_content:
                parts.append("  " + hang_content)
            for ho in hang.findall(".//호"):
                ho_content = text_or_empty(ho, "호내용")
                if ho_content:
                    parts.append("    " + ho_content)
                for mok in ho.findall(".//목"):
                    mok_content = text_or_empty(mok, "목내용")
                    if mok_content:
                        parts.append("      " + mok_content)
        parts.append("")

    addenda = list(iter_texts(root, "부칙내용"))
    if addenda:
        parts.append("[부칙]")
        for item in addenda:
            counters["addenda"] += 1
            parts.append(item)
        parts.append("")

    table_texts: list[str] = []
    for tag in ("별표내용", "서식내용", "별표서식내용"):
        table_texts.extend(iter_texts(root, tag))
    if table_texts:
        parts.append("[별표·서식]")
        for item in table_texts:
            counters["tables"] += 1
            parts.append(item)
        parts.append("")

    raw = "\n".join(parts).strip()
    if counters["articles"] == 0 and len(raw) < 200:
        fallback = ET.tostring(root, encoding="unicode")
        raw = (raw + "\n\n--- XML parse fallback ---\n" + fallback).strip()
    return raw, counters


def build_law_service_url(base_url: str, oc: str, law_mst: str, target: str) -> str:
    query = urllib.parse.urlencode({
        "OC": oc,
        "target": target,
        "type": "XML",
        "MST": law_mst,
    })
    return f"{base_url}?{query}"


def fetch_law_body_with_target(meta: LawMeta, args: argparse.Namespace, target: str) -> tuple[str, dict[str, int], int, int]:
    oc = LAW_API_OC or os.getenv("LAW_API_OC", "")
    if not oc:
        raise RuntimeError("LAW_API_OC is required for sample collection.")
    url = build_law_service_url(args.service_url, oc, meta.law_mst, target)
    request = urllib.request.Request(url, headers={"User-Agent": args.user_agent})
    context = ssl.create_default_context()
    t0 = time.time()
    with urllib.request.urlopen(request, timeout=args.timeout_seconds, context=context) as response:
        xml_data = response.read().decode("utf-8", errors="replace")
    elapsed_ms = int((time.time() - t0) * 1000)
    root = ET.fromstring(xml_data)
    raw_content, counters = build_raw_content(root, meta)
    return raw_content, counters, elapsed_ms, len(xml_data)


def fetch_law_body(meta: LawMeta, args: argparse.Namespace) -> tuple[str, dict[str, int], int, str, int]:
    raw_content, counters, elapsed_ms, raw_response_length = fetch_law_body_with_target(meta, args, args.target)
    if (
        args.target == "eflaw"
        and counters.get("articles", 0) == 0
        and "일치하는 법령이 없습니다" in raw_content
    ):
        # Some current-law MST values are not served by target=eflaw, but are available from target=law.
        fallback_content, fallback_counters, fallback_elapsed_ms, fallback_response_length = fetch_law_body_with_target(
            meta,
            args,
            "law",
        )
        if len(fallback_content.strip()) > len(raw_content.strip()) or fallback_counters.get("articles", 0) > 0:
            return fallback_content, fallback_counters, elapsed_ms + fallback_elapsed_ms, "law", fallback_response_length
    return raw_content, counters, elapsed_ms, args.target, raw_response_length


def should_skip(meta: LawMeta, force: bool) -> bool:
    return not force and bool(meta.existing_reference_id) and meta.existing_raw_length > 0


def update_db(meta: LawMeta, raw_content: str, force: bool) -> str:
    if should_skip(meta, force):
        return "skipped-existing"
    with connect_db() as conn:
        with conn.cursor() as cur:
            if meta.existing_reference_id:
                cur.execute(
                    """
                    UPDATE public.law_documents
                       SET title=%s, short_name=%s, department=%s, enforce_date=%s,
                           revision_type=%s, url=%s, raw_content=%s, updated_at=NOW()
                     WHERE reference_id=%s
                    """,
                    (
                        meta.law_name_kr,
                        meta.law_name_short,
                        meta.dept_name,
                        meta.enforce_date,
                        meta.amend_type,
                        meta.detail_link,
                        raw_content,
                        meta.law_mst,
                    ),
                )
                conn.commit()
                return "updated"
            cur.execute(
                """
                INSERT INTO public.law_documents (
                    reference_id, title, short_name, department, enforce_date,
                    revision_type, url, raw_content, chunked, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, false, NOW(), NOW())
                """,
                (
                    meta.law_mst,
                    meta.law_name_kr,
                    meta.law_name_short,
                    meta.dept_name,
                    meta.enforce_date,
                    meta.amend_type,
                    meta.detail_link,
                    raw_content,
                ),
            )
            conn.commit()
            return "inserted"


def collect(args: argparse.Namespace) -> Stats:
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = Path(args.checkpoint_file) if args.checkpoint_file else out_dir / DEFAULT_CHECKPOINT
    failure_path = Path(args.failure_log) if args.failure_log else out_dir / DEFAULT_FAILURE_LOG
    output_jsonl = out_dir / "law_bodies.jsonl"
    if not args.dry_run:
        failure_path.parent.mkdir(parents=True, exist_ok=True)
        failure_path.touch(exist_ok=True)

    scope = count_scope()
    metas = fetch_current_metadata(args.limit, args.offset, args.force)
    checkpoint = load_json(checkpoint_path, {"processed_mst": []}) if args.resume else {"processed_mst": []}
    processed = set(str(x) for x in checkpoint.get("processed_mst", []))

    stats = Stats(requested=len(metas))
    dry_run_payload = {
        "mode": "dry-run" if args.dry_run else "sample",
        "scope": scope,
        "requested": len(metas),
        "limit": args.limit,
        "offset": args.offset,
        "force": args.force,
        "writeDb": args.write_db,
        "targets": [asdict(m) for m in metas[: min(10, len(metas))]],
    }

    if args.dry_run:
        write_json(out_dir / "dry_run_summary.json", dry_run_payload)
        print(json.dumps({k: dry_run_payload[k] for k in ("mode", "scope", "requested", "limit", "offset", "force", "writeDb")}, ensure_ascii=False))
        return stats

    for idx, meta in enumerate(metas, 1):
        if STOP_REQUESTED:
            print("stop requested; checkpoint saved")
            break
        if args.resume and meta.law_mst in processed:
            stats.skipped += 1
            continue
        if should_skip(meta, args.force):
            stats.skipped += 1
            checkpoint.setdefault("processed_mst", []).append(meta.law_mst)
            write_json(checkpoint_path, checkpoint)
            continue

        attempts = 0
        while True:
            attempts += 1
            try:
                raw_content, counters, elapsed_ms, resolved_target, raw_response_length = fetch_law_body(meta, args)
                stats.total_response_ms += elapsed_ms
                if len(raw_content.strip()) < args.min_body_chars:
                    stats.empty_body += 1
                    raise RuntimeError(
                        f"empty or too short body ({len(raw_content.strip())} chars, "
                        f"target={resolved_target}, rawResponse={raw_response_length} chars)"
                    )
                db_status = "not-requested"
                if args.write_db:
                    db_status = update_db(meta, raw_content, args.force)
                    if db_status in {"inserted", "updated"}:
                        stats.db_written += 1
                record = {
                    "lawMst": meta.law_mst,
                    "lawId": meta.law_id,
                    "lawNameKr": meta.law_name_kr,
                    "shortName": meta.law_name_short,
                    "department": meta.dept_name,
                    "enforceDate": meta.enforce_date,
                    "revisionType": meta.amend_type,
                    "detailLink": meta.detail_link,
                    "rawContentLength": len(raw_content),
                    "structure": counters,
                    "rawContent": raw_content,
                    "dbStatus": db_status,
                    "elapsedMs": elapsed_ms,
                    "fetchTarget": resolved_target,
                    "rawResponseLength": raw_response_length,
                }
                append_jsonl(output_jsonl, record)
                stats.success += 1
                checkpoint.setdefault("processed_mst", []).append(meta.law_mst)
                checkpoint.update({"lastLawMst": meta.law_mst, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
                write_json(checkpoint_path, checkpoint)
                print(f"[{idx}/{len(metas)}] OK {meta.law_mst} {meta.law_name_kr} chars={len(raw_content)}")
                break
            except KeyboardInterrupt:
                write_json(checkpoint_path, checkpoint)
                raise
            except Exception as e:
                if attempts <= args.retries:
                    sleep_for = args.delay_seconds * (2 ** (attempts - 1))
                    time.sleep(sleep_for)
                    continue
                stats.failed += 1
                append_jsonl(failure_path, {
                    "lawMst": meta.law_mst,
                    "lawNameKr": meta.law_name_kr,
                    "error": type(e).__name__,
                    "message": str(e)[:300],
                    "attempts": attempts,
                })
                print(f"[{idx}/{len(metas)}] FAIL {meta.law_mst} {meta.law_name_kr}: {type(e).__name__}")
                break
        if idx < len(metas):
            time.sleep(args.delay_seconds)

    summary = asdict(stats)
    summary["averageResponseMs"] = int(stats.total_response_ms / stats.success) if stats.success else 0
    summary["outputFile"] = str(output_jsonl)
    summary["checkpointFile"] = str(checkpoint_path)
    summary["failureLog"] = str(failure_path)
    write_json(out_dir / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))
    return stats


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safely collect current Korean law bodies to JSONL.")
    parser.add_argument("--dry-run", action="store_true", help="Read metadata and print plan only; no network, no DB write.")
    parser.add_argument("--limit", type=int, default=10, help="Number of law metadata rows to process.")
    parser.add_argument("--offset", type=int, default=0, help="Offset in current-law metadata list.")
    parser.add_argument("--resume", action="store_true", help="Skip MST values already recorded in checkpoint.")
    parser.add_argument("--checkpoint-file", default="", help="Checkpoint JSON path.")
    parser.add_argument("--failure-log", default="", help="Failure JSONL path.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Output directory. Defaults to /tmp.")
    parser.add_argument("--delay-seconds", type=float, default=SAFE_DEFAULT_DELAY_SECONDS, help="Delay between API requests.")
    parser.add_argument("--timeout-seconds", type=int, default=20, help="HTTP timeout per request.")
    parser.add_argument("--retries", type=int, default=2, help="Retries per law after the initial attempt.")
    parser.add_argument("--force", action="store_true", help="Allow overwriting existing raw body output/DB rows.")
    parser.add_argument("--write-db", action="store_true", help="Opt-in PostgreSQL insert/update. Default is file output only.")
    parser.add_argument("--service-url", default="https://www.law.go.kr/DRF/lawService.do", help="lawService endpoint.")
    parser.add_argument("--target", default="eflaw", choices=["eflaw", "law"], help="lawService target.")
    parser.add_argument("--min-body-chars", type=int, default=200, help="Minimum body length for success.")
    parser.add_argument("--user-agent", default="Mozilla/5.0 LexRex-LawCollector/1.0", help="HTTP user agent.")
    return parser


def validate_args(args: argparse.Namespace) -> None:
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")
    if args.limit > 10000:
        raise SystemExit("--limit is too large for this safety script; use batches <= 10000")
    out = Path(args.output_dir).resolve()
    out_s = str(out)
    if not (
        out_s == "/tmp"
        or out_s.startswith("/tmp/")
        or out_s == "/private/tmp"
        or out_s.startswith("/private/tmp/")
    ):
        raise SystemExit("--output-dir must be under /tmp for this safe collector")
    if args.write_db and args.dry_run:
        raise SystemExit("--write-db cannot be combined with --dry-run")


def main() -> int:
    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args)
    collect(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
