#!/bin/bash
# ── Frontend 개발 서버 실행 스크립트 ──
# 사용법: bash scripts/start-frontend.sh

set -e
cd "$(dirname "$0")/../frontend"

# 의존성 설치 (node_modules 없으면)
if [ ! -d "node_modules" ]; then
  echo "📦 npm install 실행 중..."
  npm install
fi

echo "🚀 Frontend 개발 서버 시작 (port 5173)..."
npm run dev
