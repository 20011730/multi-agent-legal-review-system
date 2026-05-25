"""
fetch_precedent_list.py가 남긴 failed_pages.json을 기반으로
실패 페이지만 골라 재fetch. 성공하면 main JSON에 append, 실패 목록에서 제거.

여러 번 돌려도 무해 — 매번 실패 큐만 줄여나감.
누적 MAX_TOTAL_ATTEMPTS회를 넘은 페이지는 자동 skip하고 분석 대상으로 남김.
"""
import time

from fetch_precedent_list import (
    fetch_page, normalize_precedents, record_failure,
    load_json, save_json, _now,
    OUTPUT_FILE, STATE_FILE, FAILED_FILE,
    SLEEP_BETWEEN_PAGES,
)

MAX_TOTAL_ATTEMPTS = 10  # 이걸 넘으면 더 안 시도 — failed_pages.json 직접 보고 분석


def main():
    failed = load_json(FAILED_FILE, {})
    if not failed:
        print("✓ 재시도할 실패 페이지 없음.")
        return

    items     = load_json(OUTPUT_FILE, [])
    state     = load_json(STATE_FILE, {})
    completed = set(state.get("completed_pages", []))

    targets = sorted(int(p) for p, info in failed.items()
                     if info.get("attempts", 0) < MAX_TOTAL_ATTEMPTS)
    skipped = sorted(int(p) for p, info in failed.items()
                     if info.get("attempts", 0) >= MAX_TOTAL_ATTEMPTS)

    print(f"재시도 대상: {len(targets)} 페이지")
    if skipped:
        print(f"⚠️ {MAX_TOTAL_ATTEMPTS}회 초과로 자동 skip: {skipped}")
        print("   → failed_pages.json의 last_error 확인 권장")

    succ = 0
    for page in targets:
        time.sleep(SLEEP_BETWEEN_PAGES)
        try:
            resp = fetch_page(page)
            items.extend(normalize_precedents(resp))
            completed.add(page)
            failed.pop(str(page), None)
            succ += 1
            print(f"  ✓ page={page} 성공")
        except RuntimeError as e:
            record_failure(page, e, failed)
            print(f"  ✗ page={page} 또 실패 (누적 {failed[str(page)]['attempts']}회)")

    save_json(OUTPUT_FILE, items)
    save_json(STATE_FILE, {
        "completed_pages": sorted(completed),
        "total_pages": state.get("total_pages"),
        "items_count": len(items),
        "last_checkpoint": _now(),
    })
    save_json(FAILED_FILE, failed)

    print(f"\n결과 — 신규 성공 {succ} / 잔여 실패 {len(failed)}")
    if failed:
        print("→ 다시 retry_failed_pages.py 실행 가능, 또는 failed_pages.json 직접 분석")


if __name__ == "__main__":
    main()