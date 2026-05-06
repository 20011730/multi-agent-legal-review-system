#!/bin/bash
# ── Spring Boot Backend 실행 스크립트 ──
# 사용법: bash scripts/start-backend.sh

set -e
cd "$(dirname "$0")/../backend"

# 법제처 API OC 키 (환경변수로 전달)
export LAW_API_OC="${LAW_API_OC:-}"

if [ -z "$LAW_API_OC" ]; then
  echo "⚠️  LAW_API_OC 미설정 — 백엔드 직접 법령 검색이 비활성화됩니다."
  echo "   (Python AI 서버의 evidence 수집은 정상 동작합니다)"
fi

echo "🚀 Spring Boot Backend 시작 (port 8080)..."
./gradlew bootRun
