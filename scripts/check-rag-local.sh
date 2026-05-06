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

echo "── 6) retrieval 미니 테스트 (RAG 활성 시에만 의미있음)"
curl -s -X POST "$BACKEND_URL/api/rag/retrieve" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"test","industry":"tech","reviewType":"marketing","situation":"광고 문구 검토","content":"업계 1위 표시광고"}' \
  2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('  count:', d.get('count'))
    for ev in (d.get('evidences') or [])[:3]:
        print('   -', ev.get('sourceType'), ev.get('title')[:50] if ev.get('title') else '')
except Exception as e:
    print('  (파싱 실패:', e, ')')
"

echo
echo "✓ 점검 완료"
