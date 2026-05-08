#!/bin/bash
# ── Python AI Server 실행 스크립트 (Ollama / RunPod 기반) ──
# 사용법: bash scripts/start-ai.sh

set -e
cd "$(dirname "$0")/../python-ai-server"

# .env 파일 확인 + 자동 로드
if [ ! -f .env ]; then
  echo "❌ python-ai-server/.env 파일이 없습니다."
  echo "   cp .env.example .env 후 OLLAMA_BASE_URL / OLLAMA_MODEL 값을 채워주세요."
  exit 1
fi
set -a; source .env; set +a

# provider/Ollama 설정 검증 (기본 provider: ollama)
PROVIDER="${AI_PROVIDER:-ollama}"
if [ "$PROVIDER" != "ollama" ]; then
  echo "⚠️  AI_PROVIDER='$PROVIDER' — 본 프로젝트의 기본 흐름은 'ollama' 입니다. .env에서 AI_PROVIDER=ollama 권장."
fi

if [ -z "${OLLAMA_BASE_URL:-}" ]; then
  cat <<'WARN'
⚠️  OLLAMA_BASE_URL 미설정 — 분석 시 LLM 호출이 실패합니다.
   .env 파일에 다음을 추가하세요:
     OLLAMA_BASE_URL=https://<RunPod_proxy>.proxy.runpod.net  (또는 http://localhost:11434)
     OLLAMA_MODEL=<예: llama3.1:8b>
   미설정 상태에서도 서버는 시작되지만 실제 분석은 규칙 기반 fallback으로 동작합니다.
WARN
else
  echo "✓ provider=${PROVIDER}"
  echo "✓ ollamaBaseUrl=${OLLAMA_BASE_URL}"
  echo "✓ ollamaModel=${OLLAMA_MODEL:-(미설정)}"
fi

# 가상환경 활성화 (있으면)
if [ -d "venv" ]; then
  source venv/bin/activate
elif [ -d ".venv" ]; then
  source .venv/bin/activate
fi

echo "🚀 Python AI Server 시작 (port 8001)..."
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
