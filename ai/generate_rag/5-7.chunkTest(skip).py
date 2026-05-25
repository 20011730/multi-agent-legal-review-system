import os
import re
import json
import psycopg2
from transformers import AutoTokenizer

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

OUTPUT_DIR = "./tmp/chunked_outputs"

EMBEDDING_MODEL = "intfloat/multilingual-e5-base"
EMBEDDING_PREFIX = "passage: "
MAX_TOTAL_TOKENS = 500
SLIDING_WINDOW_OVERLAP_TOKENS = 50

LABEL_TITLE_MAX_CHARS = 30        # subsection_label 출력 최대 자수
LABEL_ONLY_BODY_MAX_CHARS = 20    # 본문이 이보다 짧고 종결도 아니면 라벨-온리로 필터


# ─────────────────────────────────────────────────────────────────────────────
# 토크나이저
# ─────────────────────────────────────────────────────────────────────────────
_tokenizer = None

def get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        print(f"📥 토크나이저 로딩: {EMBEDDING_MODEL}")
        _tokenizer = AutoTokenizer.from_pretrained(EMBEDDING_MODEL)
    return _tokenizer


def count_tokens(text: str) -> int:
    tok = get_tokenizer()
    return len(tok.encode(f"{EMBEDDING_PREFIX}{text}", add_special_tokens=True))


# [수정 사항 1] 문맥 주입([섹션타입])으로 인해 늘어날 토큰을 감안하여 안전 마진(30토큰)을 부여합니다.
def fits_in_budget(text: str) -> bool:
    return count_tokens(text) <= (MAX_TOTAL_TOKENS - 30)


# ─────────────────────────────────────────────────────────────────────────────
# 정규식
# ─────────────────────────────────────────────────────────────────────────────

# 한국 법률 문서 한글 목차 (천간 10 + 4)
HANGUL_MARKERS = "가나다라마바사아자차카타파하"

SECTION_HEADER_RE = re.compile(r'【\s*(.*?)\s*】')
HEADER_STRIP_RE = re.compile(r'【\s*.*?\s*】')

# 재귀 분할 계층 (위에서 아래로 갈수록 세분화)
SPLIT_TIERS = [
    # T0: "1. " "2. "  (줄머리)
    re.compile(r'(?=(?:\n|^)\s*\d+\.\s+)'),
    # T1: "[인정근거]" (줄머리)
    re.compile(r'(?=(?:\n|^)\s*\[[^\]]+\])'),
    # T2: "가. " "나. "  (줄머리)
    re.compile(rf'(?=(?:\n|^)\s*[{HANGUL_MARKERS}]\.\s+)'),
    # T3: "(1)" "(2)"  (줄 중간도 OK)
    re.compile(r'(?=(?:\s|^)\(\d+\)\s)'),
    # T4: "1)" "2)"  (줄머리)
    re.compile(r'(?=(?:\n|^)\s*\d+\)\s+)'),
    # T5: "(가)" "(나)"  (줄 중간도 OK)
    re.compile(rf'(?=(?:\s|^)\([{HANGUL_MARKERS}]\)\s)'),
    # T6: "가)" "나)"  (줄머리)
    re.compile(rf'(?=(?:\n|^)\s*[{HANGUL_MARKERS}]\)\s+)'),
    # T7: 한국어 문장 종결 "다.", "함.", "임.", "됨." 직후 (최후 마커)
    re.compile(r'(?<=[다함임됨]\.)\s+(?=[가-힣\d\(\[\'\"])'),
]

# 청크 선두 마커 (제목 미포함)
MARKER_RE = re.compile(
    rf'^\s*('
    rf'\d+\.|'
    rf'\[[^\]]+\]|'
    rf'[{HANGUL_MARKERS}]\.|'
    rf'\d+\)|'
    rf'\(\d+\)|'
    rf'[{HANGUL_MARKERS}]\)|'
    rf'\([{HANGUL_MARKERS}]\)'
    rf')'
)


# ─────────────────────────────────────────────────────────────────────────────
# 보조 함수
# ─────────────────────────────────────────────────────────────────────────────

def is_label_only(content: str) -> bool:
    """청크가 헤더(【…】) 또는 단순 라벨(번호+짧은 제목)뿐이면 True."""
    stripped = HEADER_STRIP_RE.sub('', content).strip()
    if not stripped:
        return True
    m = MARKER_RE.match(stripped)
    if m:
        rest = stripped[m.end():].strip()
        # 본문이 짧고 한국어 문장 종결("다.")로 끝나지도 않으면 라벨로 간주
        if len(rest) < LABEL_ONLY_BODY_MAX_CHARS and not rest.endswith('다.'):
            return True
    return False


def extract_label(text: str):
    """선두 마커 + 짧은 제목(최대 30자, 어절 경계 정렬)."""
    m = MARKER_RE.match(text)
    if not m:
        return None
    marker = m.group(1).strip()
    rest = text[m.end():].strip()
    if not rest:
        return marker
    # 첫 줄만 추출
    first_line = rest.split('\n', 1)[0].strip()
    if len(first_line) > LABEL_TITLE_MAX_CHARS:
        truncated = first_line[:LABEL_TITLE_MAX_CHARS]
        # 어절 경계 정렬: 마지막 공백 위치로 트림
        last_space = truncated.rfind(' ')
        if last_space > 10:
            truncated = truncated[:last_space]
        return f"{marker} {truncated}…"
    return f"{marker} {first_line}"


# ─────────────────────────────────────────────────────────────────────────────
# 분할 로직
# ─────────────────────────────────────────────────────────────────────────────

def split_sections(rawcontent: str) -> list:
    """【…】 헤더로 1차 분할 → parent 후보."""
    sections = []
    if not rawcontent or not rawcontent.strip():
        return sections
    parts = re.split(r'(?=【.*?】)', rawcontent)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = SECTION_HEADER_RE.match(part)
        section_type = m.group(1).strip() if m else "기타"
        sections.append({"section_type": section_type, "content": part})
    return sections


def sliding_window_split(text: str) -> list:
    """
    토큰 단위 슬라이딩 윈도우 + 어절 경계 정렬.
    모든 마커 tier가 실패했을 때만 호출되는 최후 fallback.
    """
    tok = get_tokenizer()
    content_token_ids = tok.encode(text, add_special_tokens=False)

    prefix_tokens = tok.encode(EMBEDDING_PREFIX, add_special_tokens=False)
    overhead = len(prefix_tokens) + 2 + 5   # passage: + [CLS][SEP] + 안전 마진
    window_size = MAX_TOTAL_TOKENS - overhead
    stride = max(1, window_size - SLIDING_WINDOW_OVERLAP_TOKENS)

    chunks = []
    i = 0
    while i < len(content_token_ids):
        is_first = (i == 0)
        is_last = (i + window_size >= len(content_token_ids))

        window = content_token_ids[i:i + window_size]
        chunk_text = tok.decode(window, skip_special_tokens=True).strip()

        # 어절 경계 정렬: 부분 단어 잘라냄 (오버랩이 손실분 보전)
        if not is_first:
            sp = chunk_text.find(' ')
            if 0 <= sp < 40:
                chunk_text = chunk_text[sp + 1:].lstrip()
        if not is_last:
            sp = chunk_text.rfind(' ')
            if sp > 0 and sp > len(chunk_text) - 40:
                chunk_text = chunk_text[:sp].rstrip()

        if chunk_text:
            chunks.append(chunk_text)
        if is_last:
            break
        i += stride
    return chunks


def recursive_split(text: str, tier: int = 0) -> list:
    """토큰 예산 안에 들어올 때까지 재귀적으로 분할."""
    text = text.strip()
    if not text:
        return []
    if fits_in_budget(text):
        return [text]
    if tier >= len(SPLIT_TIERS):
        return sliding_window_split(text)

    parts = SPLIT_TIERS[tier].split(text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) <= 1:
        return recursive_split(text, tier + 1)

    results = []
    for part in parts:
        results.extend(recursive_split(part, tier + 1))
    return results


def build_parent_child_chunks(rawcontent: str) -> tuple:
    """
    parent-child 청크 생성.
      - parents:  【…】 섹션 단위. (LLM 컨텍스트 확장용)
      - children: 토큰 예산을 만족하는 최소 의미 단위. (임베딩/검색용)
    """
    parents, children = [], []
    sections = split_sections(rawcontent)

    p_counter = 0
    for section in sections:
        section_content = section["content"]
        section_type = section["section_type"]

        # parent는 "헤더+공백만 있는 경우"만 제외 (라벨-온리는 컨텍스트로 유용하니 유지)
        if not HEADER_STRIP_RE.sub('', section_content).strip():
            continue

        parent_id = f"p_{p_counter:03d}"
        p_counter += 1
        parents.append({
            "parent_id": parent_id,
            "section_type": section_type,
            "content": section_content,
            "char_length": len(section_content),
            "token_count": count_tokens(section_content),
        })

        sub_texts = recursive_split(section_content)

        c_idx = 0
        for sub_text in sub_texts:
            sub_text = sub_text.strip()
            if not sub_text:
                continue
            # children은 라벨-온리 청크도 제거 (검색 노이즈 방지)
            if is_label_only(sub_text):
                continue
                
            # 메타데이터용 추출
            subsection_label = extract_label(sub_text)
            
            # [수정 사항 2] 문맥 주입 시 소제목 중복 노이즈 제거
            # sub_text 원본에 이미 소제목 정보가 첫 줄에 포함되어 있으므로, 
            # 앞에 대분류 꺾쇠 태그 정보만 명시하여 중복 현상을 방지하고 깔끔한 문맥을 완성합니다.
            context_enriched_text = f"[{section_type}]\n{sub_text}"

            children.append({
                "child_id": f"{parent_id}_c{c_idx:02d}",
                "parent_id": parent_id,
                "section_type": section_type,
                "subsection_label": subsection_label,
                "content": context_enriched_text,                           # 문맥 결합 텍스트 사용
                "char_length": len(context_enriched_text),                  # 새로운 텍스트 기준 글자 수 계산
                "token_count": count_tokens(context_enriched_text),         # 새로운 텍스트 기준 최종 토큰 수 계산
            })
            c_idx += 1

    return parents, children


# ─────────────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────────────

def save_chunks_to_files():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    get_tokenizer()

    print("=" * 80)
    print("1. DB에서 법원별 판례 15건을 추출합니다...")
    print("=" * 80)

    query = """
        SELECT id, court, case_number, rawcontent
        FROM (
            SELECT id, court, case_number, rawcontent,
                   ROW_NUMBER() OVER(PARTITION BY court ORDER BY random()) as rn
            FROM case_documents
            WHERE rawcontent IS NOT NULL AND length(rawcontent) > 100
        ) sub
        WHERE rn = 1
        LIMIT 15;
    """

    try:
        with psycopg2.connect(**DB_CONFIG) as conn:
            with conn.cursor() as cur:
                cur.execute(query)
                rows = cur.fetchall()
                if not rows:
                    print("❌ 테스트할 데이터가 DB에 없습니다.")
                    return

                print(f"2. 청킹 및 파일 저장 시작 (저장 경로: {OUTPUT_DIR})")
                print("-" * 80)

                for idx, (doc_id, court, case_number, rawcontent) in enumerate(rows, start=1):
                    parents, children = build_parent_child_chunks(rawcontent)

                    if children:
                        toks = [c["token_count"] for c in children]
                        max_tok = max(toks)
                        avg_tok = sum(toks) / len(toks)
                        over = sum(1 for t in toks if t > MAX_TOTAL_TOKENS)
                    else:
                        max_tok = avg_tok = over = 0

                    output_data = {
                        "meta": {
                            "db_id": doc_id,
                            "court": court,
                            "case_number": case_number,
                            "embedding_model": EMBEDDING_MODEL,
                            "max_token_budget": MAX_TOTAL_TOKENS,
                            "total_parents": len(parents),
                            "total_children": len(children),
                            "child_token_max": max_tok,
                            "child_token_avg": round(avg_tok, 1),
                            "child_over_budget_count": over,
                        },
                        "parents": parents,
                        "children": children,
                    }

                    safe_case_num = re.sub(r'[^a-zA-Z0-9가-힣]', '_', case_number)
                    file_path = os.path.join(
                        OUTPUT_DIR, f"chunked_{doc_id}_{safe_case_num}.json"
                    )
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(output_data, f, ensure_ascii=False, indent=2)

                    flag = " ⚠️" if over else ""
                    print(f"▶ [{idx:02d}] {court} ({case_number}) "
                          f"-> P {len(parents)} / C {len(children)} "
                          f"(max={max_tok}tok, avg={avg_tok:.0f}tok){flag}")

                print("=" * 80)
                print(f"🎉 {len(rows)}건 저장 완료 → '{OUTPUT_DIR}'")
                print("=" * 80)

    except Exception as e:
        import traceback
        print(f"❌ 오류 발생: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    save_chunks_to_files()