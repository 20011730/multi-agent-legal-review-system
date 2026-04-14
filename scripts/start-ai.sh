#!/bin/bash
# ── Python AI Server 실행 스크립트 ──
# 사용법: bash scripts/start-ai.sh

set -e
cd "$(dirname "$0")/../python-ai-server"

# .env 파일 확인
if [ ! -f .env ]; then
  echo "❌ python-ai-server/.env 파일이 없습니다."
  echo "   cp .env.example .env 후 값을 채워주세요."
  exit 1
fi

# 가상환경 활성화 (있으면)
if [ -d "venv" ]; then
  source venv/bin/activate
elif [ -d ".venv" ]; then
  source .venv/bin/activate
fi

echo "🚀 Python AI Server 시작 (port 8001)..."
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
