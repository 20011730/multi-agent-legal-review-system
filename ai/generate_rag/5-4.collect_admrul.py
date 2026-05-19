#!/usr/bin/env python3
"""
5-4. 학교폭력/행정심판/위원회결정 보강 수집 — 법제처 admrul / expc / detc 통합.

prec API totalCnt 한계로 학폭/의료 도메인 case 가 부족한 문제를 해결하기 위해,
법제처 lawSearch.do 의 다음 추가 target 을 활용:

- target=admrul (행정규칙: 고시/규정 등 법령 인근 규범)
- target=expc   (법령해석례: 법제처가 해석한 사례)
- target=detc   (헌법재판소 결정례)

각 target 의 detail 응답은 prec 과 다른 XML 구조이지만,
공통 필드(사건명/안건명/규칙명, 일자, 본문/전문/조문, 참조조문 등)를
**기존 cases_bodies.jsonl 스키마**(case_id/case_name/court/decision_date/case_number/
issue/holding/body/referenced_laws/data_source/body_status/case_type_name/source_url)
로 평탄화하여 별도 파일에 append.

이후 `5-2.insert_cases_e5.py --input ./cases_data/admrul_bodies.jsonl --apply`
로 cases_e5 add-only upsert.

설계 원칙:
- 기존 prec 적재와 충돌 회피 위해 case_id 에 prefix 사용:
    admrul → "admrul_<행정규칙일련번호>"
    expc   → "expc_<법령해석례일련번호>"
    detc   → "detc_<헌재결정례일련번호>"
- data_source 는 사용자 친화 한글:
    admrul → "법제처 행정규칙"
    expc   → "법제처 법령해석례"
    detc   → "헌법재판소"
- case_type_name 으로 행정규칙 / 법령해석례 / 헌재결정례 구분
- 본문이 비어있거나 < MIN_BODY_CHARS 인 항목은 skip (이 스크립트는 body-rich 만 저장)
- 기존 cases_data/cases_bodies.jsonl 은 건드리지 않음. 별도 파일에 append.

dry-run 기본. 실제 호출은 --apply.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# 동일 디렉터리의 case_config 재사용
sys.path.insert(0, str(Path(__file__).resolve().parent))
from case_config import (  # type: ignore[import-not-found]
    CASE_API_OC,
    CASE_RATE_LIMIT_MS,
    require_law_api_oc_for_cases as require_oc,
)

LOG = logging.getLogger("collect_admrul")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

DATA_DIR = Path(__file__).resolve().parent / "cases_data"
OUT_FILE = DATA_DIR / "admrul_bodies.jsonl"
SEEN_FILE = DATA_DIR / "admrul_seen.json"  # set of "target:id"

LAW_LIST_ENDPOINT = "http://www.law.go.kr/DRF/lawSearch.do"
LAW_DETAIL_ENDPOINT = "http://www.law.go.kr/DRF/lawService.do"

DEFAULT_KEYWORDS = [
    "학교폭력",
    "학교폭력대책심의위원회",
    "학교폭력예방",
    "가해학생",
    "피해학생",
    "출석정지",
    "전학",
    "퇴학",
    "서면사과",
    "접촉금지",
]

TARGETS = ["admrul", "expc", "detc"]

DATA_SOURCE_LABEL = {
    "admrul": "법제처 행정규칙",
    "expc":   "법제처 법령해석례",
    "detc":   "헌법재판소",
}
CASE_TYPE_LABEL = {
    "admrul": "행정규칙",
    "expc":   "법령해석례",
    "detc":   "헌재결정례",
}

MIN_BODY_CHARS = 80  # 이보다 짧으면 본문 미확보로 간주, skip

# 외부 시스템 (이 스크립트에선 발생 가능성 낮으나 일관성 위해 정의)
EXTERNAL_DATA_SOURCES = {"국세법령정보시스템"}


# ── 유틸 ─────────────────────────────────────────────────────────────
def _strip_tags(s: Optional[str]) -> str:
    if not s:
        return ""
    # 간단 태그/공백 정리
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _yyyymmdd_to_dot(s: Optional[str]) -> str:
    if not s:
        return ""
    s = s.strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}.{s[4:6]}.{s[6:]}"
    return s


def _mask_oc(url: str) -> str:
    if not url:
        return ""
    return re.sub(r"OC=[^&]+", "OC=<MASKED>", url)


def _http_get_xml(url: str) -> Optional[ET.Element]:
    try:
        raw = urllib.request.urlopen(url, timeout=20).read()
        return ET.fromstring(raw)
    except Exception as exc:
        LOG.warning("http_get_xml 실패: %s — %s", url, exc)
        return None


def _findtext(el: ET.Element, *tags: str) -> str:
    for t in tags:
        v = el.findtext(t)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _load_seen() -> set:
    if SEEN_FILE.exists():
        try:
            return set(json.loads(SEEN_FILE.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def _save_seen(seen: set) -> None:
    SEEN_FILE.write_text(
        json.dumps(sorted(seen), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── target 별 detail 파싱 ────────────────────────────────────────────
def _parse_admrul_detail(root: ET.Element) -> Optional[Dict]:
    """행정규칙 detail → row dict."""
    info = root.find("행정규칙기본정보")
    if info is None:
        return None
    rid = _findtext(info, "행정규칙일련번호")
    if not rid:
        return None
    name = _findtext(info, "행정규칙명")
    rule_type = _findtext(info, "행정규칙종류")
    enforce = _yyyymmdd_to_dot(_findtext(info, "시행일자"))
    dept = _findtext(info, "소관부처명")

    # 조문/본문 텍스트는 별도 element 들에 산재 — 텍스트 통째로 수집
    body_parts: List[str] = []
    for el in root.iter():
        tag = el.tag
        if tag in {"조문내용", "조문내용1", "조문내용2", "본문",
                   "내용", "전문", "조문내용3", "조문내용4"}:
            txt = _strip_tags("".join(el.itertext()))
            if txt:
                body_parts.append(txt)
    body = "\n\n".join(body_parts).strip()
    return {
        "case_id": f"admrul_{rid}",
        "case_name": name,
        "court": dept or "교육부",  # admrul 은 소관부처
        "decision_date": enforce,
        "case_number": _findtext(info, "발령번호"),
        "issue": "",
        "holding": "",
        "body": body,
        "summary": rule_type,
        "referenced_laws": "",
        "source_url": _mask_oc(
            f"{LAW_DETAIL_ENDPOINT}?OC={CASE_API_OC}&target=admrul&ID={rid}&type=HTML"
        ),
        "case_type_name": CASE_TYPE_LABEL["admrul"],
        "data_source": DATA_SOURCE_LABEL["admrul"],
    }


def _parse_expc_detail(root: ET.Element) -> Optional[Dict]:
    """법령해석례 detail → row dict."""
    rid = _findtext(root, "법령해석례일련번호")
    if not rid:
        return None
    name = _findtext(root, "안건명")
    issue = _strip_tags(_findtext(root, "질의요지"))
    answer = _strip_tags(_findtext(root, "회답"))
    reason = _strip_tags(_findtext(root, "이유"))
    body = "\n\n".join(p for p in [issue, answer, reason] if p)
    return {
        "case_id": f"expc_{rid}",
        "case_name": name,
        "court": _findtext(root, "해석기관명") or "법제처",
        "decision_date": _yyyymmdd_to_dot(_findtext(root, "해석일자")),
        "case_number": _findtext(root, "안건번호"),
        "issue": issue,
        "holding": answer,
        "body": body,
        "summary": "",
        "referenced_laws": _strip_tags(_findtext(root, "관련법령")),
        "source_url": _mask_oc(
            f"{LAW_DETAIL_ENDPOINT}?OC={CASE_API_OC}&target=expc&ID={rid}&type=HTML"
        ),
        "case_type_name": CASE_TYPE_LABEL["expc"],
        "data_source": DATA_SOURCE_LABEL["expc"],
    }


def _parse_detc_detail(root: ET.Element) -> Optional[Dict]:
    """헌재결정례 detail → row dict."""
    rid = _findtext(root, "헌재결정례일련번호")
    if not rid:
        return None
    name = _findtext(root, "사건명")
    case_no = _findtext(root, "사건번호")
    issue = _strip_tags(_findtext(root, "판시사항"))
    holding = _strip_tags(_findtext(root, "결정요지"))
    body = _strip_tags(_findtext(root, "전문"))
    return {
        "case_id": f"detc_{rid}",
        "case_name": name,
        "court": "헌법재판소",
        "decision_date": _yyyymmdd_to_dot(_findtext(root, "종국일자")),
        "case_number": case_no,
        "issue": issue,
        "holding": holding,
        "body": body,
        "summary": _findtext(root, "사건종류명"),
        "referenced_laws": _strip_tags(_findtext(root, "참조조문")),
        "source_url": _mask_oc(
            f"{LAW_DETAIL_ENDPOINT}?OC={CASE_API_OC}&target=detc&ID={rid}&type=HTML"
        ),
        "case_type_name": CASE_TYPE_LABEL["detc"],
        "data_source": DATA_SOURCE_LABEL["detc"],
    }


DETAIL_PARSERS = {
    "admrul": _parse_admrul_detail,
    "expc":   _parse_expc_detail,
    "detc":   _parse_detc_detail,
}


# ── 리스트 호출 + ID 수집 ────────────────────────────────────────────
def _list_ids(target: str, keyword: str, page: int, display: int) -> List[str]:
    qs = urllib.parse.urlencode({
        "OC": CASE_API_OC,
        "target": target,
        "type": "XML",
        "query": keyword,
        "display": display,
        "page": page,
    })
    url = f"{LAW_LIST_ENDPOINT}?{qs}"
    root = _http_get_xml(url)
    if root is None:
        return []
    # id field 이름이 target 별로 다름
    id_tag = {
        "admrul": "행정규칙일련번호",
        "expc":   "법령해석례일련번호",
        "detc":   "헌재결정례일련번호",
    }[target]
    return [
        el.findtext(id_tag) or ""
        for el in root.iter()
        if el.findtext(id_tag)
    ]


def _fetch_detail(target: str, rid: str) -> Optional[Dict]:
    qs = urllib.parse.urlencode({
        "OC": CASE_API_OC,
        "target": target,
        "type": "XML",
        "ID": rid,
    })
    url = f"{LAW_DETAIL_ENDPOINT}?{qs}"
    root = _http_get_xml(url)
    if root is None:
        return None
    parser = DETAIL_PARSERS[target]
    row = parser(root)
    if row:
        row["body_status"] = "ok" if len((row.get("body") or "")) >= MIN_BODY_CHARS else "empty"
        row["detail_root"] = root.tag
        row["collected_at"] = datetime.now(timezone.utc).isoformat()
    return row


# ── 메인 ────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="학폭/행정심판/헌재 보강 수집 (admrul/expc/detc).")
    ap.add_argument("--keywords", nargs="*", default=DEFAULT_KEYWORDS,
                    help="검색 키워드 목록 (default: 학교폭력 계열 10개)")
    ap.add_argument("--targets", nargs="*", default=TARGETS,
                    choices=TARGETS, help="조회 target")
    ap.add_argument("--max-pages", type=int, default=5,
                    help="키워드당 최대 페이지 (default 5)")
    ap.add_argument("--display", type=int, default=10,
                    help="페이지당 결과 수 (default 10)")
    ap.add_argument("--apply", action="store_true",
                    help="실제 API 호출 + JSONL append. 미지정 시 dry-run.")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()
    if args.verbose:
        LOG.setLevel(logging.DEBUG)

    require_oc()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    seen = _load_seen()
    LOG.info("== collect_admrul (dry-run=%s) ==", not args.apply)
    LOG.info("keywords=%d targets=%s max-pages=%d display=%d seen=%d",
             len(args.keywords), args.targets, args.max_pages, args.display, len(seen))

    new_rows: List[Dict] = []
    stats = {"list_calls": 0, "detail_calls": 0,
             "appended": 0, "skipped_seen": 0,
             "skipped_short": 0, "skipped_empty": 0,
             "external_skip": 0}
    rate_sleep = max(0.4, CASE_RATE_LIMIT_MS / 1000.0)

    for target in args.targets:
        for kw in args.keywords:
            ids: List[str] = []
            for pg in range(1, args.max_pages + 1):
                LOG.info("  · list target=%s keyword=%s page=%d", target, kw, pg)
                if args.apply:
                    found = _list_ids(target, kw, pg, args.display)
                    stats["list_calls"] += 1
                    time.sleep(rate_sleep)
                else:
                    LOG.info("    (dry-run — list 호출 생략)")
                    found = []
                if not found:
                    break
                ids.extend(found)
            # detail
            for rid in ids:
                key = f"{target}:{rid}"
                if key in seen:
                    stats["skipped_seen"] += 1
                    continue
                if not args.apply:
                    continue
                row = _fetch_detail(target, rid)
                stats["detail_calls"] += 1
                time.sleep(rate_sleep)
                if row is None:
                    stats["skipped_empty"] += 1
                    continue
                if row.get("data_source") in EXTERNAL_DATA_SOURCES:
                    stats["external_skip"] += 1
                    continue
                if row.get("body_status") != "ok":
                    stats["skipped_short"] += 1
                    seen.add(key)
                    continue
                new_rows.append(row)
                seen.add(key)
                LOG.info("    ✓ %s %s body=%d chars (%s)",
                         target, rid, len(row.get("body", "") or ""),
                         (row.get("case_name") or "")[:40])

    if args.apply and new_rows:
        with OUT_FILE.open("a", encoding="utf-8") as f:
            for row in new_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        stats["appended"] = len(new_rows)
        _save_seen(seen)

    LOG.info("완료 — appended=%d skipped_seen=%d skipped_short=%d skipped_empty=%d external_skip=%d "
             "list_calls=%d detail_calls=%d",
             stats["appended"], stats["skipped_seen"], stats["skipped_short"],
             stats["skipped_empty"], stats["external_skip"],
             stats["list_calls"], stats["detail_calls"])
    LOG.info("다음 단계 (apply 모드 후): "
             "CHROMA_CLIENT_MODE=http python3 5-2.insert_cases_e5.py "
             f"--input {OUT_FILE.relative_to(Path.cwd()) if OUT_FILE.is_relative_to(Path.cwd()) else OUT_FILE} --apply --batch-size 128")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
