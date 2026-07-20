#!/usr/bin/env bash
# 로컬 DB(PostgreSQL + Chroma) 중지 — 데이터 볼륨은 유지
# 사용: ./scripts/stop-db.sh
set -e
cd "$(dirname "$0")/.."
echo "▶ docker compose stop"
docker compose stop
echo "✓ 중지 완료. 데이터는 보존됨 (postgres_data / chroma_data 볼륨)."
