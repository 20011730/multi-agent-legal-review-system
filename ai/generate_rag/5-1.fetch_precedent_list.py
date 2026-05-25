"""
국가법령정보센터 판례 목록 API에서 전체 판례 메타데이터를 수집한다.

복원력 설계:
  - 페이지 단위 재시도 (MAX_RETRIES회 backoff)
  - CHECKPOINT_EVERY 페이지마다 디스크에 저장 → 중단되어도 진행 보존
  - 영구 실패 페이지는 failed_pages.json에 기록만 하고 계속 진행
  - 재실행 시 fetch_state.json의 completed_pages 기반으로 done page skip
  - 영구 실패 페이지 일괄 재시도: retry_failed_pages.py

상태 파일:
  precedent_list.json       — 정규화된 누적 데이터 (insert 대상)
  fetch_state.json          — 완료 페이지 + 메타
  failed_pages.json         — 페이지별 실패 attempts + 마지막 오류
  precedent_list_raw_page1.json — 1페이지 raw 응답 (키 매핑 검증용)

정규화:
  - 선고일자: 'YYYY.MM.DD' → 'YYYYMMDD' (LawList 컨벤션 통일)
  - 빈 문자열 → None
  - 숫자 필드는 Integer 변환 (실패 시 None)
"""
import json
import time
import requests
from pathlib import Path
from datetime import datetime

# ---------- 설정 ----------
OC = "hyejin"  
BASE_URL = "http://www.law.go.kr/DRF/lawSearch.do"

OUTPUT_FILE     = Path("precedent_list.json")
STATE_FILE      = Path("fetch_state.json")
FAILED_FILE     = Path("failed_pages.json")
RAW_DEBUG_FILE  = Path("precedent_list_raw_page1.json")

PAGE_SIZE = 100
SLEEP_BETWEEN_PAGES = 0.4    # peer reset 자주 뜨면 0.5~1.0으로 올림
MAX_RETRIES = 5
RETRY_BACKOFF = 3            # attempt마다 곱해짐 → 3, 6, 9, 12초 대기
CHECKPOINT_EVERY = 20
REQUEST_TIMEOUT = 30

# 1차 검증 = 1, 전체 적재 = None
TEST_PAGE_LIMIT = None


# ---------- 유틸 ----------
def _strip(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return None


def _date_yyyymmdd(v):
    """선고일자 정규화: 'YYYY.MM.DD' / 'YYYY-MM-DD' / 'YYYYMMDD' → 'YYYYMMDD'.
    
    8자리 숫자로 떨어지지 않으면 None (이상값은 DB에 NULL로 두고 분석).
    LawList의 promulgate_date, enforce_date와 컨벤션 통일.
    """
    s = _strip(v)
    if s is None:
        return None
    cleaned = s.replace(".", "").replace("-", "").replace("/", "")
    if cleaned.isdigit() and len(cleaned) == 8:
        return cleaned
    return None


def _now():
    return datetime.now().isoformat(timespec="seconds")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"⚠️ {path} 파싱 실패, 기본값 사용: {e}")
        return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------- API ----------
def fetch_page(page: int) -> dict:
    params = {
        "OC": OC, "target": "prec", "type": "JSON",
        "display": PAGE_SIZE, "page": page,
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(BASE_URL, params=params, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            if attempt > 1:
                print(f"  ✓ page={page} attempt {attempt}에서 복구")
            return r.json()
        except (requests.RequestException, json.JSONDecodeError) as e:
            last_err = e
            print(f"  ⚠️ page={page} attempt {attempt}: {type(e).__name__} — {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF * attempt)
    raise RuntimeError(f"page={page} {MAX_RETRIES}회 실패: {last_err}")


def normalize_precedents(raw_response: dict) -> list[dict]:
    """API 응답 → DB 컬럼 형식으로 정규화.

    - law.go.kr JSON은 prec 노드가 단건이면 dict, 다건이면 list로 옴 → 통일.
    - 선고일자 'YYYY.MM.DD' → 'YYYYMMDD'.
    """
    root = raw_response.get("PrecSearch", {})
    prec = root.get("prec", [])
    if isinstance(prec, dict):
        items = [prec]
    elif isinstance(prec, list):
        items = prec
    else:
        items = []

    result = []
    for item in items:
        mapped = {
            "prec_serial":     _to_int(item.get("판례일련번호")),
            "case_name":       _strip(item.get("사건명")),
            "case_no":         _strip(item.get("사건번호")),
            "judgment_date":   _date_yyyymmdd(item.get("선고일자")),
            "court_name":      _strip(item.get("법원명")),
            "court_type_code": _to_int(item.get("법원종류코드")),
            "case_type_name":  _strip(item.get("사건종류명")),
            "case_type_code":  _to_int(item.get("사건종류코드")),
            "judgment_type":   _strip(item.get("판결유형")),
            "judgment_result": _strip(item.get("선고")),
            "data_source":     _strip(item.get("데이터출처명")),
            "detail_link":     _strip(item.get("판례상세링크")),
        }
        if mapped["prec_serial"] is None:
            continue
        result.append(mapped)
    return result


# ---------- 상태 ----------
def record_failure(page: int, err: Exception, failed: dict):
    entry = failed.get(str(page), {"page": page, "attempts": 0})
    entry["attempts"] += 1
    entry["last_error"] = f"{type(err).__name__}: {err}"
    entry["last_attempted"] = _now()
    failed[str(page)] = entry


def checkpoint(items, completed_pages, total_pages, failed):
    save_json(OUTPUT_FILE, items)
    save_json(STATE_FILE, {
        "completed_pages": sorted(completed_pages),
        "total_pages": total_pages,
        "items_count": len(items),
        "last_checkpoint": _now(),
    })
    save_json(FAILED_FILE, failed)


# ---------- main ----------
def main():
    items     = load_json(OUTPUT_FILE, [])
    state     = load_json(STATE_FILE, {})
    failed    = load_json(FAILED_FILE, {})
    completed = set(state.get("completed_pages", []))

    if items:
        print(f"♻️ 기존 진행분 발견: {len(items):,}건, 완료 페이지 {len(completed)}개, 실패 {len(failed)}개")

    print("첫 페이지 fetch...")
    first = fetch_page(1)
    save_json(RAW_DEBUG_FILE, first)

    root = first.get("PrecSearch", {})
    total = _to_int(root.get("totalCnt")) or 0
    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    print(f"전체 판례: {total:,}건 / 전체 페이지: {total_pages:,}")

    if 1 not in completed:
        items.extend(normalize_precedents(first))
        completed.add(1)

    if TEST_PAGE_LIMIT is not None:
        total_pages = min(total_pages, TEST_PAGE_LIMIT)
        print(f"⚠️ TEST_PAGE_LIMIT={TEST_PAGE_LIMIT}")

    pages_to_do = [p for p in range(2, total_pages + 1) if p not in completed]
    print(f"이번 회차 처리 대상: {len(pages_to_do)} 페이지\n")

    try:
        for i, page in enumerate(pages_to_do, 1):
            time.sleep(SLEEP_BETWEEN_PAGES)
            try:
                resp = fetch_page(page)
                items.extend(normalize_precedents(resp))
                completed.add(page)
                failed.pop(str(page), None)
            except RuntimeError as e:
                print(f"❌ page={page} 영구 실패, 기록 후 다음 페이지로")
                record_failure(page, e, failed)

            if i % CHECKPOINT_EVERY == 0:
                checkpoint(items, completed, total_pages, failed)
                print(f"  ✓ checkpoint @ page {page} (누적 {len(items):,}건, 실패 {len(failed)})")
    except KeyboardInterrupt:
        print("\n⚠️ 사용자 중단 (Ctrl+C) — checkpoint 저장 후 종료")

    checkpoint(items, completed, total_pages, failed)
    print(f"\n✅ 누적 {len(items):,}건 / 완료 페이지 {len(completed)} / 실패 페이지 {len(failed)}")
    if failed:
        print(f"   → 실패 재시도: python retry_failed_pages.py")


if __name__ == "__main__":
    main()