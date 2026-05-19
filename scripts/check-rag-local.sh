#!/usr/bin/env bash
# 로컬 RAG 환경 점검
# 사용: ./scripts/check-rag-local.sh
set +e
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; source .env; set +a; }

PG_USER="${POSTGRES_USER:-legalreview}"
PG_DB="${POSTGRES_DB:-legalreview}"
PG_PASS="${POSTGRES_PASSWORD:-legalreview}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
CHROMA_URL="${CHROMA_BASE_URL:-http://localhost:8000}"

echo "── 1) docker compose 컨테이너 상태"
docker compose ps 2>/dev/null || echo "  (docker compose 명령 실패)"
echo

echo "── 2) PostgreSQL 연결 + 테이블 row 수"
PGPASSWORD="$PG_PASS" psql -h localhost -U "$PG_USER" -d "$PG_DB" -tAc "
SELECT 'law_list:        ' || COUNT(*) FROM law_list;
SELECT 'law_documents:   ' || COUNT(*) FROM law_documents;
SELECT 'chunked=true:    ' || COUNT(*) FROM law_documents WHERE chunked = true;
SELECT 'review_sessions: ' || COUNT(*) FROM review_sessions;
SELECT 'evidences:       ' || COUNT(*) FROM evidences;
" 2>&1 | sed 's/^/  /'
echo

echo "── 3) Chroma heartbeat ($CHROMA_URL)"
HB=$(curl -s -o /dev/null -w "%{http_code}" "$CHROMA_URL/api/v1/heartbeat" 2>/dev/null)
echo "  HTTP $HB"
echo

echo "── 4) backend RAG health"
curl -s "$BACKEND_URL/api/rag/health" 2>/dev/null | sed 's/^/  /' || echo "  (응답 없음)"
echo
echo

echo "── 5) Chroma laws/cases collection 카운트 (backend health 응답)"
curl -s "$BACKEND_URL/api/rag/health" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    laws = d.get('lawsCount')
    cases = d.get('casesCount')
    print('  lawsCount:  ', laws)
    print('  casesCount: ', cases)
    msgs = []
    if laws == -1:
        msgs.append('  ⚠️  laws: -1 = Chroma collection count 조회 실패')
    if cases == -1:
        msgs.append('  ⚠️  cases: -1 = Chroma collection count 조회 실패')
    if msgs:
        print()
        for m in msgs: print(m)
        print('     원인 후보:')
        print('       1) Chroma 서버 미기동 → docker compose ps 확인')
        print('       2) 컬렉션 미생성 → POST /api/rag/ingest/chroma/laws?limit=1 로 자동 생성 시도')
        print('       3) Chroma API 버전 불일치 → backend 재시작 후 재확인')
except Exception as e:
    print('  (파싱 실패:', e, ')')
"
echo

echo "── 6) retrieval 미니 테스트 (실제 적재된 법령 기반 query)"
echo "      query: reviewType=marketing, content=표시 광고 부당광고 사업자"
curl -s -X POST "$BACKEND_URL/api/rag/retrieve" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"test","industry":"tech","reviewType":"marketing","situation":"표시광고 검토","content":"표시 광고 부당광고 사업자"}' \
  2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    cnt = d.get('count', 0)
    print('  count:', cnt)
    if cnt == 0:
        print('  ⚠️  결과 없음 — 가능 원인:')
        print('     1) Chroma laws collection 비어있음 (POST /api/rag/ingest/chroma/laws)')
        print('     2) embedding 미적재 (Chroma 0.5.x REST는 embeddings 필수 — chunked=true 24건 reset 후 재적재 필요)')
        print('     3) query 텍스트와 적재 본문 어휘 겹침 X')
    for ev in (d.get('evidences') or [])[:3]:
        title = ev.get('title') or ''
        print('   - [%s] %s ... [%s]' % (ev.get('sourceType','?'), title[:55], ev.get('relevanceReason','')))
except Exception as e:
    print('  (파싱 실패:', e, ')')
"

echo
echo "── 7) Chroma cases_e5 컬렉션 직접 카운트 (backend retrieval 연결 여부와 무관)"
#   backend의 casesCollection 설정과 별개로, Chroma 측의 cases_e5 컬렉션 자체에 데이터가
#   있는지 read-only로 확인. 컬렉션이 없거나 read 실패 시에도 본 스크립트의 다른 단계
#   결과에 영향 주지 않도록 안전하게 출력만.
CASES_E5_UUID=$(curl -s "$CHROMA_URL/api/v1/collections" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    matches = [c['id'] for c in d if c.get('name') == 'cases_e5']
    print(matches[0] if matches else '')
except Exception:
    print('')
" 2>/dev/null)
if [ -n "$CASES_E5_UUID" ]; then
  CASES_E5_COUNT=$(curl -s "$CHROMA_URL/api/v1/collections/$CASES_E5_UUID/count" 2>/dev/null)
  echo "  cases_e5 uuid=$CASES_E5_UUID count=$CASES_E5_COUNT"
else
  echo "  (cases_e5 컬렉션 없음 — ai/generate_rag/5-2.insert_cases_e5.py 로 적재 가능)"
fi
echo

echo "── 8) retrieval 미니 테스트 [CASE]"
echo "      query: 표시광고 부당광고 판례"
echo "      ⚠ 본 단계는 backend의 casesCollection 설정이 'cases_e5' 일 때만 의미있음."
echo "         현재 backend 설정에서 cases_e5 가 아니라면 결과는 빈 리스트로 출력됨."
curl -s -X POST "$BACKEND_URL/api/rag/retrieve" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"test","industry":"tech","reviewType":"marketing","situation":"판례 검토","content":"표시광고 부당광고 판례"}' \
  2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    cases = [e for e in (d.get('evidences') or []) if (e.get('sourceType') == 'CASE')]
    print('  [CASE] hits:', len(cases))
    for ev in cases[:5]:
        title = (ev.get('title') or '').strip() or '<no-title>'
        # metadata 에서 추가 식별 정보 추출 (camelCase 또는 snake_case 모두 fallback)
        m = ev.get('metadata') or {}
        court = m.get('court') or ''
        date = m.get('decision_date') or m.get('judgmentDate') or ''
        case_no = m.get('case_number') or m.get('caseNumber') or ev.get('referenceId') or ''
        text_type = m.get('text_type') or m.get('section') or ''
        extras = ' | '.join(x for x in (court, date, case_no, text_type) if x)
        print(f'   - {title[:60]}')
        if extras:
            print(f'       [{extras}]')
except Exception as e:
    print('  (파싱 실패:', e, ')')
"

echo
echo "✓ 점검 완료"
