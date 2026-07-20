#!/usr/bin/env bash
# 로컬 DB(PostgreSQL + Chroma) 시작
# 사용: ./scripts/start-db.sh
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; source .env; set +a
fi

echo "▶ docker compose up -d postgres chroma"
docker compose up -d postgres chroma

echo
echo "▶ 컨테이너 상태"
docker compose ps

cat <<'MSG'

────────────────────────────────────────────────
PostgreSQL:  localhost:5432  (db=legalreview)
Chroma:      localhost:8000  (REST v1)
처음 기동 시 healthcheck OK까지 5~15초 소요됩니다.

다음 단계:
  ./scripts/start-backend.sh        # backend bootRun
  ./scripts/setup-rag-local.sh      # 시드/RAG 적재
────────────────────────────────────────────────
MSG
