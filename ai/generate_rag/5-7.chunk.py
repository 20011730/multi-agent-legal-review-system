import os
import re
import json
import psycopg2
from multiprocessing import Pool, cpu_count
from transformers import AutoTokenizer
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────────────────────
# 1. 환경 설정
# ─────────────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    'dbname': 'legalreview',
    'user': 'legalreview',
    'password': 'legalreview',
    'host': 'localhost',
    'port': '5432',
}

OUTPUT_DIR = "./tmp/jsonl_exports"
BATCH_SIZE = 1000  # 1개의 JSONL 파일에 담을 판례 건수

EMBEDDING_MODEL = "intfloat/multilingual-e5-base"
EMBEDDING_PREFIX = "passage: "
MAX_TOTAL_TOKENS = 500
SLIDING_WINDOW_OVERLAP_TOKENS = 50

LABEL_TITLE_MAX_CHARS = 30
LABEL_ONLY_BODY_MAX_CHARS = 20

# ─────────────────────────────────────────────────────────────────────────────
# 2. 토크나이저
# ─────────────────────────────────────────────────────────────────────────────
_tokenizer = None

def get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        # 워커 프로세스 내부에서만 로드되도록 함 (피클링 오류 방지)
        _tokenizer = AutoTokenizer.from_pretrained(EMBEDDING_MODEL)
    return _tokenizer

def count_tokens(text: str) -> int:
    tok = get_tokenizer()
    return len(tok.encode(f"{EMBEDDING_PREFIX}{text}", add_special_tokens=True))

def fits_in_budget(text: str) -> bool:
    return count_tokens(text) <= (MAX_TOTAL_TOKENS - 30) # 문맥 주입 마진 30

# ─────────────────────────────────────────────────────────────────────────────
# 3. 정규식 및 청킹 로직 (기존과 동일, 최적화 유지)
# ─────────────────────────────────────────────────────────────────────────────
HANGUL_MARKERS = "가나다라마바사아자차카타파하"
SECTION_HEADER_RE = re.compile(r'【\s*(.*?)\s*】')
HEADER_STRIP_RE = re.compile(r'【\s*.*?\s*】')

SPLIT_TIERS = [
    re.compile(r'(?=(?:\n|^)\s*\d+\.\s+)'),
    re.compile(r'(?=(?:\n|^)\s*\[[^\]]+\])'),
    re.compile(rf'(?=(?:\n|^)\s*[{HANGUL_MARKERS}]\.\s+)'),
    re.compile(r'(?=(?:\s|^)\(\d+\)\s)'),
    re.compile(r'(?=(?:\n|^)\s*\d+\)\s+)'),
    re.compile(rf'(?=(?:\s|^)\([{HANGUL_MARKERS}]\)\s)'),
    re.compile(rf'(?=(?:\n|^)\s*[{HANGUL_MARKERS}]\)\s+)'),
    re.compile(r'(?<=[다함임됨]\.)\s+(?=[가-힣\d\(\[\'\"])'),
]

MARKER_RE = re.compile(
    rf'^\s*(\d+\.|\[[^\]]+\]|[{HANGUL_MARKERS}]\.|\d+\)|\(\d+\)|[{HANGUL_MARKERS}]\)|\([{HANGUL_MARKERS}]\))'
)

def is_label_only(content: str) -> bool:
    stripped = HEADER_STRIP_RE.sub('', content).strip()
    if not stripped: return True
    m = MARKER_RE.match(stripped)
    if m:
        rest = stripped[m.end():].strip()
        if len(rest) < LABEL_ONLY_BODY_MAX_CHARS and not rest.endswith('다.'):
            return True
    return False

def extract_label(text: str):
    m = MARKER_RE.match(text)
    if not m: return None
    marker = m.group(1).strip()
    rest = text[m.end():].strip()
    if not rest: return marker
    first_line = rest.split('\n', 1)[0].strip()
    if len(first_line) > LABEL_TITLE_MAX_CHARS:
        truncated = first_line[:LABEL_TITLE_MAX_CHARS]
        last_space = truncated.rfind(' ')
        if last_space > 10: truncated = truncated[:last_space]
        return f"{marker} {truncated}…"
    return f"{marker} {first_line}"

def split_sections(rawcontent: str) -> list:
    sections = []
    if not rawcontent or not rawcontent.strip(): return sections
    parts = re.split(r'(?=【.*?】)', rawcontent)
    for part in parts:
        part = part.strip()
        if not part: continue
        m = SECTION_HEADER_RE.match(part)
        section_type = m.group(1).strip() if m else "기타"
        sections.append({"section_type": section_type, "content": part})
    return sections

def sliding_window_split(text: str) -> list:
    tok = get_tokenizer()
    content_token_ids = tok.encode(text, add_special_tokens=False)
    prefix_tokens = tok.encode(EMBEDDING_PREFIX, add_special_tokens=False)
    overhead = len(prefix_tokens) + 2 + 5
    window_size = (MAX_TOTAL_TOKENS - 30) - overhead
    stride = max(1, window_size - SLIDING_WINDOW_OVERLAP_TOKENS)

    chunks = []
    i = 0
    while i < len(content_token_ids):
        is_first = (i == 0)
        is_last = (i + window_size >= len(content_token_ids))
        window = content_token_ids[i:i + window_size]
        chunk_text = tok.decode(window, skip_special_tokens=True).strip()

        if not is_first:
            sp = chunk_text.find(' ')
            if 0 <= sp < 40: chunk_text = chunk_text[sp + 1:].lstrip()
        if not is_last:
            sp = chunk_text.rfind(' ')
            if sp > 0 and sp > len(chunk_text) - 40: chunk_text = chunk_text[:sp].rstrip()

        if chunk_text: chunks.append(chunk_text)
        if is_last: break
        i += stride
    return chunks

def recursive_split(text: str, tier: int = 0) -> list:
    text = text.strip()
    if not text: return []
    if fits_in_budget(text): return [text]
    if tier >= len(SPLIT_TIERS): return sliding_window_split(text)

    parts = SPLIT_TIERS[tier].split(text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) <= 1: return recursive_split(text, tier + 1)

    results = []
    for part in parts: results.extend(recursive_split(part, tier + 1))
    return results

# ─────────────────────────────────────────────────────────────────────────────
# 4. 워커(Worker) 프로세스 메인 함수
# ─────────────────────────────────────────────────────────────────────────────
def process_document(row):
    """DB에서 읽어온 행 하나(튜플)를 입력받아 청킹 후 딕셔너리로 반환"""
    # 컬럼 구조는 사용자 DB에 맞게 수정 (아래는 예시)
    doc_id, court, case_number, ref_statutes, ref_cases, rawcontent = row
    
    if not rawcontent or len(rawcontent) < 100:
        return None

    parents, children = [], []
    sections = split_sections(rawcontent)
    p_counter = 0

    for section in sections:
        section_content = section["content"]
        section_type = section["section_type"]

        if not HEADER_STRIP_RE.sub('', section_content).strip():
            continue

        parent_id = f"p_{p_counter:03d}"
        p_counter += 1
        
        # Parent는 원본 그대로 저장
        parents.append({
            "parent_id": parent_id,
            "section_type": section_type,
            "content": section_content,
        })

        sub_texts = recursive_split(section_content)
        c_idx = 0
        for sub_text in sub_texts:
            sub_text = sub_text.strip()
            if not sub_text or is_label_only(sub_text):
                continue
                
            subsection_label = extract_label(sub_text)
            
            # 맥락 주입 (중복 방지)
            context_enriched_text = f"[{section_type}]\n{sub_text}"

            children.append({
                "child_id": f"{parent_id}_c{c_idx:02d}",
                "parent_id": parent_id,
                "section_type": section_type,
                "subsection_label": subsection_label,
                "content": context_enriched_text,
                "char_length": len(context_enriched_text),
                "token_count": count_tokens(context_enriched_text),
            })
            c_idx += 1

    # 청크가 하나라도 생성된 경우만 반환
    if children:
        return {
            "meta": {
                "db_id": doc_id,
                "court": court,
                "case_number": case_number,
                "ref_statutes": ref_statutes, # 메타데이터로 참조 조문 추가
                "ref_cases": ref_cases,       # 메타데이터로 참조 판례 추가
            },
            "parents": parents,
            "children": children,
        }
    return None

# ─────────────────────────────────────────────────────────────────────────────
# 5. 파이프라인 컨트롤러 (스트리밍 읽기 + 멀티프로세싱 쓰기)
# ─────────────────────────────────────────────────────────────────────────────
def run_pipeline():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    num_cores = max(1, cpu_count() - 1) # 여유 코어 1개 남기기
    print(f"🚀 Mac CPU 코어 {num_cores}개를 사용하여 청킹 파이프라인을 시작합니다...")

    # DB 연결 (총 건수 확인용)
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # 쿼리: 참조 조문, 판례 컬럼 포함
    cur.execute("SELECT count(*) FROM case_documents WHERE rawcontent IS NOT NULL AND length(rawcontent) > 100")
    total_docs = cur.fetchone()[0]
    print(f"📊 총 처리 대상 문서: {total_docs:,}건")

    stream_cur = conn.cursor(name='fetch_large_dataset')
    stream_cur.itersize = BATCH_SIZE 
    
    query = """
        SELECT id, court, case_number, referenced_provisions, referenced_precedents, rawcontent
        FROM case_documents
        WHERE rawcontent IS NOT NULL AND length(rawcontent) > 100
    """
    
    stream_cur.execute(query)

    file_index = 1
    processed_count = 0

    # Pool 생성 
    with Pool(processes=num_cores) as pool:
        with tqdm(total=total_docs, desc="Chunking Progress") as pbar:
            while True:
                # BATCH_SIZE(1,000) 단위로 레코드 읽어오기
                rows = stream_cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                
                # 멀티프로세싱 매핑 (1,000건을 코어 수에 맞게 분배하여 병렬 처리)
                results = pool.map(process_document, rows)
                
                # 결과물 중 None이 아닌 것만 필터링
                valid_results = [res for res in results if res is not None]

                # JSONL 파일로 저장 (1줄에 1개의 JSON 객체)
                output_path = os.path.join(OUTPUT_DIR, f"chunked_batch_{file_index:04d}.jsonl")
                with open(output_path, 'w', encoding='utf-8') as f:
                    for item in valid_results:
                        f.write(json.dumps(item, ensure_ascii=False) + '\n')

                processed_count += len(rows)
                file_index += 1
                pbar.update(len(rows))

    stream_cur.close()
    cur.close()
    conn.close()

    print("=" * 80)
    print(f"🎉 모든 작업 완료! (총 {file_index-1}개의 JSONL 파일이 '{OUTPUT_DIR}'에 생성되었습니다.)")
    print("=" * 80)

if __name__ == "__main__":
    run_pipeline()