"""
국세법령정보시스템 조세 판례(심사결정례) Playwright 크롤러 (초고속 도약 버전)
- 영문 속성명(Key) 매핑 / 표 구조 보존 / Base64 데이터 정화
- 폴더 파티셔닝 / 진행 상태 저장 및 이어하기 기능
- 이미지, 폰트, CSS 리소스 로딩 원천 차단 (트래픽 최소화)
- 팝업창 렌더링 대기시간 최소화 (DOM 등장 즉시 파싱)
- [NEW] JS 엔진 침투를 통한 '초고속 순간이동(Fast-Forward Jump)' 알고리즘 적용
"""

import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeoutError

# ── 경로 상수 ──────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR   = PROJECT_ROOT / "data" / "raw_tax_precedents"
LOG_FILE     = PROJECT_ROOT / "data" / "tax_crawler.log"
PROGRESS_FILE= PROJECT_ROOT / "data" / "progress.json"  

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://taxlaw.nts.go.kr"
LIST_URL = "https://taxlaw.nts.go.kr/pd/USEPDI001M.do"

# ── 수집 설정 ─────────────────────────────────────────────────────────────────
MAX_PAGES         = 10000    
REQUEST_DELAY_SEC = 0.2      
PAGE_LOAD_TIMEOUT = 30_000
ELEMENT_TIMEOUT   = 15_000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── 진행 상태 (Resume) 관리 함수 ──────────────────────────────────────────────
def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"current_page": 1, "current_index": 0}

def save_progress(page: int, index: int) -> None:
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump({"current_page": page, "current_index": index}, f)

# ── 텍스트 정화 및 파싱 알고리즘 ────────────────────────────────────────────────
def _html_to_clean_text(html_str: str) -> str:
    soup = BeautifulSoup(html_str, "html.parser")
    for tag in soup.find_all(["script", "style", "noscript", "iframe", "img", "svg", "button"]):
        tag.decompose()
    for noise in soup.select(".left_wrap, .right_wrap, .similar_doc, .pdf_layer, .tip_box"):
        noise.decompose()
    for table in soup.find_all("table"):
        grid_text = "\n\n[표]\n"
        for row in table.find_all("tr"):
            cells = [cell.get_text(strip=True) for cell in row.find_all(["th", "td"])]
            grid_text += " | ".join(cells) + "\n"
        grid_text += "\n"
        table.replace_with(soup.new_string(grid_text))
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"data:image\/[^;]+;base64,[A-Za-z0-9+/=]+", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def parse_tax_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    metadata = {
        "doc_number": "", "tax_type": "", "decision_type": "",
        "reg_date": "", "prod_date": "", "attr_year": "",
        "status": "", "instance": "", "title": "",
        "keywords": [], "legal_references": [], "trial_progress": [],
        "reference_cases": [], "cited_cases": []
    }
    bo_head = soup.select_one(".bo_head")
    if bo_head:
        title_el = bo_head.select_one(".title strong.bold")
        if title_el: metadata["title"] = title_el.get_text(strip=True)
        doc_no_el = bo_head.select_one("strong:not(.bold)")
        if doc_no_el: metadata["doc_number"] = doc_no_el.get_text(strip=True)
        badge_el = bo_head.select_one(".com_badge")
        if badge_el: metadata["decision_type"] = badge_el.get_text(strip=True)
        tax_badge = bo_head.select_one(".legislation_list li")
        if tax_badge: metadata["tax_type"] = tax_badge.get_text(strip=True)

        for item in bo_head.select("strong"):
            label = item.get_text(strip=True).replace(":", "")
            value_el = item.find_next_sibling("span")
            if value_el:
                val = value_el.get_text(strip=True)
                if "귀속년도" in label: metadata["attr_year"] = val
                elif "심급" in label: metadata["instance"] = val
                elif "등록일자" in label: metadata["reg_date"] = val
                elif "생산일자" in label: metadata["prod_date"] = val
                elif "진행상태" in label: metadata["status"] = val

    bo_word = soup.select_one(".bo_word")
    if bo_word:
        for group in bo_word.select(".rel_group"):
            label = group.select_one("span")
            value = group.select_one("div")
            if label and value:
                lbl_txt = label.get_text()
                if "주제어" in lbl_txt: metadata["keywords"] = [v.strip() for v in value.get_text().split(",") if v.strip()]
                elif "법령" in lbl_txt: metadata["legal_references"] = [v.strip() for v in value.get_text().split(",") if v.strip()]

    for trial in soup.select(".left_item_title.cour_trial + .left_item_cont a"): metadata["trial_progress"].append(trial.get_text(strip=True))
    for ref in soup.select(".left_item_title.ref_case + .left_item_cont a"): metadata["reference_cases"].append(ref.get_text(strip=True))
    for cite in soup.select(".left_item_title.cite_case + .left_item_cont a"): metadata["cited_cases"].append(cite.get_text(strip=True))

    content_parts = []
    summary_el = soup.select_one(".word_group:has(h4:-soup-contains('요지')) p")
    if summary_el: content_parts.append("[요지]\n" + summary_el.get_text(strip=True))
    detail_el = soup.select_one(".dcm_cntn")
    if detail_el: content_parts.append("[상세내용]\n" + _html_to_clean_text(str(detail_el)))
    
    return {"metadata": metadata, "page_content": "\n\n".join(content_parts).strip()}

# ── 브라우저 리소스 차단 라우팅 ───────────────────────────────────────────────
def block_heavy_resources(route):
    if route.request.resource_type in ["image", "stylesheet", "font", "media"]:
        route.abort()
    else:
        route.continue_()

# ── Playwright 크롤링 실행부 ──────────────────────────────────────────────────
def run() -> None:
    progress = load_progress()
    start_idx = progress.get("current_index", 0)
    
    log.info(f"=== 국세법령정보시스템 크롤러 시작 (이전 상태: {start_idx}번째부터 이어서 수집) ===")
    
    # [핵심] 파이썬을 거치지 않고 JS 엔진 내부에서 초고속으로 리스트를 확장하는 스크립트
    # 국세청 방화벽 차단을 피하기 위해 0.1초(100ms) 간격으로 타격
    def get_jump_script(target_idx):
        return f"""
            () => new Promise((resolve) => {{
                let target = {target_idx};
                let timer = setInterval(() => {{
                    let items = document.querySelectorAll('#bdltCtl > li').length;
                    let btn = document.querySelector('a#listMore');
                    
                    if (items >= target || !btn || btn.offsetParent === null) {{
                        clearInterval(timer);
                        resolve(items);
                    }} else {{
                        btn.click();
                    }}
                }}, 100); 
            }})
        """

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True) 
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        context.route("**/*", block_heavy_resources) 
        page = context.new_page()

        try:
            page.goto(LIST_URL, wait_until="networkidle", timeout=PAGE_LOAD_TIMEOUT)
            page.wait_for_selector("#bdltCtl > li", timeout=ELEMENT_TIMEOUT)
            
            # [안정화 1] 초기 시작 시 초고속 순간이동 (Fast-Forward Jump)
            if start_idx > 50:
                log.info(f"🚀 {start_idx}번째 위치로 브라우저 내부에서 초고속 순간이동(Jump)을 시작합니다!")
                loaded_items = page.evaluate(get_jump_script(start_idx))
                page.wait_for_load_state("networkidle", timeout=PAGE_LOAD_TIMEOUT)
                log.info(f"🎯 순간이동 완료! (현재 {loaded_items}건 로드됨)")

            current_idx = start_idx
            
            while True:
                row_count = page.locator("#bdltCtl > li").count()
                
                if current_idx >= row_count:
                    more_btn = page.locator("a#listMore")
                    if more_btn.is_visible():
                        log.info(f"\n--- [ {row_count}건 도달, '더보기' 버튼 클릭하여 목록 확장 ] ---")
                        more_btn.click()
                        try:
                            page.wait_for_function(f"document.querySelectorAll('#bdltCtl > li').length > {row_count}", timeout=ELEMENT_TIMEOUT)
                            log.info("새 목록 로딩 완료. 자바스크립트 이벤트 바인딩 대기 중 (2.5초)...")
                            time.sleep(2.5) 
                            continue
                        except PlaywrightTimeoutError:
                            log.warning("목록 갱신 실패. 마지막 문서입니다.")
                            break
                    else:
                        log.info("모든 데이터 수집 완료.")
                        break

                row = page.locator("#bdltCtl > li").nth(current_idx)
                row.scroll_into_view_if_needed()
                target_a = row.locator("a.subs_title").first
                
                popup = None
                ntst_dcm_id = f"unknown_{current_idx}"
                try:
                    with page.expect_popup(timeout=PAGE_LOAD_TIMEOUT) as popup_info:
                        target_a.click(force=True)
                    
                    popup = popup_info.value
                    
                    try:
                        popup.wait_for_selector(".dcm_cntn", state="attached", timeout=ELEMENT_TIMEOUT)
                    except PlaywrightTimeoutError:
                        log.warning(f"[{current_idx+1}번째] 본문 로딩 지연. 파싱을 시도합니다.")
                    
                    parsed_url = urlparse(popup.url)
                    qs = parse_qs(parsed_url.query)
                    if "ntstDcmId" in qs:
                        ntst_dcm_id = qs.get("ntstDcmId")[0]
                    
                    html = popup.content()
                    result = parse_tax_detail(html)
                    
                    if not result["metadata"]["doc_number"]:
                        result["metadata"]["doc_number"] = ntst_dcm_id
                        
                    doc_no = result["metadata"]["doc_number"]
                    safe_name = re.sub(r"[^\w가-힣-]", "_", doc_no)
                    
                    reg_date = result["metadata"].get("reg_date", "")
                    year = reg_date.split(".")[0] if reg_date else "Unknown_Year"
                    if not year.isdigit(): year = "Unknown_Year"
                    
                    tax_type = result["metadata"].get("tax_type", "") or "Unknown_Tax"
                    tax_type = re.sub(r"[^\w가-힣-]", "_", tax_type)
                    
                    partition_dir = OUTPUT_DIR / year / tax_type
                    partition_dir.mkdir(parents=True, exist_ok=True)
                    out_path = partition_dir / f"{safe_name}.json"
                    
                    if not out_path.exists():
                        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                        log.info(f"[{current_idx+1}번째] 저장 완료: {year}/{tax_type}/{out_path.name}")
                    else:
                        log.info(f"[{current_idx+1}번째] 이미 수집됨: {out_path.name}")
                    
                    current_idx += 1
                    save_progress(1, current_idx)

                except Exception as e:
                    log.warning(f"[{current_idx+1}번째] 처리 중 오류 발생 (ntstDcmId={ntst_dcm_id}): {e}")
                    current_idx += 1 
                    save_progress(1, current_idx)
                if popup and not popup.is_closed():
                     popup.close()
                time.sleep(REQUEST_DELAY_SEC)

                # [안정화 3] 50건 수집할 때마다 크롬 메모리 리프레시 및 초고속 복구
                if current_idx > start_idx and current_idx % 50 == 0:
                    log.info(f"--- [안전장치] 메모리 97% 돌파 예방을 위해 브라우저 세션을 재시작합니다. (현재 {current_idx}번째) ---")
                    context.close()  
                    context = browser.new_context(viewport={"width": 1280, "height": 900})
                    context.route("**/*", block_heavy_resources)
                    page = context.new_page()
                    
                    page.goto(LIST_URL, wait_until="networkidle", timeout=PAGE_LOAD_TIMEOUT)
                    page.wait_for_selector("#bdltCtl > li", timeout=ELEMENT_TIMEOUT)
                    
                    log.info(f"🚀 {current_idx}번째 위치로 초고속 순간이동을 진행합니다.")
                    loaded_items = page.evaluate(get_jump_script(current_idx))
                    page.wait_for_load_state("networkidle", timeout=PAGE_LOAD_TIMEOUT)
                    time.sleep(2.0) # 복구 완료 후 마지막 바인딩 대기

        except Exception as e:
            log.error("크롤러 오류 발생. 다음 실행 시 저장된 위치부터 이어합니다.", exc_info=True)
        finally:
            context.close()
            browser.close()

if __name__ == "__main__":
    run()
