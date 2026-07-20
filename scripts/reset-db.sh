#!/usr/bin/env bash
# ⚠️ 위험: 컨테이너 + 데이터 볼륨 모두 삭제. 모든 PostgreSQL/Chroma 데이터 사라짐.
# 사용: ./scripts/reset-db.sh           # 확인 프롬프트
#       ./scripts/reset-db.sh --force   # 즉시 실행
set -e
cd "$(dirname "$0")/.."

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

cat <<'WARN'
────────────────────────────────────────────────────
⚠️  RESET 경고
이 스크립트는 다음을 모두 삭제합니다:
  - legalreview-postgres / legalreview-chroma 컨테이너
  - legalreview_postgres_data / legalreview_chroma_data 볼륨

→ law_list, law_documents, evidences, review_sessions 등
   PostgreSQL 모든 row + Chroma 모든 chunk가 사라집니다.
────────────────────────────────────────────────────
WARN

if [ "$FORCE" -ne 1 ]; then
  read -r -p "정말로 삭제하시겠습니까? (yes/N) " ans
  case "$ans" in
    yes|YES|y|Y) ;;
    *) echo "✗ 취소됨"; exit 1 ;;
  esac
fi

echo "▶ docker compose down -v"
docker compose down -v
echo "✓ 컨테이너+볼륨 삭제 완료. 다시 시작하려면 ./scripts/start-db.sh"
