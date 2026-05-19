"""
5-3.fetch_case_bodies.py — 판례 RAG 확장 3단계: 본문(issue/holding/referenced_laws/body) 보강 스캐폴딩.

⚠️ 기본 모드는 **dry-run** 입니다. ``--apply`` 플래그가 없으면 네트워크 호출도, 파일 쓰기도
하지 않습니다. 처음부터 전체 본문을 끌어오지 않도록 ``--limit`` 기본값을 3으로 둡니다.

목적
----
5-1.collect_cases.py 가 만든 ``cases_index.jsonl`` 은 사건명/법원/선고일/사건번호 같은
**목록 메타** 만 담고 있고, 판시사항(issue)·판결요지(holding)·참조조문(referenced_laws)·
판례본문(body) 은 비어 있습니다. 본 스크립트가 ``lawService.do?target=prec&ID=<case_id>``
를 호출해 그 필드들을 채운 ``cases_bodies.jsonl`` 을 별도 파일로 누적합니다.

본 스크립트가 **수행하지 않는 것**
- ChromaDB upsert (5-2가 담당)
- 컬렉션 삭제 / reset (옵션 자체 없음)
- 기존 ``cases_index.jsonl`` 덮어쓰기 (별도 ``cases_bodies.jsonl`` 사용)
- 외부 API 키 평문 저장 (응답 URL의 OC 값은 마스킹)

사용 예
-------
    # dry-run 미리보기
    python ai/generate_rag/5-3.fetch_case_bodies.py

    # 3건 실제 호출 (OC env 필요)
    LAW_API_OC=<...> python ai/generate_rag/5-3.fetch_case_bodies.py --apply --limit 3

    # 누적 후 5-2 재실행 (issue/holding/referenced_laws/body chunk 정식 생성)
    CHROMA_CLIENT_MODE=http CHROMA_HOST=localhost CHROMA_PORT=8000 \\
    python ai/generate_rag/5-2.insert_cases_e5.py \\
        --input ai/generate_rag/cases_data/cases_bodies.jsonl --apply --limit 10
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

from case_config import (
    CASES_OUTPUT_DIR,
    CASE_API_SERVICE_URL,
    CASE_RATE_LIMIT_MS,
    require_law_api_oc_for_cases,
)

LOG = logging.getLogger("fetch_case_bodies")


def _mask_oc_in_url(url: str) -> str:
    if not url:
        return url
    return re.sub(r"([?&][Oo][Cc])=[^&#]*", r"\1=<MASKED>", url)


def _index_path() -> str:
    return os.path.join(CASES_OUTPUT_DIR, "cases_index.jsonl")


def _bodies_path() -> str:
    return os.path.join(CASES_OUTPUT_DIR, "cases_bodies.jsonl")


def _load_index() -> List[Dict]:
    p = _index_path()
    if not os.path.exists(p):
        return []
    out = []
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _load_existing_body_ids() -> set:
    p = _bodies_path()
    if not os.path.exists(p):
        return set()
    seen = set()
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            try:
                seen.add(str(json.loads(line).get("case_id")))
            except Exception:
                continue
    return seen


def _build_detail_url(oc: str, case_id: str) -> str:
    from urllib.parse import urlencode
    qs = urlencode({"OC": oc, "target": "prec", "type": "XML", "ID": case_id})
    return f"{CASE_API_SERVICE_URL}?{qs}"


def _parse_case_detail_xml(xml_text: str) -> Dict:
    """판례 상세 XML → issue / holding / referenced_laws / referenced_cases / body / body_status.

    실제 법제처 응답(2026-05-15 sample dump 기준) 의 root 는 ``<PrecService>`` 이고
    직접 자식 element 는 다음과 같음::

        판례정보일련번호 / 사건명 / 사건번호 / 선고일자 / 선고 /
        법원명 / 법원종류코드 / 사건종류명 / 사건종류코드 / 판결유형 /
        판시사항(=issue) / 판결요지(=holding) / 참조조문(=referenced_laws) /
        참조판례(=referenced_cases) / 판례내용(=body, 본문 5,000자 이상)

    ``판례내용`` 이 실제 본문이므로 후보 키 첫 번째로 넣었다. 다른 환경/스키마 변화를
    대비해 ``판례본문/전문/본문/body/reasoning`` 도 fallback 으로 유지.

    body_status 값 (적재 측이 metadata 로 노출 가능)
        - ``"ok"``                  : 본문 또는 issue/holding/ref 중 1개 이상 보강됨
        - ``"empty-root:<tag>"``    : root tag 가 ``PrecService`` 가 아닌 빈 응답 (행정해석/오타 ID 등)
        - ``"all-empty"``           : root 는 정상이나 모든 본문 element 가 비어 있음 (판례인데 본문이 없는 드문 케이스)
        - ``"xml-parse-error"``     : XML 파싱 자체 실패
    """
    import xml.etree.ElementTree as ET
    out: Dict[str, str] = {
        "issue": "",
        "holding": "",
        "referenced_laws": "",
        "referenced_cases": "",
        "body": "",
        # 보강 결과 진단용 — 본문이 비어 있는 case 에서 원인을 식별하기 위한 메타
        "body_status": "ok",
        "detail_root": "",
    }
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        LOG.warning("detail XML 파싱 실패: %s", e)
        out["body_status"] = "xml-parse-error"
        return out

    out["detail_root"] = root.tag or ""

    # 후보 키 매핑 — 실제 응답 element 이름 우선, 변형 fallback
    candidates = {
        "issue":           ["판시사항", "issue", "issues"],
        "holding":         ["판결요지", "holding", "summary"],
        "referenced_laws": ["참조조문", "referencedLaws"],
        "referenced_cases":["참조판례", "referencedCases"],
        # ★ "판례내용" 이 실제 본문 element. 기존 후보(판례본문/전문/...)는 빈 매칭이었던 원인.
        "body":            ["판례내용", "판례본문", "전문", "본문", "body", "reasoning"],
    }
    for elem in root.iter():
        for our_key, cands in candidates.items():
            if elem.tag in cands and not out[our_key]:
                text = "".join(elem.itertext()).strip() if list(elem) else (elem.text or "").strip()
                if text:
                    out[our_key] = text

    # body_status 판정
    has_any = any(out[k] for k in ("issue", "holding", "referenced_laws", "referenced_cases", "body"))
    if not has_any:
        # root 가 PrecService 가 아니면 행정해석/잘못된 ID 등으로 추정
        if root.tag != "PrecService":
            out["body_status"] = f"empty-root:{root.tag}"
        else:
            out["body_status"] = "all-empty"
    return out


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="판례 본문(issue/holding/referenced_laws/body) 보강 — 기본 dry-run.",
    )
    parser.add_argument("--apply", action="store_true",
                        help="실제 API 호출 + cases_bodies.jsonl append. 미지정 시 dry-run.")
    parser.add_argument("--limit", type=int, default=3,
                        help="처리할 case_id 수 (default 3 — 대량 호출 방지)")
    parser.add_argument("--dump-xml", action="store_true",
                        help="첫 1건의 응답 XML 의 root tag / 직접 자식 element 이름만 stderr 로 출력 (디버깅용, 값 평문 출력 X)")
    parser.add_argument("--force-refetch", action="store_true",
                        help="cases_bodies.jsonl 의 기존 case_id 도 무시하고 다시 호출 + append "
                             "(파서 보완 후 같은 case 를 더 풍부한 본문으로 다시 받을 때 사용). "
                             "기존 파일/컬렉션은 삭제하지 않음 — append 후 5-2 가 chunk_id 기준 upsert 로 멱등 처리.")
    parser.add_argument("--skip-data-sources", default="국세법령정보시스템",
                        help="해당 data_source 값(콤마 구분) 을 가진 case 는 detail 호출을 skip 하고 "
                             "cases_bodies.jsonl 에 meta-only row 만 append. "
                             "lawService.do?target=prec 가 빈 응답(<Law> root)을 주는 외부 시스템 출처 case "
                             "(예: 국세법령정보시스템) 의 외부 API 호출 비용 절약. "
                             "기본값=국세법령정보시스템 (직전 turn 들에서 0건 보강 확인). "
                             "비활성화: --skip-data-sources='' 명시. "
                             "skip된 case 는 body_status='skip:external-data-source' 로 표시되어 사후 식별 가능.")
    parser.add_argument("--dry-run", action="store_true",
                        help="(별칭) --apply 와 반대. 명시해도 동작은 dry-run (기본과 동일)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    index_rows = _load_index()
    if not index_rows:
        LOG.warning("입력 없음: %s — 먼저 5-1.collect_cases.py 로 case_id 수집 필요.", _index_path())
        return 0

    seen_body_ids = _load_existing_body_ids() if not args.force_refetch else set()
    if args.force_refetch and seen_body_ids:
        LOG.info("--force-refetch: 기존 cases_bodies.jsonl 의 case_id %d 건도 dedup 없이 재호출",
                 len(_load_existing_body_ids()))
    targets = [r for r in index_rows if str(r.get("case_id")) not in seen_body_ids]
    if args.limit > 0:
        targets = targets[: args.limit]

    LOG.info("== fetch_case_bodies (dry-run=%s) ==", not args.apply)
    LOG.info("index rows: %d / 보강 대상 (이미 본문 보유 제외): %d",
             len(index_rows), len(targets))

    if not args.apply:
        for r in targets[:5]:
            LOG.info("  · would GET detail for case_id=%s case_name=%r",
                     r.get("case_id"), (r.get("case_name") or "")[:50])
        LOG.info("실제 호출은 --apply 와 함께 다시 실행하세요.")
        return 0

    # apply 모드
    try:
        import requests
    except ImportError as e:
        raise SystemExit("requests 패키지 필요. pip install requests") from e

    oc = require_law_api_oc_for_cases()
    os.makedirs(CASES_OUTPUT_DIR, exist_ok=True)
    added = 0
    dumped_once = False
    skipped_external = 0
    # body_status 분포 집계 — 본문 보강률을 한눈에 보기 위한 turn 통계
    status_counter: Dict[str, int] = {}

    # 외부 시스템 출처 (target=prec 으로 본문 조회 불가) skip set
    skip_sources = {s.strip() for s in (args.skip_data_sources or "").split(",") if s.strip()}

    for r in targets:
        case_id = str(r.get("case_id"))
        # data_source 사전 분류 — 외부 시스템 출처면 detail API 호출 자체 skip (비용 절약)
        ds = (r.get("data_source") or "").strip()
        if skip_sources and ds in skip_sources:
            merged = dict(r)
            merged["body_status"] = "skip:external-data-source"
            merged["detail_root"] = ""  # 호출하지 않음
            merged["body_fetched_at"] = datetime.now(timezone.utc).isoformat()
            with open(_bodies_path(), "a", encoding="utf-8") as f:
                f.write(json.dumps(merged, ensure_ascii=False) + "\n")
            added += 1
            skipped_external += 1
            status_counter["skip:external-data-source"] = status_counter.get("skip:external-data-source", 0) + 1
            LOG.info("  ⤵ %s detail 호출 skip (data_source='%s' — 외부 시스템). meta-only row append.",
                     case_id, ds)
            continue

        url = _build_detail_url(oc=oc, case_id=case_id)
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
        except Exception as e:
            LOG.warning("  └ %s 호출 실패: %s", case_id, e)
            time.sleep(CASE_RATE_LIMIT_MS / 1000.0)
            continue

        # --dump-xml: 첫 1건의 element 이름 구조만 stderr 로 미리보기 (값 평문 X)
        if args.dump_xml and not dumped_once:
            try:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.text)
                kids = [c.tag for c in list(root)]
                print(f"[dump-xml] root={root.tag}, kids={kids}", file=sys.stderr)
                dumped_once = True
            except Exception as exc:
                print(f"[dump-xml] failed: {exc}", file=sys.stderr)

        fields = _parse_case_detail_xml(resp.text)
        merged = dict(r)  # 원본 메타 유지
        merged.update(fields)
        merged["body_fetched_at"] = datetime.now(timezone.utc).isoformat()
        merged["source_url"] = _mask_oc_in_url(merged.get("source_url", ""))

        with open(_bodies_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(merged, ensure_ascii=False) + "\n")
        added += 1

        status = fields.get("body_status", "ok")
        status_counter[status] = status_counter.get(status, 0) + 1
        if status == "ok":
            LOG.info("  ✓ %s 본문 보강 (issue=%d holding=%d body=%d ref=%d)",
                     case_id,
                     len(fields["issue"]), len(fields["holding"]),
                     len(fields["body"]), len(fields["referenced_laws"]))
        else:
            # 본문 미보강 — 5-2 의 meta fallback chunk 만 적재됨. 사용자에게 명확히 알림.
            ds = r.get("data_source", "") or ""
            ctn = r.get("case_type_name", "") or ""
            ds_hint = (
                f" data_source='{ds}' → 법제처 외부 시스템 데이터로 추정. "
                f"lawService.do?target=prec 로는 본문 조회 불가."
                if ds else
                f" data_source 비어있음 — list API 의 ID 가 prec 카테고리가 아니거나 응답 구조 변경 가능성."
            )
            LOG.warning(
                "  ⚠ %s 본문 미보강 (body_status=%s, detail_root=%s, case_type=%s).%s "
                "5-2 가 meta fallback chunk 1건만 생성합니다.",
                case_id, status, fields.get("detail_root", ""), ctn, ds_hint
            )
        time.sleep(CASE_RATE_LIMIT_MS / 1000.0)

    LOG.info("총 신규 본문 추가: %d건 (외부 시스템 skip=%d, detail 호출=%d). "
             "다음 단계: 5-2.insert_cases_e5.py --input %s --apply",
             added, skipped_external, added - skipped_external, _bodies_path())
    if status_counter:
        # body_status 분포 — 본문 보강률을 한눈에 (이번 turn 처리분 기준)
        sorted_dist = sorted(status_counter.items(), key=lambda kv: -kv[1])
        dist_str = ", ".join(f"{k}={v}" for k, v in sorted_dist)
        LOG.info("body_status 분포 (이번 turn): %s", dist_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
