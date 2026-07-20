"""
5-1.collect_cases.py — 판례 RAG 확장 1단계: 소규모 키워드 기반 판례 수집 스캐폴딩.

⚠️ 본 스크립트의 **기본 모드는 dry-run** 입니다. 실제 외부 API 호출과 파일 쓰기는
``--apply`` 플래그를 명시적으로 줘야만 수행됩니다. 처음부터 전체 판례를 가져오지
않도록 ``--max-pages`` 기본값을 1로 둡니다.

호출 대상: 국가법령정보센터(law.go.kr) Open API
    GET {CASE_API_SEARCH_URL}?OC=...&target=prec&type=XML&query=...&display=...&page=...

본 스크립트가 **수행하지 않는 것**:
    - 기존 laws/laws_e5/cases/cases_e5 컬렉션 접근 (read조차 안 함)
    - DB 쓰기 (PostgreSQL 미접근)
    - ChromaDB upsert (별도 스크립트 5-2.insert_cases_e5.py 담당)
    - 컬렉션 삭제 / reset 옵션 일체 미제공

사용 예
-------
    # 도움말만 (dry-run 미리보기)
    python ai/generate_rag/5-1.collect_cases.py

    # 단일 키워드 dry-run
    python ai/generate_rag/5-1.collect_cases.py --keyword 표시광고 --max-pages 1

    # 실제 수집 (명시적 --apply 필요, OC env 필수)
    LAW_API_OC=<...> python ai/generate_rag/5-1.collect_cases.py \\
        --keyword 표시광고 --max-pages 1 --apply

    # 여러 키워드 일괄 dry-run (CASE_KEYWORDS env의 기본 8개)
    python ai/generate_rag/5-1.collect_cases.py --all-keywords

출력 (apply 모드 시)
-------------------
    {CASES_OUTPUT_DIR}/cases_index.jsonl   — 누적 append, case_id 중복 skip
    {CASES_OUTPUT_DIR}/cases_state.json    — 키워드별 마지막 수집 page (resume용)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Set

from case_config import (
    CASES_OUTPUT_DIR,
    CASE_KEYWORDS,
    CASE_MAX_PAGES,
    CASE_PAGE_SIZE,
    CASE_RATE_LIMIT_MS,
    CASE_API_SEARCH_URL,
    require_law_api_oc_for_cases,
)

LOG = logging.getLogger("collect_cases")


# ── 상태 파일 (resume) ────────────────────────────────────────────
def _state_path() -> str:
    return os.path.join(CASES_OUTPUT_DIR, "cases_state.json")


def _index_path() -> str:
    return os.path.join(CASES_OUTPUT_DIR, "cases_index.jsonl")


def _load_state() -> dict:
    p = _state_path()
    if not os.path.exists(p):
        return {"keywords": {}}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_state(state: dict) -> None:
    os.makedirs(CASES_OUTPUT_DIR, exist_ok=True)
    with open(_state_path(), "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _load_existing_case_ids() -> Set[str]:
    """이미 index에 적재된 case_id를 중복 skip 용으로 로드."""
    p = _index_path()
    if not os.path.exists(p):
        return set()
    ids: Set[str] = set()
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                cid = row.get("case_id")
                if cid:
                    ids.add(str(cid))
            except json.JSONDecodeError:
                continue
    return ids


# ── 호출 1건 ─────────────────────────────────────────────────────
def _build_search_url(oc: str, keyword: str, page: int) -> str:
    """국가법령정보센터 판례 목록 API URL (target=prec).

    실제 호출 형식이 변경될 가능성을 고려해 본 함수만 수정하면 적응 가능하게 분리.
    """
    from urllib.parse import urlencode

    qs = urlencode({
        "OC": oc,
        "target": "prec",
        "type": "XML",
        "query": keyword,
        "display": CASE_PAGE_SIZE,
        "page": page,
    })
    return f"{CASE_API_SEARCH_URL}?{qs}"


def _mask_oc_in_url(url: str) -> str:
    """URL에 OC=<값> 또는 oc=<값> 쿼리 파라미터가 포함되어 있으면 OC=<MASKED>로 치환.

    법제처 응답의 `판례상세링크` 필드에는 호출 시 사용한 OC 값이 그대로 박혀 있어,
    그대로 저장하면 metadata에 API 키가 평문 노출됨. forward-going 보호를 위해 항상 마스킹.
    """
    if not url:
        return url
    import re as _re
    return _re.sub(r"([?&][Oo][Cc])=[^&#]*", r"\1=<MASKED>", url)


def _parse_case_list_xml(xml_text: str) -> List[dict]:
    """판례 목록 XML 파싱 — case_id / case_name / court / decision_date / case_number 등 추출.

    실제 응답 스키마는 법제처 문서를 따라야 하므로 본 함수는 **스캐폴딩** 수준의
    필드만 끌어낸다. apply 모드에서 응답 샘플을 확인한 뒤 정교화할 것.
    """
    # 의존성: 표준 lib만 사용 (xml.etree). lxml은 선택.
    import xml.etree.ElementTree as ET

    rows: List[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        LOG.warning("XML 파싱 실패: %s", e)
        return rows

    # 후보 element 이름 — 실제 응답 확인 후 좁힐 것
    for prec in root.iter():
        tag = prec.tag.lower()
        if tag in ("prec", "case", "row"):
            row = {child.tag: (child.text or "").strip() for child in prec}
            # 가장 일반적으로 쓰이는 키 후보를 case_id로 normalize
            case_id = (
                row.get("판례일련번호") or row.get("caseId") or row.get("id") or ""
            ).strip()
            if not case_id:
                continue
            rows.append({
                "case_id": case_id,
                "case_name": row.get("사건명") or row.get("caseName") or "",
                "court": row.get("법원명") or row.get("court") or "",
                "decision_date": row.get("선고일자") or row.get("decisionDate") or "",
                "case_number": row.get("사건번호") or row.get("caseNumber") or "",
                # source_url 의 OC 값은 마스킹 후 저장 — 향후 메타데이터/응답 노출 시 API 키 노출 방지
                "source_url": _mask_oc_in_url(row.get("판례상세링크") or row.get("detailLink") or ""),
                # 데이터출처명 — 법제처 직영("") vs 외부 시스템("국세법령정보시스템" 등) 식별.
                # ★ 외부 출처 ID 는 lawService.do?target=prec 으로 본문 조회 시 빈 응답(<Law>)을 받음.
                "data_source": (row.get("데이터출처명") or "").strip(),
                # 법원종류코드/판결유형 등 추가 판별 키 — body 부재 원인 분석 시 활용
                "court_type_code": (row.get("법원종류코드") or "").strip(),
                "case_type_name": (row.get("사건종류명") or "").strip(),
                "verdict_type": (row.get("판결유형") or "").strip(),
                "_raw": row,
            })
    return rows


# ── 메인 수집 루프 ────────────────────────────────────────────────
def collect_keyword(
    keyword: str,
    max_pages: int,
    apply: bool,
    seen_ids: Set[str],
    state: dict,
) -> int:
    """단일 키워드 수집. apply=False면 dry-run (네트워크/파일쓰기 X)."""
    LOG.info("[CASE] keyword='%s' max_pages=%d apply=%s", keyword, max_pages, apply)

    if not apply:
        LOG.info("  └ dry-run — 실제 API 호출/파일쓰기 없음")
        LOG.info("  └ would GET %s",
                 _build_search_url(oc="<OC>", keyword=keyword, page=1))
        return 0

    # apply 모드: requests 동적 import (dry-run은 의존성 없이도 동작 가능하도록)
    try:
        import requests
    except ImportError as e:
        raise SystemExit("requests 패키지 필요. pip install requests") from e

    oc = require_law_api_oc_for_cases()
    start_page = state.get("keywords", {}).get(keyword, {}).get("next_page", 1)
    added = 0

    for page in range(start_page, start_page + max_pages):
        url = _build_search_url(oc=oc, keyword=keyword, page=page)
        LOG.info("  └ GET page=%d", page)
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
        except Exception as e:
            LOG.warning("  └ 호출 실패: %s", e)
            break

        rows = _parse_case_list_xml(resp.text)
        LOG.info("  └ page=%d 파싱 결과: %d건", page, len(rows))

        new_rows = []
        for row in rows:
            cid = row["case_id"]
            if cid in seen_ids:
                continue
            row["collected_at"] = datetime.now(timezone.utc).isoformat()
            row["keyword"] = keyword
            new_rows.append(row)
            seen_ids.add(cid)

        if new_rows:
            os.makedirs(CASES_OUTPUT_DIR, exist_ok=True)
            with open(_index_path(), "a", encoding="utf-8") as f:
                for r in new_rows:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            added += len(new_rows)
            LOG.info("  └ 신규 %d건 append (누적 unique=%d)", len(new_rows), len(seen_ids))
        else:
            LOG.info("  └ 신규 0건 (이미 적재된 case_id 또는 빈 페이지)")

        # 상태 업데이트 — 매 페이지마다 resume 가능하도록
        state.setdefault("keywords", {})[keyword] = {
            "next_page": page + 1,
            "last_collected_at": datetime.now(timezone.utc).isoformat(),
        }
        _save_state(state)

        # rate-limit
        time.sleep(CASE_RATE_LIMIT_MS / 1000.0)

    return added


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="판례 수집 스캐폴딩 — 기본 dry-run, --apply 명시 시 실제 호출.",
    )
    parser.add_argument("--keyword", help="단일 키워드 (생략 시 --all-keywords 또는 dry-run 미리보기)")
    parser.add_argument("--all-keywords", action="store_true",
                        help=f"CASE_KEYWORDS env의 모든 키워드 (기본 {len(CASE_KEYWORDS)}개)")
    parser.add_argument("--max-pages", type=int, default=1,
                        help=f"키워드당 최대 페이지 수 (default 1, env CASE_MAX_PAGES={CASE_MAX_PAGES})")
    parser.add_argument("--apply", action="store_true",
                        help="실제 API 호출 + JSONL append. 미지정 시 dry-run.")
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG 로깅")

    args = parser.parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    LOG.info("== collect_cases — output=%s collection_target=%s (dry-run=%s) ==",
             CASES_OUTPUT_DIR, "cases_e5", not args.apply)

    keywords: List[str]
    if args.all_keywords:
        keywords = list(CASE_KEYWORDS)
    elif args.keyword:
        keywords = [args.keyword]
    else:
        LOG.info("키워드 미지정 — dry-run 미리보기만 출력합니다.")
        for k in CASE_KEYWORDS:
            LOG.info("  · would collect keyword='%s'", k)
        LOG.info("실제 수집은 --keyword 또는 --all-keywords 와 --apply 를 함께 지정하세요.")
        return 0

    seen = _load_existing_case_ids() if args.apply else set()
    state = _load_state() if args.apply else {"keywords": {}}
    LOG.info("기존 누적 case_id: %d건", len(seen))

    total_added = 0
    for kw in keywords:
        total_added += collect_keyword(
            keyword=kw, max_pages=args.max_pages, apply=args.apply,
            seen_ids=seen, state=state,
        )

    LOG.info("총 신규 추가 case: %d건 (apply=%s)", total_added, args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
