# 중간발표 안정화 보고서

---

## 1. 머지 충돌 위험 분석

### backend → main 머지

**결과: ✅ 자동 머지 가능 (충돌 0건)**

`git merge --no-commit --no-ff origin/main` 시뮬레이션 결과, 충돌 없이 자동 병합 가능합니다.
origin/main에는 이전 backend PR 머지 커밋만 존재하여 forward-merge됩니다.

### frontend ↔ backend 프론트 파일 충돌 분석

frontend 브랜치와 backend 브랜치가 동일 페이지 파일 6개를 수정했습니다.

| 파일 | backend 변경 | frontend 변경 | 충돌 위험 |
|------|-------------|-------------|----------|
| `Result.tsx` | +57 / -103 (API 연동 + evidence 저장) | -589 (전체 삭제/재작성) | 🔴 높음 |
| `Verdict.tsx` | +115 / -16 (evidence 섹션 추가) | -501 (전체 삭제/재작성) | 🔴 높음 |
| `Input.tsx` | +43 / -17 (API 연동) | -295 (전체 삭제/재작성) | 🔴 높음 |
| `Login.tsx` | +32 / -15 (API 연동) | -148 (전체 삭제/재작성) | 🟡 중간 |
| `Signup.tsx` | +37 / -28 (API 연동) | -252 (전체 삭제/재작성) | 🟡 중간 |
| `CompanyProfile.tsx` | +85 / -16 (API 연동) | -484 (전체 삭제/재작성) | 🟡 중간 |

### 충돌 원인

frontend 브랜치는 **모든 페이지를 삭제하고 루트 경로에 재배치**했습니다:
- backend: `frontend/src/app/pages/Result.tsx`
- frontend: `src/app/pages/Result.tsx` (frontend/ 폴더 없음)

이 구조적 차이로 인해 단순 merge 시 양쪽 코드가 모두 사라질 수 있습니다.

### backend에만 존재하는 파일 (안전)

| 파일 | 설명 |
|------|------|
| `ReviewDetail.tsx` | 신규 — 충돌 없음 ✅ |
| `ReviewHistory.tsx` | 신규 — 충돌 없음 ✅ |
| `AuthGuard.tsx` | 신규 — 충돌 없음 ✅ |
| `routes.tsx` | 신규 (routes.ts → routes.tsx 교체) — 구조 변경 주의 ⚠️ |

### 권장 머지 전략

```
1단계: backend → main PR 먼저 머지 (현재 충돌 없음)
2단계: frontend → main PR 생성 시, backend 코드를 기준으로 재통합
       (frontend 팀에게 backend의 API 연동 코드를 공유)
3단계: 중간발표 전에는 backend 브랜치 기준으로 시연
```

**중간발표 시에는 backend 브랜치(또는 main에 머지된 상태)만으로 시연 가능합니다.**
frontend 브랜치와의 통합은 발표 후 진행해도 됩니다.

---

## 2. 시연 체크리스트 (발표용 요약)

### 시연 전 (5분)

```
□ PostgreSQL 실행 확인      → brew services start postgresql
□ Spring Boot 시작          → cd backend && ./gradlew bootRun
□ Python AI 서버 시작       → cd python-ai-server && python3 -m uvicorn main:app --port 8001
□ Frontend 시작             → cd frontend && npm run dev
□ 브라우저에서 localhost:5173 접속 확인
```

### 시연 흐름 (10분)

```
1. 회원가입 → 로그인                       (30초)
2. /input 에서 시나리오 1 입력 → 검토 시작  (30초)
3. /result 토론 내용 스크롤하며 설명         (2분)
   → "3명 에이전트 × 3라운드 토론"
4. 최종 판정 보기 → /verdict               (2분)
   → 위험 수준, 주요 쟁점, 수정 권고안
   → (법령·판례 근거 섹션 있으면 강조)
5. /reviews 검토 기록 목록                  (1분)
6. 상세 페이지에서 토론/판정 탭 전환         (1분)
7. 시나리오 2 빠르게 시연 (계약서 유형)      (2분)
   → "검토 유형에 따라 분석 관점 변화"
```

### 발표 중 강조 포인트

```
• "멀티에이전트가 관점별로 독립 분석 후 종합 판정"
• "3라운드에 걸쳐 분석 → 심화 → 권고 단계적 진행"
• "검토 유형(광고/계약/정책)에 따라 다른 법적 기준 적용"
• "실제 국가법령정보센터 API 연동 구조 완성 (키 설정 시 자동 활성화)"
• "장애 시 fallback으로 기본 분석은 항상 동작"
```

---

## 3. 환경변수 및 실행 가이드

### Python AI Server 실행

```bash
# 1. 의존성 설치
cd python-ai-server
pip install -r requirements.txt

# 2. 환경변수 설정 (선택)
cp .env.example .env
# .env 파일에 LAW_API_KEY 입력 (없으면 법령/판례 수집만 비활성화)

# 3. 서버 실행
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001

# 4. 헬스체크
curl http://localhost:8001/health
# → {"status":"ok","version":"0.2.0","lawApiConfigured":true/false}
```

### 환경변수 목록

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `LAW_API_KEY` | 선택 | (없음) | 국가법령정보센터 API 인증키. 없으면 evidences 빈 배열 |
| `LAW_API_BASE_URL` | 선택 | `http://www.law.go.kr/DRF/lawSearch.do` | 법령 검색 API URL |
| `CASE_API_BASE_URL` | 선택 | `http://www.law.go.kr/DRF/lawSearch.do` | 판례 검색 API URL |
| `CASE_API_KEY` | 선택 | LAW_API_KEY와 동일 | 판례 전용 API 키 |

### LAW_API_KEY 발급 절차

```
1. https://open.law.go.kr 접속
2. 회원가입 → 로그인
3. [마이페이지] → [Open API 키 신청]
4. 서비스명, 서버 IP 주소 입력
5. 발급받은 키를 python-ai-server/.env에 설정:
   LAW_API_KEY=발급받은키값
6. Python 서버 재시작
7. /health에서 lawApiConfigured: true 확인
```

### Spring Boot 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_SERVER_URL` | `http://localhost:8001` | Python AI 서버 주소 |
| `spring.datasource.url` | application.yml 참조 | PostgreSQL 접속 URL |

---

## 4. Evidence 카드 UI 개선 제안 (3개)

현재 evidence 카드가 동작은 하지만, 발표 시 가독성을 높일 수 있는 최소 개선입니다.

### 제안 1: 법령/판례 배지 색상 구분 강화 (적용 난이도: ★☆☆)

현재 `bg-blue-600`(법령) / `bg-purple-600`(판례)만 사용.

**개선:** 배지 옆에 아이콘 추가 → `Scale` (법령), `Gavel` (판례)

```tsx
// 변경 전
{ev.sourceType === "LAW" ? "법령" : "판례"}

// 변경 후
<span className="flex items-center gap-1">
  {ev.sourceType === "LAW" ? <Scale className="w-3 h-3" /> : <Gavel className="w-3 h-3" />}
  {ev.sourceType === "LAW" ? "법령" : "판례"}
</span>
```

**효과:** 프로젝터/화면 공유 시 색각 구분이 어려운 경우에도 법령/판례 구분 가능

### 제안 2: relevanceReason 강조 스타일 (적용 난이도: ★☆☆)

현재 `text-xs text-indigo-600`으로 작게 표시됨.

**개선:** 배경색 추가로 시각적 강조

```tsx
// 변경 전
<p className="text-xs text-indigo-600 mt-1">{ev.relevanceReason}</p>

// 변경 후
<p className="text-xs text-indigo-700 mt-1 bg-indigo-50 px-2 py-0.5 rounded inline-block">
  → {ev.relevanceReason}
</p>
```

**효과:** "왜 이 법령이 관련 있는지"를 시각적으로 즉시 파악 가능

### 제안 3: 카드 헤더에 총 건수 표시 (적용 난이도: ★☆☆)

현재 "법령·판례 근거"만 표시됨.

**개선:** 건수 배지 추가

```tsx
// 변경 전
<CardTitle>법령·판례 근거</CardTitle>

// 변경 후
<CardTitle className="flex items-center gap-2">
  <BookOpen className="w-5 h-5 text-indigo-600" />
  법령·판례 근거
  <Badge variant="outline" className="text-xs">{evidences.length}건</Badge>
</CardTitle>
```

**효과:** 발표 시 "총 N건의 관련 법령/판례를 자동으로 찾아냈습니다"라고 설명 가능

> **참고:** 위 3개 모두 1줄~3줄 수정이며 발표 전에 필요하면 즉시 적용 가능합니다.
> 발표 당일에 시간 여유가 있으면 적용하고, 없으면 현재 상태로도 충분합니다.

---

## 5. 개발 우선순위

### 🔴 중간발표 전 필수

| # | 작업 | 소요 | 담당 |
|---|------|------|------|
| 1 | `git push origin backend` | 1분 | 본인 |
| 2 | GitHub에서 backend → main PR 생성 & 머지 | 5분 | 본인 |
| 3 | 시연 시나리오 3개 사전 실행 테스트 | 15분 | 본인 |
| 4 | 발표 당일 서버 3개 실행 순서 확인 | 5분 | 본인 |

### 🟡 중간발표 전 선택 (시간 여유 시)

| # | 작업 | 소요 | 효과 |
|---|------|------|------|
| 5 | LAW_API_KEY 발급 & 실제 법령 표시 | 30분 | 실제 법률 데이터 시연 가능 |
| 6 | Evidence 카드 UI 미세 개선 (위 제안 1~3) | 10분 | 발표 가독성 향상 |
| 7 | 시연 시 사용할 테스트 계정 미리 생성 | 5분 | 시연 시간 절약 |

### 🔵 발표 후 확장

| # | 작업 | 설명 |
|---|------|------|
| 1 | frontend 브랜치 통합 | 프론트팀 UI와 backend API 연동 코드 병합 |
| 2 | LLM 연동 | 규칙 기반 → OpenAI/Claude API로 교체 |
| 3 | 참여 모드 구현 | 사용자 의견 반영 토론 |
| 4 | JWT 인증 | X-User-Id → 실제 토큰 기반 인증 |
| 5 | 판례 상세 조회 | 판시사항/판결요지까지 가져오기 |
| 6 | PDF 보고서 생성 | 최종 판정 PDF 다운로드 |
| 7 | Docker Compose 배포 | 원클릭 실행 환경 |
