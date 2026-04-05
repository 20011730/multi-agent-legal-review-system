# PR Draft: backend → main

> push 후 아래 내용으로 PR을 생성하세요.

---

## PR Title

```
feat: 백엔드 MVP 완성 — AI 분석, 법령/판례 근거, 검토 기록 재열람
```

## PR Body

아래를 그대로 복사하여 PR 본문에 붙여넣으세요.

---

## Summary

백엔드 MVP 전체 기능을 구현하여 중간발표 시연 가능 상태로 완성했습니다.

**핵심 흐름:** `/input` → `/result` → `/verdict` 전체 연동 완료

### 이번 PR에서 구현한 기능

- **Spring Boot 세션 API**: `POST /api/sessions`, `GET /api/sessions/{id}/debates/latest`
- **PostgreSQL 영구 저장**: 메모리 → DB 마이그레이션 (세션, 토론, 판정, 근거)
- **회원가입/로그인**: BCrypt 암호화, X-User-Id 헤더 기반 사용자 연동
- **프로필 관리**: 사용자 정보 조회/수정, 비밀번호 변경
- **검토 기록 재열람**: `GET /api/reviews`, `GET /api/reviews/{id}` (목록 + 상세)
- **Python AI 서버**: FastAPI 기반 규칙 분석 엔진 (3라운드 × 3에이전트 토론)
- **법령/판례 근거 수집**: 국가법령정보센터 Open API 연동 모듈
- **Evidence 저장/응답**: DB 영구 저장 + 두 API 모두 evidences 필드 포함
- **프론트 근거 표시**: Verdict, ReviewDetail 페이지에 법령·판례 카드 렌더링

### Evidence 저장/응답/렌더링 구조

```
[Python AI Server]
  └─ evidence_service.py
       ├─ extract_keywords()     → 키워드 추출
       ├─ search_laws()          → 국가법령정보센터 법령 검색
       ├─ search_cases()         → 국가법령정보센터 판례 검색
       └─ rank_evidences()       → 관련도 점수 기반 상위 N건 선정
            ↓
[Spring Boot Backend]
  └─ SessionService.java
       ├─ saveEvidences()        → Evidence 엔티티 DB 저장
       └─ loadEvidenceDtos()     → DB에서 조회 후 DTO 변환
            ↓
[Frontend]
  ├─ Result.tsx                  → evidences를 sessionStorage에 저장
  ├─ Verdict.tsx                 → sessionStorage에서 읽어 카드 렌더링
  └─ ReviewDetail.tsx            → API 응답에서 직접 읽어 카드 렌더링
```

### Fallback 정책 요약

| 상황 | 동작 | 영향 |
|------|------|------|
| LAW_API_KEY 미설정 | evidences: [] 반환 | 근거 섹션 자동 숨김, 분석 정상 |
| 국가법령정보센터 API 오류/타임아웃 | evidences: [] 반환 | 동일 |
| Python AI 서버 다운 | Spring Boot 더미 데이터 반환 | 전체 흐름 정상, evidences 없음 |
| Evidence DB 0건 | API 응답 evidences: [] | 프론트 자동 숨김 |

**핵심:** 어떤 장애 상황에서도 `/input → /result → /verdict` 흐름은 절대 깨지지 않음

### LAW_API_KEY 없을 때 현재 동작

- Python AI 서버 `/health`에서 `lawApiConfigured: false` 표시
- 분석 요청 시 `messages`(9개)와 `finalDecision`은 정상 생성
- `evidences`는 빈 배열 `[]` — 프론트에서 근거 섹션이 자동 숨겨짐
- 기존 모든 기능은 100% 정상 동작

### 실제 운영 전 남은 작업

- [ ] 국가법령정보센터 API 키 발급 (https://open.law.go.kr)
- [ ] 발급 시 서버 IP 주소 등록
- [ ] `python-ai-server/.env`에 `LAW_API_KEY=발급키` 설정
- [ ] 실제 법령/판례 데이터 반환 확인
- [ ] 시연 시나리오 3개 사전 테스트

## Test plan

- [x] `/input` → `/result` → `/verdict` 전체 흐름 브라우저 테스트
- [x] 검토 기록 목록 `/reviews` 페이지 확인
- [x] 검토 상세 `/reviews/:id` 페이지 (토론 탭 + 판정 탭) 확인
- [x] LAW_API_KEY 없는 상태에서 fallback 정상 동작 확인
- [x] 더미 evidence 데이터 주입 시 프론트 렌더링 확인
- [x] Python AI 서버 다운 시 Spring Boot fallback 확인
- [x] 빌드 성공 확인 (프론트 + 백엔드)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
