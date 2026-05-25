"""
=============================================================================
Stage 1: 도메인 필터링 (PostgreSQL 버전)
=============================================================================
- precedent_list.json (17.2만 건) → PG precedents 테이블에 메타데이터 저장
- 동시에 stage1_filter_status 컬럼에 'included' / 'excluded' 표시
- 필터 로직 자체는 변경 없음. 대법원만 추리는 건 Stage 2에서 SQL로 처리.

실행 전:
    docker compose up -d
    pip install psycopg2-binary
=============================================================================
"""
import json
import re
from datetime import datetime
from pathlib import Path

import psycopg2.extras

from db import get_connection


# =============================================================================
# Configuration
# =============================================================================
BASE_DIR = Path("./startup_legal_rag")
BASE_DIR.mkdir(exist_ok=True)

INPUT_PATH = Path("./precedent_list.json")
STATS_OUTPUT = BASE_DIR / "stage1_stats.json"
SAMPLE_OUTPUT = BASE_DIR / "stage1_sample.json"

MIN_YEAR = 2005


# =============================================================================
# Keywords (이전 단계와 동일)
# =============================================================================
STARTUP_KEYWORDS = [
    # 회사 설립·지배구조
    "정관", "이사회", "주식회사", "주주총회", "주주간 계약",
    "주주평등의 원칙", "법인 인장", "상호", "상업등기",

    # 주식·증권
    "종류주식", "보통주", "우선주", "상환우선주", "전환우선주",
    "상환전환우선주", "RCPS", "잔여재산분배우선주",
    "신주발행", "신주인수계약", "신주인수권부사채",
    "전환사채", "교환사채", "메자닌",
    "스톡옵션", "주식매수선택권",
    "주식매수청구권", "주식양도계약", "주식전환청구권",
    "공동매도권", "Drag along", "Tag along",
    "희석방지", "샌드배깅", "프로큐어",

    # 투자·자금조달
    "벤처캐피탈", "엔젤투자자", "모태펀드",
    "투자계약", "양해각서", "MOU",
    "진술과 보장", "Representations and Warranties",
    "기업공개", "IPO", "상장", "플립",
    "벤처기업", "중소기업", "벤처투자",

    # 계약·채권
    "동업계약", "근로계약", "용역계약", "공급계약",
    "채무불이행", "이행보증",
    "손해배상액의 예정", "위약금", "위약벌",
    "연대보증", "근보증", "보증인보호",
    "최고의 항변", "검색의 항변",
    "내용증명", "독촉절차", "지급명령",

    # 지식재산권
    "지식재산권", "산업재산권", "산업지식재산권",
    "특허권", "특허침해", "실용신안권", "BM 발명",
    "신규성", "진보성", "산업상 이용가능성",
    "거절결정불복심판", "우선심사",
    "선행기술", "공개특허",
    "통상실시권", "전용실시권",
    "상표권", "상표침해", "디자인권",
    "보통명칭상표", "성질표시상표",
    "저작권", "저작인접권", "업무상저작물",
    "2차적 저작물", "2차적저작물",
    "동일성유지권", "성명표시권", "공표권",
    "실연자", "퍼블리시티권",
    "필수장면", "합체의 원칙",
    "권리소진", "국제소진",

    # 영업비밀·부정경쟁
    "영업비밀", "영업비밀 침해", "영업비밀침해",
    "영업비밀 원본증명",
    "부정경쟁", "부정경쟁방지",
    "비공지성", "비밀관리성", "비밀 관리성",
    "경제적 유용성", "비밀유지의무", "NDA",
    "경업금지", "전직금지",
    "노하우", "know-how", "핵심기술", "기술유출",

    # 공정거래
    "공정거래", "불공정거래행위",
    "가격차별", "거래조건차별", "차별적 취급",
    "계열회사를 위한 차별", "집단적 차별",
    "거래거절", "거래강제", "구입강제",
    "끼워팔기", "사원판매",
    "부당염매", "유인염매", "부당고가매입",
    "이익제공강요", "판매목표강제", "불이익제공",
    "거래상 지위의 남용", "거래상지위남용",
    "경영간섭", "사업활동방해",
    "배타조건부거래", "구속조건부거래",
    "지역제한", "책임지역",
    "하도급", "가맹사업", "프랜차이즈",
    "표시광고", "부당광고", "기만광고", "비교광고",

    # 노동·인사
    "근로기준법", "근로계약서", "취업규칙",
    "부당해고", "정리해고", "징계해고", "권고사직",
    "임금", "통상임금", "최저임금", "임금체불",
    "퇴직금", "퇴직연금",
    "연차휴가", "주52시간", "근로시간",
    "직장 내 괴롭힘", "직장내괴롭힘",
    "성희롱", "성희롱 예방",
    "산업재해", "산재", "업무상 재해",
    "4대보험", "근로자성", "프리랜서",

    # 개인정보·정보통신
    "개인정보", "개인정보보호",
    "정보통신망", "정보통신망법",
    "주민등록번호", "민감정보", "고유식별정보",
    "개인정보 유출", "개인정보유출",
    "위치정보", "쿠키", "프로파일링",
    "전자상거래", "통신판매",
    "약관", "약관규제", "불공정약관",

    # 부동산·임대차
    "상가임대차", "주택임대차",
    "임대차계약", "임차권 등기명령",
    "권리금", "대항력", "최우선변제권",
    "갱신청구권",

    # 도산·회생·파산
    "법인파산", "법인회생",
    "개인파산", "개인회생", "간이회생",
    "기존 경영자 관리인", "DIP",
    "회생계획", "회생절차개시",

    # 세무·회계
    "법인세", "부가가치세", "소득세", "원천징수",
    "양도소득세", "증여세", "상속세",
    "조세특례제한법", "조세회피", "실질과세",
    "이전가격", "특수관계인",
    "일반기업회계기준", "K-IFRS", "한국채택국제회계기준",
    "의제배당", "영세율",

    # 일반
    "개인사업자", "사업자등록",
    "중재", "조정",
]

EXCLUDE_KEYWORDS = [
    # 가사·친족
    "이혼", "친권", "양육비", "위자료", "혼인",
    "상속", "유언", "유류분", "친자",
    # 형사
    "강간", "강제추행", "성폭력", "성매매",
    "음주운전", "교통사고", "뺑소니",
    "마약", "향정신성", "도박",
    "절도", "강도", "특수절도",
    "폭행", "상해", "협박",
    # 행정 (스타트업 무관)
    "병역", "군무이탈", "현역",
    "출입국", "체류자격", "난민",
    "운전면허 취소", "운전면허취소",
    # 의료·복지
    "의료사고", "의료과오", "진료",
    "국민연금", "국민건강보험",
    "기초생활수급",
]

TAX_ADMIN_CASE_TYPES = [
    "행정", "조세", "세무",
    "부가가치세", "법인세", "소득세", "양도소득세",
    "증여세", "상속세", "지방세", "관세",
]


# =============================================================================
# Helper functions
# =============================================================================
RE_COURT_FROM_CASE_NO = re.compile(r'^([가-힣]+(?:법원|지원|위원회))')


def extract_court_from_case_no(case_no):
    if not case_no:
        return None
    m = RE_COURT_FROM_CASE_NO.match(case_no)
    return m.group(1) if m else None


def detect_response_format(detail_link):
    if not detail_link:
        return 'UNKNOWN'
    if 'type=HTML' in detail_link:
        return 'HTML'
    if 'type=XML' in detail_link:
        return 'XML'
    return 'UNKNOWN'


def normalize_judgment_type(raw):
    if not raw:
        return None
    cleaned = re.sub(r'^[^:]*:\s*', '', raw).strip()
    return cleaned or None


def is_startup_relevant(prec, court_extracted):
    name = prec.get('case_name', '') or ''
    case_type = prec.get('case_type_name', '') or ''
    court_name = prec.get('court_name') or ''
    court = court_name or court_extracted or ''
    date = prec.get('judgment_date', '') or ''

    if case_type in ('가사', '소년'):
        return False, f'case_type:{case_type}'

    if date and len(date) >= 4 and date[:4].isdigit():
        year = int(date[:4])
        if year < MIN_YEAR:
            return False, f'too_old:{year}'

    matched_excl = [kw for kw in EXCLUDE_KEYWORDS if kw in name]
    if matched_excl:
        return False, f'exclude_kw:{matched_excl[0]}'

    matched_incl = [kw for kw in STARTUP_KEYWORDS if kw in name]
    if matched_incl:
        return True, f'startup_kw:{matched_incl[0]}'

    if '대법원' in court and any(kw in case_type for kw in TAX_ADMIN_CASE_TYPES):
        return True, 'supreme_admin_tax'

    if '특허법원' in court or '서울회생법원' in court:
        return True, 'specialized_court'

    return False, 'no_match'


# =============================================================================
# Main pipeline
# =============================================================================
UPSERT_SQL = """
INSERT INTO precedents (
    prec_serial, case_no, case_name,
    court_name, court_extracted, court_type_code,
    judgment_date, case_type_name, case_type_code,
    judgment_type, judgment_result,
    data_source, detail_link, response_format,
    stage1_filter_status, stage1_filter_reason
) VALUES %s
ON CONFLICT (prec_serial) DO UPDATE SET
    case_no              = EXCLUDED.case_no,
    case_name            = EXCLUDED.case_name,
    court_name           = EXCLUDED.court_name,
    court_extracted      = EXCLUDED.court_extracted,
    court_type_code      = EXCLUDED.court_type_code,
    judgment_date        = EXCLUDED.judgment_date,
    case_type_name       = EXCLUDED.case_type_name,
    case_type_code       = EXCLUDED.case_type_code,
    judgment_type        = EXCLUDED.judgment_type,
    judgment_result      = EXCLUDED.judgment_result,
    data_source          = EXCLUDED.data_source,
    detail_link          = EXCLUDED.detail_link,
    response_format      = EXCLUDED.response_format,
    stage1_filter_status = EXCLUDED.stage1_filter_status,
    stage1_filter_reason = EXCLUDED.stage1_filter_reason,
    updated_at           = NOW()
"""


def run_stage1(precedent_list, conn):
    stats = {
        'total': len(precedent_list),
        'included': 0, 'excluded': 0, 'skipped_no_serial': 0,
        'include_reasons': {}, 'exclude_reasons': {},
        'court_dist_included': {}, 'case_type_dist_included': {},
        'data_source_dist_included': {}, 'year_dist_included': {},
    }

    total = len(precedent_list)
    BATCH_SIZE = 1000
    batch = []
    cur = conn.cursor()

    for i, prec in enumerate(precedent_list, 1):
        prec_serial = prec.get('prec_serial')
        if prec_serial is None:
            stats['skipped_no_serial'] += 1
            continue

        court_extracted = extract_court_from_case_no(prec.get('case_no'))
        response_format = detect_response_format(prec.get('detail_link'))
        included, reason = is_startup_relevant(prec, court_extracted)
        status = 'included' if included else 'excluded'

        if included:
            stats['included'] += 1
            stats['include_reasons'][reason] = stats['include_reasons'].get(reason, 0) + 1
            cf = prec.get('court_name') or court_extracted or 'unknown'
            stats['court_dist_included'][cf] = stats['court_dist_included'].get(cf, 0) + 1
            ct = prec.get('case_type_name') or 'unknown'
            stats['case_type_dist_included'][ct] = stats['case_type_dist_included'].get(ct, 0) + 1
            ds = prec.get('data_source') or 'unknown'
            stats['data_source_dist_included'][ds] = stats['data_source_dist_included'].get(ds, 0) + 1
            date = prec.get('judgment_date', '') or ''
            if date and len(date) >= 4 and date[:4].isdigit():
                stats['year_dist_included'][date[:4]] = stats['year_dist_included'].get(date[:4], 0) + 1
        else:
            stats['excluded'] += 1
            stats['exclude_reasons'][reason] = stats['exclude_reasons'].get(reason, 0) + 1

        batch.append((
            int(prec_serial),
            prec.get('case_no'), prec.get('case_name'),
            prec.get('court_name'), court_extracted, prec.get('court_type_code'),
            prec.get('judgment_date'), prec.get('case_type_name'), prec.get('case_type_code'),
            normalize_judgment_type(prec.get('judgment_type')), prec.get('judgment_result'),
            prec.get('data_source'), prec.get('detail_link'), response_format,
            status, reason,
        ))

        if len(batch) >= BATCH_SIZE:
            psycopg2.extras.execute_values(cur, UPSERT_SQL, batch, page_size=BATCH_SIZE)
            conn.commit()
            batch = []
            pct = i / total * 100
            print(f"  진행: {i:>7,} / {total:,}  ({pct:5.1f}%)  "
                  f"포함 {stats['included']:>6,}  제외 {stats['excluded']:>6,}")

    if batch:
        psycopg2.extras.execute_values(cur, UPSERT_SQL, batch, page_size=BATCH_SIZE)
        conn.commit()

    cur.close()
    return stats


# =============================================================================
# Reporting
# =============================================================================
def print_stats(stats):
    total, incl, excl = stats['total'], stats['included'], stats['excluded']
    print("\n" + "=" * 70)
    print("  Stage 1: 필터링 결과")
    print("=" * 70)
    print(f"\n전체:        {total:>8,}")
    print(f"포함:        {incl:>8,}  ({incl/total*100:5.2f}%)")
    print(f"제외:        {excl:>8,}  ({excl/total*100:5.2f}%)")
    if stats['skipped_no_serial']:
        print(f"스킵(ID없음): {stats['skipped_no_serial']:>8,}")

    def top(d, n=15):
        return sorted(d.items(), key=lambda x: -x[1])[:n]

    print("\n--- 데이터 소스 분포 (포함된 것) ---")
    for ds, count in top(stats['data_source_dist_included'], 10):
        print(f"  {count:>7,}  {ds}")

    print("\n--- 포함 사유 Top 15 ---")
    for reason, count in top(stats['include_reasons'], 15):
        print(f"  {count:>7,}  {reason}")

    print("\n--- 제외 사유 Top 10 ---")
    for reason, count in top(stats['exclude_reasons'], 10):
        print(f"  {count:>7,}  {reason}")


def save_verification_sample(conn, n_each=50):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        def fetch(status):
            cur.execute("""
                SELECT prec_serial, case_no, case_name,
                       court_name, court_extracted,
                       judgment_date, case_type_name, data_source,
                       response_format, stage1_filter_reason
                FROM precedents
                WHERE stage1_filter_status = %s
                ORDER BY RANDOM() LIMIT %s
            """, (status, n_each))
            return [dict(row) for row in cur.fetchall()]

        sample = {
            'meta': {'generated_at': datetime.now().isoformat(), 'n_each': n_each},
            'included_sample': fetch('included'),
            'excluded_sample': fetch('excluded'),
        }

    SAMPLE_OUTPUT.write_text(
        json.dumps(sample, ensure_ascii=False, indent=2, default=str),
        encoding='utf-8'
    )


def main():
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] Stage 1 시작\n")

    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"입력 파일 없음: {INPUT_PATH}")

    print(f"📂 입력 로드: {INPUT_PATH}")
    precedent_list = json.loads(INPUT_PATH.read_text(encoding='utf-8'))
    print(f"   → {len(precedent_list):,} 건\n")

    print("💾 PostgreSQL 연결...")
    conn = get_connection()

    print("\n🔍 필터링 + DB UPSERT 중...\n")
    stats = run_stage1(precedent_list, conn)
    print_stats(stats)

    STATS_OUTPUT.write_text(
        json.dumps(stats, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    save_verification_sample(conn, n_each=50)
    conn.close()

    print("\n" + "=" * 70)
    print("  ✅ Stage 1 완료")
    print("=" * 70)
    print(f"  📈 통계:  {STATS_OUTPUT}")
    print(f"  🔬 샘플:  {SAMPLE_OUTPUT}")
    print()
    print("  📋 다음: python stage2_fetch.py  → 대법원 data_source만 본문 수집")


if __name__ == "__main__":
    main()