"""
전체 판례 API Fetch -> 인메모리 파싱 -> 1,000건 단위 JSON 청크 저장
실행: python fetch_and_parse_batch.py
"""
import xml.etree.ElementTree as ET
import re
import html
import json
import logging
import time
from pathlib import Path
from datetime import datetime
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import requests
from psycopg2.extras import RealDictCursor

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost',
    'port': '5432',
}

LAW_API_OC = 'hyejin'
LAW_API_BASE = "https://www.law.go.kr"
OUTPUT_DIR = "./tmp/parsed_chunks"  # 저장 경로 변경됨

CHUNK_SIZE = 1000    # 파일 1개당 들어갈 판례 수
MAX_WORKERS = 5      # 동시 API 호출 스레드 수 (공공 API 보호를 위해 5~8 권장)
MAX_RETRIES = 3      # API 호출 실패 시 재시도 횟수

EXCLUDE_DATA_SOURCES = ("국세법령정보시스템", "지방세법령정보시스템")
EXCLUDE_KEYWORDS = [
    "이혼", "친권", "양육비", "혼인", "유언", "유류분", "친자",
    "강간", "강제추행", "성폭력", "성매매", "음주운전", "뺑소니",
    "마약", "향정신성", "도박", "절도", "강도", "폭행", "상해", "협박",
    "병역", "군무이탈", "현역", "출입국", "체류자격", "난민",
    "운전면허 취소", "운전면허취소", "의료사고", "의료과오", "국민연금", "기초생활수급"
]
EXCLUDE_KEYWORD_PATTERN = "|".join(EXCLUDE_KEYWORDS)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | %(message)s",
)
log = logging.getLogger("precedent-batch")

# ─────────────────────────────────────────────────────────────────────────────
# 1. DB 연동 및 대상 조회
# ─────────────────────────────────────────────────────────────────────────────
@contextmanager
def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        yield conn
    finally:
        conn.close()

def get_all_targets() -> list[int]:
    log.info("DB에서 필터링된 전체 판례 일련번호를 조회합니다...")
    sql = """
    SELECT prec_serial
    FROM precedent_list p
    WHERE (p.data_source IS NULL OR p.data_source NOT IN %(exclude_source)s)
      AND (p.case_name   IS NULL OR p.case_name   !~ %(keyword_pattern)s)
    ORDER BY judgment_date DESC NULLS LAST
    """
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, {
            "exclude_source": EXCLUDE_DATA_SOURCES,
            "keyword_pattern": EXCLUDE_KEYWORD_PATTERN,
        })
        rows = [row["prec_serial"] for row in cur.fetchall()]
        log.info("조회 완료: 총 %d건", len(rows))
        return rows

# ─────────────────────────────────────────────────────────────────────────────
# 2. 인메모리 파싱 (이전 단계 코드 동일)
# ─────────────────────────────────────────────────────────────────────────────
def clean_text(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = html.unescape(text)
    return text.strip()

def parse_xml_to_dict(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    reference_id = root.findtext("판례정보일련번호", default="").strip()
    
    def get_text(tag: str) -> str:
        val = root.findtext(tag, default="").strip()
        return "" if val.lower() == "null" else val

    judgment_date = get_text("선고일자")
    if judgment_date == "00010101":
        judgment_date = ""

    return {
        "referenceId": reference_id,
        "title": get_text("사건명"),
        "caseNumber": get_text("사건번호"),
        "judgmentDate": judgment_date,
        "judgment": get_text("선고"),
        "court": get_text("법원명"),
        "caseType": get_text("사건종류명"),
        "url": f"https://www.law.go.kr/precInfoP.do?precSeq={reference_id}",
        "prectype": get_text("판결유형"),
        "issues": clean_text(root.findtext("판시사항")),
        "summary": clean_text(root.findtext("판결요지")),
        "referencedProvisions": clean_text(root.findtext("참조조문")),
        "referencedPrecedents": clean_text(root.findtext("참조판례")),
        "rawcontent": clean_text(root.findtext("판례내용")),
        "chunked": False,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": None
    }

# ─────────────────────────────────────────────────────────────────────────────
# 3. API 호출 및 파싱 (스레드 단위 작업)
# ─────────────────────────────────────────────────────────────────────────────
def fetch_and_parse(prec_serial: int) -> dict | None:
    url = f"{LAW_API_BASE}/DRF/lawService.do"
    params = {"OC": LAW_API_OC, "target": "prec", "ID": prec_serial, "type": "XML"}
    
    # 안정성을 위한 재시도(Retry) 로직
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=10.0)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            
            # 파싱 성공 시 dict 반환
            return parse_xml_to_dict(resp.text)
            
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                log.error("실패 (최대 재시도 초과) | prec_serial=%s | err=%s", prec_serial, str(e))
                return None
            time.sleep(1.0) # 실패 시 1초 대기 후 재시도

# ─────────────────────────────────────────────────────────────────────────────
# 4. 청크 단위 배치 실행
# ─────────────────────────────────────────────────────────────────────────────
def run_batch():
    out_dir = Path(OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = get_all_targets()
    total_count = len(targets)
    
    # 데이터를 CHUNK_SIZE 단위로 나누기
    chunks = [targets[i:i + CHUNK_SIZE] for i in range(0, total_count, CHUNK_SIZE)]
    total_chunks = len(chunks)

    log.info("=" * 70)
    log.info("총 %d개의 청크(%d건/청크) 처리를 시작합니다. (멀티스레딩: %d)", total_chunks, CHUNK_SIZE, MAX_WORKERS)
    log.info("=" * 70)

    for chunk_idx, chunk_ids in enumerate(chunks, start=1):
        # 파일명 패딩 처리 (예: chunk_001.json)
        chunk_file = out_dir / f"chunk_{chunk_idx:03d}.json"
        
        # [핵심] 이어받기: 청크 파일이 이미 존재하면 통째로 스킵
        if chunk_file.exists():
            log.info("[청크 %3d/%3d] 파일 존재함 - 스킵 완료", chunk_idx, total_chunks)
            continue

        log.info("[청크 %3d/%3d] %d건 API 호출 및 파싱 시작...", chunk_idx, total_chunks, len(chunk_ids))
        
        parsed_results = []
        
        # 멀티스레딩으로 API 호출
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # futures 딕셔너리로 매핑
            future_to_id = {executor.submit(fetch_and_parse, pid): pid for pid in chunk_ids}
            
            for future in as_completed(future_to_id):
                result = future.result()
                if result:
                    parsed_results.append(result)
        
        # 청크 단위로 파일 쓰기
        if parsed_results:
            with chunk_file.open("w", encoding="utf-8") as f:
                json.dump(parsed_results, f, ensure_ascii=False, indent=2)
            
            log.info("[청크 %3d/%3d] 성공! %d건 저장 완료 -> %s", 
                     chunk_idx, total_chunks, len(parsed_results), chunk_file.name)
        else:
            log.warning("[청크 %3d/%3d] 유효한 데이터가 없어 저장하지 않습니다.", chunk_idx, total_chunks)

        # 공공데이터 API 서버에 약간의 휴식을 줌
        time.sleep(1.0)

    log.info("=" * 70)
    log.info("모든 배치 작업이 성공적으로 종료되었습니다!")
    log.info("결과물 디렉토리: %s", out_dir.resolve())

if __name__ == "__main__":
    run_batch()