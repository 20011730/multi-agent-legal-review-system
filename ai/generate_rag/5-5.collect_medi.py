#!/usr/bin/env python3
"""
5-5. 의료 보강 수집 — 한국의료분쟁조정중재원 (k-medi.or.kr) 조정중재사례.

prec API totalCnt 한계 (의료사고 3건, 진료과실 1건 등) 로 부족한 의료 분쟁 데이터를
한국의료분쟁조정중재원 공개 분쟁사례(HTML) 에서 보강.

- robots.txt 확인 (2026-05-19): Googlebot 만 일부 administrative 경로 disallow,
  /web/lay1/program/S1T118C291/dispute/ 는 누구나 접근 가능.
- 데이터 구조: HTML 페이지에 사건의 개요/분쟁의 요지/사안의 쟁점/사실관계/감정결과 텍스트 직접 포함.
  PDF 없음 — HTML 파싱만으로 본문 회수 가능.
- 사례 자체가 이미 익명화되어 있음 (신청인/피신청인, "환자(여, 30대)" 등).
  추가 안전 차원에서 주민번호/연락처 정규식 마스킹 적용.

대상 URL:
- list:   https://www.k-medi.or.kr/web/lay1/program/S1T118C291/dispute/list.do?cpage=<n>&rows=10
- detail: https://www.k-medi.or.kr/web/lay1/program/S1T118C291/dispute/view.do?seq=<id>

스키마 매핑 (기존 cases_bodies.jsonl 호환):
- case_id        = "medi_<seq>"
- case_name      = view 페이지 제목 (예: "사랑니 발치 후 잔존치근 및 통증 발생한 사례")
- court          = "한국의료분쟁조정중재원"
- decision_date  = "" (k-medi 사례는 공개 일자 없음. 추후 추출 가능 시 채움)
- case_number    = "seq=<id>"
- issue          = "사안의 쟁점" 섹션
- holding        = "감정결과의 요지" + "처리결과"
- body           = "사건의 개요" + "분쟁의 요지" + "사실관계" + "분쟁해결방안"
- summary        = 진료과목 (예: "치과", "정형외과")
- referenced_laws= "" (k-medi 사례는 법령 인용 직접 표시 없음)
- data_source    = "한국의료분쟁조정중재원"
- case_type_name = "의료분쟁 조정중재"
- body_status    = "ok" (body ≥ MIN_BODY_CHARS) | "empty"
- source_url     = view URL

dry-run 기본. 실제 호출은 --apply.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import logging
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

LOG = logging.getLogger("collect_medi")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

DATA_DIR = Path(__file__).resolve().parent / "cases_data"
OUT_FILE = DATA_DIR / "medi_bodies.jsonl"
SEEN_FILE = DATA_DIR / "medi_seen.json"

LIST_URL = "https://www.k-medi.or.kr/web/lay1/program/S1T118C291/dispute/list.do"
VIEW_URL = "https://www.k-medi.or.kr/web/lay1/program/S1T118C291/dispute/view.do"

# 본문 충분성 임계값 — 의료 사례는 평균 2~5천자, 800자 미만은 미흡 간주
MIN_BODY_CHARS = 200

DATA_SOURCE_LABEL = "한국의료분쟁조정중재원"
CASE_TYPE_LABEL = "의료분쟁 조정중재"

# 사용자 키워드 — 필터링용 (수집된 사례 중 키워드 매칭만 저장)
DEFAULT_KEYWORDS = [
    "의료사고", "의료과실", "진료과실", "설명의무",
    "수술", "오진", "진단", "의료분쟁", "조정", "중재",
    "감정", "합의", "손해배상",
]

# 마스킹 — 사례는 이미 익명화되어 있지만 안전 차원 정규식 추가
RE_PHONE = re.compile(r"\b0\d{1,2}-?\d{3,4}-?\d{4}\b")
RE_JUMIN = re.compile(r"\b\d{6}-?\d{7}\b")
RE_EMAIL = re.compile(r"[\w\.-]+@[\w\.-]+\.\w+")

USER_AGENT = "MultiAgentLegalReview-Bot/1.0 (capstone study; rate-limited; not Googlebot)"


def _http_get(url: str, timeout: int = 20) -> Optional[str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read()
        # k-medi 는 UTF-8 응답
        return raw.decode("utf-8", errors="replace")
    except Exception as exc:
        LOG.warning("http_get 실패: %s — %s", url, exc)
        return None


def _strip_tags(s: str) -> str:
    s = re.sub(r"<script[^>]*>.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<style[^>]*>.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</?(?:p|div|tr|li)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = ihtml.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n+", "\n", s).strip()
    return s


def _mask_pii(text: str) -> str:
    text = RE_PHONE.sub("[전화번호]", text)
    text = RE_JUMIN.sub("[주민번호]", text)
    text = RE_EMAIL.sub("[이메일]", text)
    return text


def _extract_th_td(html: str) -> Dict[str, str]:
    """info table 의 <th>/<td> pair 추출."""
    info: Dict[str, str] = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        th_m = re.search(r"<th[^>]*>(.*?)</th>", tr, re.S)
        td_m = re.search(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if th_m and td_m:
            k = _strip_tags(th_m.group(1)).strip()
            v = _strip_tags(td_m.group(1)).strip()
            if k and v:
                info[k] = v
    return info


def _extract_section(html: str, label: str, max_chars: int = 4000) -> str:
    """label 이후의 콘텐츠를 다음 label 이 나올 때까지 추출."""
    # 다음 섹션 라벨 후보 — 끊는 기준
    boundaries = [
        "사건의 개요", "진료과정과 의료", "분쟁의 요지", "사안의 쟁점",
        "사실관계", "분쟁해결방안", "감정결과의 요지", "조정성립",
        "처리결과", "키워드", "유사사례", "이전글", "다음글",
        "목록", "이전 다음", "단건보기",
    ]
    idx = html.find(label)
    if idx < 0:
        return ""
    # 라벨 위치 이후의 텍스트만 일단 잘라냄
    chunk = html[idx + len(label): idx + len(label) + max_chars * 4]  # HTML 태그 포함이라 여유 4배
    # 다음 경계까지
    cut = len(chunk)
    for b in boundaries:
        if b == label:
            continue
        j = chunk.find(b)
        if 0 < j < cut:
            cut = j
    chunk = chunk[:cut]
    text = _strip_tags(chunk)
    return text[:max_chars].strip()


def _extract_case_name(html: str) -> str:
    # <title> 또는 <h2>/<h3> 헤더
    m = re.search(r"<title>([^<]+)</title>", html)
    if m:
        title = _strip_tags(m.group(1))
        # 사이트명·메뉴명 제거
        title = re.sub(r"^.*?>", "", title).strip()
        if title:
            return title
    return ""


def _parse_detail(html: str, seq: str) -> Dict[str, str]:
    info_table = _extract_th_td(html)
    specialty = info_table.get("진료과목", "")
    result = info_table.get("처리결과", "")
    # 케이스 제목 — k-medi view 페이지의 진짜 사건 제목은
    #   <span class="view_title">사랑니 발치 후 잔존치근 및 통증 발생한 사례</span>
    # 형태로 들어있음. caption 안의 "조정중재사례 답변" 은 메뉴 라벨이므로 제외.
    case_name = ""
    m = re.search(r'class=["\']view_title["\'][^>]*>([^<]+)</', html)
    if m:
        case_name = _strip_tags(m.group(1)).strip()
    # fallback 1: th class="title" colspan 안의 텍스트
    if not case_name or case_name in ("조정중재사례 답변", "조정중재사례"):
        m2 = re.search(
            r'<th[^>]*class=["\']title["\'][^>]*>(.*?)</th>',
            html, re.S,
        )
        if m2:
            cand = _strip_tags(m2.group(1)).strip()
            if cand and cand not in ("조정중재사례 답변", "조정중재사례") and len(cand) > 4:
                case_name = cand
    # fallback 2: caption 다음 첫 번째 의미 있는 텍스트 (헤더 류 제외)
    if not case_name:
        for m3 in re.finditer(r'<(?:h[1-4]|strong)[^>]*>([^<]{5,120})</', html):
            cand = _strip_tags(m3.group(1)).strip()
            if not cand:
                continue
            if cand in ("조정중재사례 답변", "조정중재사례", "한국의료분쟁조정중재원"):
                continue
            if "공유" in cand or "메뉴" in cand or "접속" in cand:
                continue
            case_name = cand
            break
    # 진료과목 prefix 보강 — 의료 도메인 검색 매칭력 향상
    # (단순 stuffing 아님 — 사건 제목 앞에 진료과목을 한 번 명시)
    if case_name and specialty and specialty not in case_name:
        case_name = f"[{specialty}] {case_name}"

    # 본문 섹션들
    section_overview = _extract_section(html, "사건의 개요")
    section_dispute = _extract_section(html, "분쟁의 요지")
    section_issue = _extract_section(html, "사안의 쟁점")
    section_facts = _extract_section(html, "사실관계")
    section_resolution = _extract_section(html, "분쟁해결방안")
    section_appraisal = _extract_section(html, "감정결과의 요지")
    section_result = result  # th/td 에서 추출

    body_parts = [
        section_overview,
        section_dispute,
        section_facts,
        section_resolution,
    ]
    body = "\n\n".join(p for p in body_parts if p)
    body = _mask_pii(body)

    holding_parts = [section_appraisal, section_result]
    holding = _mask_pii("\n\n".join(p for p in holding_parts if p))

    return {
        "case_id": f"medi_{seq}",
        "case_name": case_name or f"의료분쟁 사례 seq={seq}",
        "court": "한국의료분쟁조정중재원",
        "decision_date": "",
        "case_number": f"seq={seq}",
        "issue": _mask_pii(section_issue),
        "holding": holding,
        "body": body,
        "summary": specialty,
        "referenced_laws": "",
        "source_url": f"{VIEW_URL}?seq={seq}",
        "case_type_name": CASE_TYPE_LABEL,
        "data_source": DATA_SOURCE_LABEL,
    }


def _list_seqs(cpage: int, rows: int = 10) -> List[str]:
    qs = urllib.parse.urlencode({"cpage": cpage, "rows": rows})
    raw = _http_get(f"{LIST_URL}?{qs}")
    if not raw:
        return []
    # view.do?seq=NNNN 중 12582(banner) 제외
    seqs = re.findall(r"view\.do\?seq=(\d+)", raw)
    return [s for s in seqs if s != "12582"]


def _matches_keywords(row: Dict, keywords: List[str]) -> bool:
    if not keywords:
        return True
    blob = " ".join([
        row.get("case_name", ""),
        row.get("summary", ""),
        row.get("body", "")[:1000],
        row.get("holding", "")[:500],
        row.get("issue", "")[:500],
    ])
    return any(k in blob for k in keywords)


def main() -> int:
    ap = argparse.ArgumentParser(description="한국의료분쟁조정중재원 분쟁사례 수집.")
    ap.add_argument("--keywords", nargs="*", default=DEFAULT_KEYWORDS,
                    help="filter — 본문/사건명 매칭 시에만 저장 (default: 의료 키워드 13개)")
    ap.add_argument("--max-pages", type=int, default=3,
                    help="list 페이지 수 (default 3 = 30 case)")
    ap.add_argument("--rate-limit-ms", type=int, default=600,
                    help="요청 간 대기 시간 (ms, default 600)")
    ap.add_argument("--apply", action="store_true",
                    help="실제 호출 + JSONL append. 미지정 시 dry-run.")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()
    if args.verbose:
        LOG.setLevel(logging.DEBUG)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # seen
    seen: set = set()
    if SEEN_FILE.exists():
        try:
            seen = set(json.loads(SEEN_FILE.read_text(encoding="utf-8")))
        except Exception:
            seen = set()

    LOG.info("== collect_medi (dry-run=%s) ==", not args.apply)
    LOG.info("keywords=%d max-pages=%d rate=%dms seen=%d MIN_BODY=%d",
             len(args.keywords), args.max_pages, args.rate_limit_ms, len(seen), MIN_BODY_CHARS)

    rate_sleep = max(0.4, args.rate_limit_ms / 1000.0)
    new_rows: List[Dict] = []
    stats = {"list_calls": 0, "detail_calls": 0,
             "appended": 0, "skipped_seen": 0,
             "skipped_short": 0, "skipped_unrelated": 0,
             "skipped_empty": 0}

    all_seqs: List[str] = []
    for cpage in range(1, args.max_pages + 1):
        LOG.info("  · list cpage=%d", cpage)
        if not args.apply:
            LOG.info("    (dry-run — list 호출 생략)")
            continue
        seqs = _list_seqs(cpage)
        stats["list_calls"] += 1
        if not seqs:
            LOG.info("    빈 페이지 — 종료")
            break
        all_seqs.extend(seqs)
        time.sleep(rate_sleep)
    # dedup within run
    all_seqs = list(dict.fromkeys(all_seqs))
    LOG.info("총 유니크 seq 수집 후보: %d", len(all_seqs))

    for seq in all_seqs:
        if seq in seen:
            stats["skipped_seen"] += 1
            continue
        if not args.apply:
            continue
        url = f"{VIEW_URL}?seq={seq}"
        html = _http_get(url)
        stats["detail_calls"] += 1
        time.sleep(rate_sleep)
        if not html:
            stats["skipped_empty"] += 1
            continue
        row = _parse_detail(html, seq)
        # 본문 길이 검증
        if len(row.get("body", "") or "") < MIN_BODY_CHARS:
            stats["skipped_short"] += 1
            seen.add(seq)
            continue
        # 키워드 필터
        if not _matches_keywords(row, args.keywords):
            stats["skipped_unrelated"] += 1
            seen.add(seq)
            continue
        row["body_status"] = "ok"
        row["detail_root"] = "k-medi-html"
        row["collected_at"] = datetime.now(timezone.utc).isoformat()
        new_rows.append(row)
        seen.add(seq)
        LOG.info("    ✓ %s body=%d chars (%s | %s)",
                 seq, len(row.get("body", "") or ""),
                 row.get("summary", "")[:8], (row.get("case_name", "") or "")[:40])

    if args.apply and new_rows:
        with OUT_FILE.open("a", encoding="utf-8") as f:
            for row in new_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        stats["appended"] = len(new_rows)
        SEEN_FILE.write_text(json.dumps(sorted(seen), ensure_ascii=False, indent=2),
                             encoding="utf-8")

    LOG.info("완료 — appended=%d skipped_seen=%d skipped_short=%d skipped_unrelated=%d skipped_empty=%d "
             "list_calls=%d detail_calls=%d",
             stats["appended"], stats["skipped_seen"], stats["skipped_short"],
             stats["skipped_unrelated"], stats["skipped_empty"],
             stats["list_calls"], stats["detail_calls"])
    if args.apply and new_rows:
        LOG.info("다음 단계: CHROMA_CLIENT_MODE=http python3 5-2.insert_cases_e5.py "
                 f"--input {OUT_FILE} --apply --batch-size 128")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
