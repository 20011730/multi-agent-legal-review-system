# RunPod Ollama 연동 가이드

> 로컬 맥북 백엔드 → SSH 터널 → RunPod Ollama 서버

## 구조도

```
┌─────────── 맥북 (로컬) ──────────┐     SSH 터널      ┌──── RunPod ────┐
│                                   │                    │                │
│  Frontend (:5173)                 │                    │                │
│      ↓                            │                    │                │
│  Spring Boot (:8080)              │                    │                │
│      ↓                            │                    │                │
│  OllamaClient                     │                    │                │
│      ↓                            │                    │                │
│  localhost:11434 ─── SSH 터널 ──────────────────→ Ollama (:11434)  │
│                                   │                    │  glm-4.7-flash │
│  PostgreSQL (:5432)               │                    │                │
│                                   │                    │                │
└───────────────────────────────────┘                    └────────────────┘
```

**핵심**: 코드는 `localhost:11434`를 호출. SSH 터널이 이걸 RunPod으로 포워딩.

---

## 사전 준비

### RunPod 측
- Pod 실행 중
- Ollama 설치 및 모델 다운로드 완료
- SSH 접속 가능 (포트 번호 확인: RunPod 대시보드 → Connect → SSH)

### 맥북 측
- Java 21+, PostgreSQL, Gradle
- 로컬 Ollama가 실행 중이면 **종료** 필요 (포트 11434 충돌)

---

## 실행 절차 (매 테스트마다 반복)

### Step 0: 로컬 Ollama 종료 (실행 중이라면)

```bash
# Ollama가 로컬에서 돌고 있으면 포트 충돌. 먼저 종료
brew services stop ollama 2>/dev/null
pkill ollama 2>/dev/null
# 확인
lsof -i :11434 || echo "포트 11434 사용 안함 ✓"
```

### Step 1: RunPod에서 Ollama 실행 확인

```bash
# RunPod SSH 접속 (포트번호는 본인 Pod 기준으로 교체)
ssh root@ssh.runpod.io -p {SSH_PORT}

# Pod 내부에서 확인
ollama list
# → glm-4.7-flash:q4_K_M 이 보여야 함

curl http://127.0.0.1:11434/api/tags
# → 모델 목록 JSON 응답 확인

# 확인 완료 후 SSH 세션은 그대로 두거나 exit
```

### Step 2: SSH 터널 열기 (맥북 터미널 1)

```bash
# ──────────────────────────────────────────────
# {SSH_PORT}를 본인 RunPod SSH 포트로 교체하세요
# ──────────────────────────────────────────────
ssh -N -L 11434:127.0.0.1:11434 root@ssh.runpod.io -p {SSH_PORT}
```

또는 헬퍼 스크립트 사용:
```bash
./scripts/runpod-tunnel.sh {SSH_PORT}
```

> 이 터미널은 **닫지 마세요**. 터널이 유지되어야 합니다.
> 성공하면 아무 출력 없이 대기 상태가 됩니다.

### Step 3: 터널 검증 (맥북 터미널 2)

```bash
# 로컬에서 Ollama API 호출 → RunPod으로 포워딩되어야 함
curl -s http://localhost:11434/api/tags | python3 -m json.tool
```

기대 응답:
```json
{
    "models": [
        {
            "name": "glm-4.7-flash:q4_K_M",
            ...
        }
    ]
}
```

### Step 4: 백엔드 실행 (맥북 터미널 2)

```bash
cd backend
AI_ENGINE=ollama ./gradlew bootRun
```

### Step 5: 연결 테스트

```bash
# (1) Ollama health check
curl -s http://localhost:8080/api/sessions/ollama/health | python3 -m json.tool
# 기대: {"ollamaAvailable": true, "message": "Ollama 서버 연결 성공"}

# (2) 세션 생성
curl -s -X POST http://localhost:8080/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "테스트컴퍼니",
    "industry": "tech",
    "reviewType": "marketing",
    "situation": "신제품 광고 문구 검토",
    "content": "업계 1위 대비 2배 빠른 속도",
    "participationMode": "observe"
  }' | python3 -m json.tool
# 기대: {"sessionId": N, "status": "ANALYZING"}
# → sessionId 번호를 기억하세요

# (3) 상태 폴링 (sessionId를 위 결과값으로 교체)
curl -s http://localhost:8080/api/sessions/{sessionId}/status | python3 -m json.tool
# RunPod GPU라면 2~4분 내 COMPLETED 예상

# (4) 최종 결과 조회
curl -s http://localhost:8080/api/sessions/{sessionId}/debates/latest | python3 -m json.tool
```

---

## 환경변수 참조

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_ENGINE` | `python` | `ollama`로 설정 시 Ollama 사용 |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | SSH 터널 사용 시 변경 불필요 |
| `OLLAMA_MODEL` | `glm-4.7-flash:q4_K_M` | `ollama list`로 확인 |
| `OLLAMA_TIMEOUT` | `300` (초) | GPU면 단축 가능, CPU면 늘려야 할 수 있음 |

---

## 트러블슈팅

### 터널이 안 열림
```bash
# 포트 충돌 확인
lsof -i :11434
# → ollama 프로세스가 보이면: pkill ollama

# SSH 키 확인
ssh -v root@ssh.runpod.io -p {SSH_PORT}
```

### health check 실패
```bash
# 1. 터널 살아있는지 확인
curl http://localhost:11434/api/tags
# → 연결 거부 = 터널 끊김 → Step 2 다시 실행

# 2. RunPod에서 Ollama 살아있는지 확인
ssh root@ssh.runpod.io -p {SSH_PORT} "curl http://127.0.0.1:11434/api/tags"
```

### 분석 중 timeout
```bash
# 타임아웃 늘리기
OLLAMA_TIMEOUT=600 AI_ENGINE=ollama ./gradlew bootRun
```

### 폴백 더미 데이터가 나옴
```
Spring Boot 콘솔 로그에서 검색:
  - "AI 분석 실패" → 원인 확인
  - "Request timed out" → OLLAMA_TIMEOUT 늘리기
  - "Connection refused" → 터널 끊김
```

### RunPod Pod가 재시작됨
```bash
# Pod 내부에서 Ollama 다시 시작
ssh root@ssh.runpod.io -p {SSH_PORT}
ollama serve &
ollama list  # 모델 확인
```

---

## 참고: 로컬 Ollama vs RunPod 비교

| | 로컬 맥북 | RunPod (GPU) |
|---|---|---|
| 호출당 소요시간 | 90~150초 | 10~30초 (예상) |
| 전체 분석 (5회 호출) | ~9분 | ~2분 (예상) |
| 설정 | `AI_ENGINE=ollama` | + SSH 터널 |
| 비용 | 무료 | RunPod 사용료 |

---

## 파일 위치

```
backend/
├── src/main/resources/application.yml   ← Ollama 설정 (환경변수 기반)
├── src/main/java/.../OllamaClient.java  ← HTTP 호출 + thinking 제거
├── src/main/java/.../OllamaAnalysisService.java  ← BIZ/LEGAL/JUDGE 토론
├── src/main/java/.../AnalysisAsyncRunner.java     ← 비동기 실행 + 엔진 분기
├── .env.example                         ← 환경변수 템플릿
scripts/
├── runpod-tunnel.sh                     ← SSH 터널 헬퍼 스크립트
docs/
├── RUNPOD_OLLAMA_GUIDE.md              ← 이 문서
```
