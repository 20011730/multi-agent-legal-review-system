#!/usr/bin/env bash
# 로컬 RAG 데이터 적재 헬퍼
#
# 전제:
#   - docker compose 로 postgres + chroma 가 떠 있음 (./scripts/start-db.sh)
#   - backend 가 localhost:8080 에서 실행 중 (./scripts/start-backend.sh)
#   - .env 의 LAW_API_OC, APP_RAG_ENABLED=true, APP_RAG_INGESTION_DEV_ENDPOINT_ENABLED=true 가 적용됨
#
# 기본 모드(가벼움 — LAW_API_OC 없어도 일부 동작):
#   ./scripts/setup-rag-local.sh
#     1) classpath law-list seed (3건)
#     2) classpath laws/cases seed (LegalIngestionService — Chroma upsert까지)
#     3) law_documents recommended 본문 적재 (LAW_API_OC 필요)
#     4) law_documents → Chroma laws upsert
#
# 전체 법령 목록 API 수집(약 5,584건, 시간 소요):
#   ./scripts/setup-rag-local.sh --full-law-list-api
#
set -e
cd "$(dirname "$0")/.."

BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
FULL_LAW_LIST=0
[ "${1:-}" = "--full-law-list-api" ] && FULL_LAW_LIST=1

echo "▶ backend health check ($BACKEND_URL)"
if ! curl -s -f "$BACKEND_URL/api/rag/health" > /dev/null; then
  echo "✗ backend 응답 없음 — 먼저 ./scripts/start-backend.sh 실행"
  exit 1
fi
echo "  OK"

echo
echo "── 1) law_list seed (classpath JSON 3건) ──"
curl -s -X POST "$BACKEND_URL/api/rag/ingest/law-list" || true
echo

echo
echo "── 2) RAG seed (laws+cases JSON → Chroma upsert) ──"
echo "  (Chroma가 꺼져 있으면 빈 결과 반환되며 계속 진행)"
curl -s -X POST "$BACKEND_URL/api/rag/ingest" || true
echo

if [ "$FULL_LAW_LIST" -eq 1 ]; then
  echo
  echo "── (옵션) law_list 전체 API 수집 (약 5,584건, 1~3분 소요) ──"
  echo "  LAW_API_OC가 .env에 정상 설정되어 있어야 합니다."
  curl -s -X POST "$BACKEND_URL/api/rag/ingest/law-list/api?maxPages=60&display=100" || true
  echo
fi

echo
echo "── 3) law_documents 추천 법령 본문 적재 (LAW_API_OC 필요) ──"
curl -s -X POST "$BACKEND_URL/api/rag/ingest/law-documents/api/recommended" \
  | sed -e 's/,"results":\[.*\]//' || true
echo

echo
echo "── 4) law_documents → Chroma laws upsert ──"
echo "  (chunked=false 인 문서 최대 30개 처리)"
curl -s -X POST "$BACKEND_URL/api/rag/ingest/chroma/laws?limit=30" || true
echo

echo
echo "✓ 셋업 완료. 상태 확인: ./scripts/check-rag-local.sh"
