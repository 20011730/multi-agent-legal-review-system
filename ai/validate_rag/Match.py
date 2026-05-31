"""
AI Hub 상황별 판례 데이터 → case_documents (PG) 매칭 검증
- 1차: info.id ↔ case_documents.db_id 
- 2차: (courtNm, caseNoID) ↔ (court, case_number) fallback
- 결과: PG의 eval_dataset 테이블에 저장
- 1차로 판례일련번호 id로 매칭하고 안되면 2차로 사건번호 + 법정 종류 매칭해서
일치하는 것들만 db에 저장해서 검증 dataset으로 활용한다.
"""

import os
import json
import glob
import psycopg2
from psycopg2.extras import execute_values
from collections import defaultdict

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────
PG_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "legalreview",
    "user": "legalreview",
    "password": "legalreview",
}

AIHUB_ROOT = "/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/validate_rag"

CASE_TABLE      = "case_documents"
COL_ID          = "id"          # 너희 PK (= 판례일련번호 추정). 다르면 수정
COL_CASE_NUMBER = "case_number"
COL_COURT       = "court"

EVAL_TABLE     = "eval_dataset"
TRUNCATE_FIRST = True              # 재실행 시 깨끗하게 (False면 누적)

FOLDERS = [
    "TL_01.민사",
    "TL_04.형사B(일반형)",
    "TL_05.행정",
    "TL_06.기업",
    "TL_07.근로자",
    "TL_08.특허.저작권",
    "TL_09.금융조세",
    "TL_10.개인정보.ICT",
]

# ─────────────────────────────────────────────────────────────────────────────
# 1. corpus 인덱스 로드 (PostgreSQL)
# ─────────────────────────────────────────────────────────────────────────────
def load_corpus_index(conn):
    cur = conn.cursor()
    cur.execute(
        f"SELECT {COL_ID}, {COL_CASE_NUMBER}, {COL_COURT} FROM {CASE_TABLE}"
    )
    by_id, by_caseno = {}, {}
    for cid, cno, court in cur.fetchall():
        try:
            cid_int = int(cid)
        except (TypeError, ValueError):
            cid_int = cid
        by_id[cid_int] = cid
        if cno:
            by_caseno[((court or "").strip(), cno.strip())] = cid
    cur.close()
    return by_id, by_caseno

# ─────────────────────────────────────────────────────────────────────────────
# 2. eval_dataset 테이블 생성 (PostgreSQL)
# ─────────────────────────────────────────────────────────────────────────────
def init_eval_table(conn):
    cur = conn.cursor()
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {EVAL_TABLE} (
            eval_id        BIGSERIAL PRIMARY KEY,
            folder         TEXT,
            match_type     TEXT,
            corpus_id      BIGINT,
            aihub_id       BIGINT,
            case_no        TEXT,
            court          TEXT,
            case_title     TEXT,
            class_name     TEXT,
            instance_name  TEXT,
            jdgmn          TEXT,
            summ_pass      TEXT,
            qa_question    TEXT,
            qa_answer      TEXT,
            ref_rules      TEXT,
            ref_cases      TEXT,
            source_path    TEXT
        )
    """)
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{EVAL_TABLE}_corpus "
                f"ON {EVAL_TABLE}(corpus_id)")
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{EVAL_TABLE}_folder "
                f"ON {EVAL_TABLE}(folder)")
    if TRUNCATE_FIRST:
        cur.execute(f"TRUNCATE {EVAL_TABLE} RESTART IDENTITY")
    conn.commit()
    cur.close()

# ─────────────────────────────────────────────────────────────────────────────
# 3. 보조 함수
# ─────────────────────────────────────────────────────────────────────────────
def iter_aihub_jsons(root, folders):
    for folder in folders:
        folder_path = os.path.join(root, folder)
        if not os.path.isdir(folder_path):
            print(f"⚠️  폴더 없음, 스킵: {folder_path}")
            continue
        for jp in glob.glob(os.path.join(folder_path, "**", "*.json"),
                            recursive=True):
            yield folder, jp

def extract_fields(data):
    info         = data.get("info", {})
    summary_list = data.get("Summary") or data.get("summary") or []
    jdgmn_info   = data.get("jdgmnInfo") or []
    class_info   = data.get("Class_info") or data.get("class_info") or {}
    ref_info     = data.get("Reference_info") or data.get("reference_info") or {}

    summ_pass = ""
    if summary_list and isinstance(summary_list, list):
        summ_pass = (summary_list[0].get("summ_pass") or "").strip()

    qa_q, qa_a = "", ""
    if jdgmn_info and isinstance(jdgmn_info, list):
        qa_q = (jdgmn_info[0].get("question") or "").strip()
        qa_a = (jdgmn_info[0].get("answer") or "").strip()

    return {
        "aihub_id":      info.get("id"),
        "case_no":       (info.get("caseNoID") or info.get("caseNo") or "").strip(),
        "court":         (info.get("courtNm") or "").strip(),
        "case_title":    info.get("caseTitle", ""),
        "class_name":    class_info.get("class_name", ""),
        "instance_name": class_info.get("instance_name", ""),
        "jdgmn":         (data.get("jdgmn") or "").strip(),
        "summ_pass":     summ_pass,
        "qa_question":   qa_q,
        "qa_answer":     qa_a,
        "ref_rules":     ref_info.get("reference_rules", ""),
        "ref_cases":     ref_info.get("reference_court_case", ""),
    }

# ─────────────────────────────────────────────────────────────────────────────
# 4. 메인
# ─────────────────────────────────────────────────────────────────────────────
INSERT_SQL = f"""
    INSERT INTO {EVAL_TABLE}
    (folder, match_type, corpus_id, aihub_id, case_no, court,
     case_title, class_name, instance_name, jdgmn, summ_pass,
     qa_question, qa_answer, ref_rules, ref_cases, source_path)
    VALUES %s
"""

def main():
    pg_conn = psycopg2.connect(**PG_CONFIG)
    print(f"📚 corpus 인덱스 로딩 ({CASE_TABLE} @ PostgreSQL) ...")
    by_id, by_caseno = load_corpus_index(pg_conn)
    print(f"   → {len(by_id):,}건 인덱스 완료\n")

    init_eval_table(pg_conn)

    stats = defaultdict(lambda: {"total": 0, "id": 0, "caseno": 0, "miss": 0})
    unmatched_samples = defaultdict(list)
    buffer = []
    BATCH = 5000

    cur = pg_conn.cursor()

    for folder, json_path in iter_aihub_jsons(AIHUB_ROOT, FOLDERS):
        try:
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"⚠️  파싱 실패 {json_path}: {e}")
            continue

        fields = extract_fields(data)
        stats[folder]["total"] += 1

        aihub_id, court, case_no = (fields["aihub_id"],
                                    fields["court"],
                                    fields["case_no"])

        match_type, corpus_id = None, None
        if aihub_id is not None and aihub_id in by_id:
            match_type, corpus_id = "id", by_id[aihub_id]
            stats[folder]["id"] += 1
        elif court and case_no and (court, case_no) in by_caseno:
            match_type, corpus_id = "caseno", by_caseno[(court, case_no)]
            stats[folder]["caseno"] += 1
        else:
            stats[folder]["miss"] += 1
            if len(unmatched_samples[folder]) < 3:
                unmatched_samples[folder].append({
                    "id": aihub_id, "court": court, "case_no": case_no,
                    "title": fields["case_title"],
                })
            continue

        buffer.append((
            folder, match_type, corpus_id, aihub_id, case_no, court,
            fields["case_title"], fields["class_name"], fields["instance_name"],
            fields["jdgmn"], fields["summ_pass"], fields["qa_question"],
            fields["qa_answer"], fields["ref_rules"], fields["ref_cases"],
            json_path,
        ))

        if len(buffer) >= BATCH:
            execute_values(cur, INSERT_SQL, buffer)
            pg_conn.commit()
            buffer.clear()

    if buffer:
        execute_values(cur, INSERT_SQL, buffer)
        pg_conn.commit()

    cur.close()

    # ── 통계 ──────────────────────────────────────────────────
    print(f"\n{'='*88}")
    print(f"{'폴더':<25}{'전체':>10}{'ID매칭':>10}"
          f"{'사건번호':>10}{'미매칭':>10}{'매칭률':>12}")
    print("─"*88)
    tot = tid = tcno = tmiss = 0
    for folder, s in stats.items():
        matched = s["id"] + s["caseno"]
        rate = matched / s["total"] * 100 if s["total"] else 0
        print(f"{folder:<25}{s['total']:>10,}{s['id']:>10,}"
              f"{s['caseno']:>10,}{s['miss']:>10,}{rate:>11.1f}%")
        tot  += s["total"];  tid  += s["id"]
        tcno += s["caseno"]; tmiss += s["miss"]
    print("─"*88)
    gr = (tid + tcno) / tot * 100 if tot else 0
    print(f"{'TOTAL':<25}{tot:>10,}{tid:>10,}{tcno:>10,}{tmiss:>10,}{gr:>11.1f}%")
    print("="*88)

    # ── 미매칭 샘플 ───────────────────────────────────────────
    if any(unmatched_samples.values()):
        print(f"\n🔍 미매칭 샘플 (정규화 점검용):")
        for folder, samples in unmatched_samples.items():
            if samples:
                print(f"\n  [{folder}]")
                for s in samples:
                    print(f"    id={s['id']!s:>10}  court={s['court']:<15}  "
                          f"case_no={s['case_no']:<15}  "
                          f"title={s['title'][:30]}")

    pg_conn.close()
    print(f"\n✅ {EVAL_TABLE} 적재 완료 → PostgreSQL ({PG_CONFIG['dbname']})")

if __name__ == "__main__":
    main()