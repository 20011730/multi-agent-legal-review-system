#!/usr/bin/env bash
# Spring Boot backend 실행
# 사용: ./scripts/start-backend.sh
#
# .env 파일이 있으면 자동 로드. 없으면 환경변수만 사용.
# 필요한 환경변수(.env.example 참조):
#   - LAW_API_OC                              (법령 API 수집 시 필요)
#   - APP_RAG_ENABLED=true                    (Chroma 연동 시 필요)
#   - APP_RAG_INGESTION_DEV_ENDPOINT_ENABLED=true  (개발용 /api/rag/* endpoint)

set -e
cd "$(dirname "$0")/.."

# .env 자동 로드
if [ -f .env ]; then
  set -a; source .env; set +a
  echo "✓ .env 로드 완료"
fi

# 기본값 (env에 없으면)
export LAW_API_OC="${LAW_API_OC:-}"
export APP_RAG_ENABLED="${APP_RAG_ENABLED:-true}"
export APP_RAG_INGESTION_DEV_ENDPOINT_ENABLED="${APP_RAG_INGESTION_DEV_ENDPOINT_ENABLED:-true}"

if [ -z "$LAW_API_OC" ] || [ "$LAW_API_OC" = "여기에_본인_OC값_입력" ]; then
  cat <<'WARN'
⚠️  LAW_API_OC 미설정 — 다음 기능이 비활성화됩니다:
   - POST /api/rag/ingest/law-list/api          (법령 목록 API 수집)
   - POST /api/rag/ingest/law-documents/api/*   (법령 본문 API 수집)
   classpath seed / JSON·CSV 업로드 / Chroma 적재는 정상 동작합니다.
WARN
fi

echo "🚀 Spring Boot Backend 시작 (port 8080) — RAG dev endpoint 활성"
cd backend
./gradlew bootRun
