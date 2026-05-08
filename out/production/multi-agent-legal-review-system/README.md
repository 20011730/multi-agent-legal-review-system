# Legal Review AI Server

법률 검토 멀티에이전트 분석 서버 (Python FastAPI)

## 실행 방법

```bash
cd python-ai-server

# 가상환경 생성 및 활성화
python3 -m venv venv
source venv/bin/activate

# 의존성 설치
pip install -r requirements.txt

# 서버 실행 (포트 8001)
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## 엔드포인트

### GET /health
서버 상태 확인

### POST /analyze
법률 검토 분석 수행

**요청 예시:**
```bash
curl -X POST http://localhost:8001/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": 1,
    "companyName": "ABC Tech",
    "industry": "tech",
    "reviewType": "marketing",
    "situation": "신제품 광고 문구 검토",
    "content": "업계 1위 제품보다 2배 빠른 성능! 타사 제품은 구시대 유물입니다.",
    "participationMode": "observe"
  }'
```

## 전체 연동 테스트

1. Python AI 서버 실행: `uvicorn main:app --port 8001 --reload`
2. Spring Boot 백엔드 실행: `cd ../backend && ./gradlew bootRun`
3. 프론트엔드 실행: `cd ../frontend && npm run dev`
4. 브라우저에서 http://localhost:5173 접속 → /input → /result → /verdict 흐름 확인
