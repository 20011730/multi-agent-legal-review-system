#!/bin/bash
# =============================================================
# RunPod Ollama SSH 터널 스크립트
# =============================================================
# 사용법:
#   ./scripts/runpod-tunnel.sh <SSH_PORT> [SSH_HOST]
#
# 예시:
#   ./scripts/runpod-tunnel.sh 43217
#   ./scripts/runpod-tunnel.sh 43217 ssh.runpod.io
#
# 결과:
#   로컬 localhost:11434 → RunPod의 127.0.0.1:11434 (Ollama)
#
# 종료: Ctrl+C
# =============================================================

set -e

SSH_PORT="${1:?사용법: $0 <SSH_PORT> [SSH_HOST]}"
SSH_HOST="${2:-ssh.runpod.io}"
SSH_USER="root"
LOCAL_PORT=11434
REMOTE_PORT=11434

echo "============================================="
echo " RunPod Ollama SSH 터널"
echo "============================================="
echo " 로컬   : localhost:${LOCAL_PORT}"
echo " 원격   : ${SSH_USER}@${SSH_HOST}:${SSH_PORT} → 127.0.0.1:${REMOTE_PORT}"
echo " 종료   : Ctrl+C"
echo "============================================="
echo ""

# 이미 11434 포트를 사용 중인 프로세스가 있으면 경고
if lsof -i :${LOCAL_PORT} > /dev/null 2>&1; then
    echo "⚠️  경고: 로컬 포트 ${LOCAL_PORT}가 이미 사용 중입니다."
    echo "   로컬 Ollama가 실행 중이면 먼저 종료하세요:"
    echo "   brew services stop ollama   또는   pkill ollama"
    echo ""
    read -p "그래도 계속하시겠습니까? (y/N) " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
        echo "취소됨."
        exit 1
    fi
fi

echo "SSH 터널 연결 중..."
echo ""

ssh -N -L ${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT} \
    ${SSH_USER}@${SSH_HOST} \
    -p ${SSH_PORT} \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes
