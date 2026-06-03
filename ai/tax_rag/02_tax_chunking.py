"""
국세청 조세 판례 맞춤형 Parent-Child 청킹 파이프라인
- 로컬 JSON 파일 기반 대용량 스트리밍 처리 (OOM 방지)
- 7단계 정규식 기반 법률 문서 계층적 분할
- [요지], [상세내용], [표] 마크다운 헤더 자동 인식 및 파티셔닝
"""

import os
import re
import json
from pathlib import Path
from multiprocessing import Pool, cpu_count
from transformers import AutoTokenizer
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────────────────────
# 환경 설정
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data" / "raw_tax_precedents" # 대장 크롤링 데이터 폴더
OUTPUT_DIR = PROJECT_ROOT / "data" / "chunked_precedents"

BATCH_SIZE = 1000

EMBEDDING_MODEL = "intfloat/multilingual-e5-base" 
EMBEDDING_PREFIX = "passage: "
MAX_TOTAL_TOKENS = 500
SLIDING_WINDOW_OVERLAP_TOKENS = 50

LABEL_TITLE_MAX_CHARS = 30
LABEL_ONLY_BODY_MAX_CHARS = 20

# ─────────────────────────────────────────────────────────────────────────────
# 토크나이저 (예산 계산용)
# ─────────────────────────────────────────────────────────────────────────────
_tokenizer = None

def get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = AutoTokenizer.from_pretrained(EMBEDDING_MODEL)
    return _tokenizer

def count_tokens(text: str) -> int:
    return len(get_tokenizer().encode(f"{EMBEDDING_PREFIX}{text}", add_special_tokens=True))

def fits_in_budget(text: str) -> bool:
    return count_tokens(text) <= (MAX_TOTAL_TOKENS - 30)

# ─────────────────────────────────────────────────────────────────────────────
# 정규식 (대장의 마크다운 포맷 적용)
# ─────────────────────────────────────────────────────────────────────────────
HANGUL_MARKERS = "가나다라마바사아자차카타파하"

# 대장의 크롤링 데이터 폼에 맞춘 [ ] 대괄호 인식
SECTION_HEADER_RE = re.compile(r'\[\s*(.*?)\s*\]')
HEADER_STRIP_RE = re.compile(r'\[\s*.*?\s*\]')

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
    parts = re.split(r'(?=(?:^|\n)\[.*?\])', rawcontent)
    for part in parts:
        part = part.strip()
        if not part: continue
        m = SECTION_HEADER_RE.match(part)
        section_type = m.group(1).strip() if m else "기타(본문)"
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
# 워커 (로컬 JSON 매핑)
# ─────────────────────────────────────────────────────────────────────────────
def process_document(file_path: Path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return None

    rawcontent = data.get("page_content", "")
    if not rawcontent or len(rawcontent) < 50:
        return None

    meta = data.get("metadata", {})
    doc_id = meta.get("doc_number", file_path.stem)

    parents, children = [], []
    sections = split_sections(rawcontent)
    p_counter = 0

    for section in sections:
        section_content = section["content"]
        section_type = section["section_type"]

        if not HEADER_STRIP_RE.sub('', section_content).strip():
            continue

        parent_id = f"{doc_id}_p{p_counter:03d}"
        p_counter += 1
        
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
            
            # 자식 조각에 부모 문맥(헤더) 주입
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

    if children:
        return {
            "meta": meta, 
            "parents": parents,
            "children": children,
        }
    return None

# ─────────────────────────────────────────────────────────────────────────────
# 메인 파이프라인 제어 (멀티프로세싱)
# ─────────────────────────────────────────────────────────────────────────────
def run_pipeline():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    num_cores = max(1, cpu_count() - 1)
    print(f"🚀 CPU 코어 {num_cores}개를 사용해 초고속 파이프라인 가동...")

    if not DATA_DIR.exists():
        print(f"❌ 경로 오류: {DATA_DIR} 폴더를 찾을 수 없음.")
        return

    json_files = list(DATA_DIR.rglob("*.json"))
    total_docs = len(json_files)
    print(f"📊 총 {total_docs:,}건의 판례 청킹 시작...")

    if total_docs == 0: return

    batches = [json_files[i:i + BATCH_SIZE] for i in range(0, total_docs, BATCH_SIZE)]
    file_index = 1

    with Pool(processes=num_cores) as pool:
        with tqdm(total=total_docs, desc="Chunking Progress") as pbar:
            for batch in batches:
                results = pool.map(process_document, batch)
                valid_results = [res for res in results if res is not None]

                output_path = OUTPUT_DIR / f"tax_chunk_batch_{file_index:04d}.jsonl"
                with open(output_path, 'w', encoding='utf-8') as f:
                    for item in valid_results:
                        f.write(json.dumps(item, ensure_ascii=False) + '\n')

                file_index += 1
                pbar.update(len(batch))

    print(f"\n🎉 작업 완료! {OUTPUT_DIR} 에 JSONL 파티션 저장 끝.")

if __name__ == "__main__":
    run_pipeline()
