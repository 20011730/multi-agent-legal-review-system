#!/bin/bash
# ── 시연용 전체 서버 한번에 실행 ──
# 사용법: bash scripts/run-demo.sh
#
# 3개 서버를 백그라운드로 실행하고,
# Ctrl+C 누르면 모두 종료됩니다.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  LegalReview AI - Demo Launcher"
echo "============================================"

# 법제처 API 키 설정 (실제 값은 .env에서 관리)
export LAW_API_OC="${LAW_API_OC:-hyejin}"

# PID 배열
PIDS=()

cleanup() {
  echo ""
  echo "🛑 서버 종료 중..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "✅ 모든 서버가 종료되었습니다."
  exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Python AI Server
echo ""
echo "1️⃣  Python AI Server (port 8001)..."
cd "$ROOT_DIR/python-ai-server"
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload > /tmp/ai_server.log 2>&1 &
PIDS+=($!)
echo "   PID: ${PIDS[-1]}"

# 2. Spring Boot Backend
echo "2️⃣  Spring Boot Backend (port 8080)..."
cd "$ROOT_DIR/backend"
./gradlew bootRun > /tmp/backend.log 2>&1 &
PIDS+=($!)
echo "   PID: ${PIDS[-1]}"

# 3. Frontend Dev Server
echo "3️⃣  Frontend Dev Server (port 5173)..."
cd "$ROOT_DIR/frontend"
npm run dev > /tmp/frontend.log 2>&1 &
PIDS+=($!)
echo "   PID: ${PIDS[-1]}"

echo ""
echo "============================================"
echo "  모든 서버가 시작되었습니다!"
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:8080"
echo "  AI Server: http://localhost:8001"
echo ""
echo "  로그 확인:"
echo "    tail -f /tmp/ai_server.log"
echo "    tail -f /tmp/backend.log"
echo "    tail -f /tmp/frontend.log"
echo ""
echo "  종료: Ctrl+C"
echo "============================================"

# 백그라운드 프로세스 대기
wait
