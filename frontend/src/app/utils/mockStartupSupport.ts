/**
 * mockStartupSupport.ts — 프론트 mock 정적 데이터.
 *
 * 정책 (Phase 1):
 *   - 실제 K-Startup / 공공데이터포털 API 호출 없음
 *   - TypeScript 상수 — 빌드 타임 포함
 *   - 추후 Phase 2 에서 backend /api/startup-support/* 로 fetch 전환 가능
 *
 * 참고용 출처 (mock 작성 시 참고만, 실제 API 미연동):
 *   - K-Startup (창업진흥원)
 *   - 중소벤처기업부 정책자금
 *   - TIPS / 팁스 R&D
 *   - 대중소기업·농어업협력재단
 *   - 서울시 / 경기도 / 부산 등 지자체 창업지원
 */

export type SupportCategory =
  | "사업화"
  | "정책자금"
  | "R&D"
  | "멘토링"
  | "창업교육"
  | "법률·세무·노무"
  | "투자/IR";

export type SupportStatus = "마감임박" | "모집중" | "상시모집" | "모집마감" | "확인 필요" | "마감";

export interface SupportItem {
  id: string;
  title: string;
  organization: string;          // 주관기관
  category: SupportCategory;     // ← inferred(추론) 카테고리 (필터 기준)
  region: string;                // 전국 / 서울 / 경기 / ...
  target: string;                // 지원대상 (예: 예비창업자, 7년 이내 창업기업 등)
  fieldSummary: string;          // 지원분야 요약
  maxAmount: string;             // 지원금/한도 (문자열, 표시 그대로)
  status: SupportStatus;
  deadline: string;              // YYYY.MM.DD 또는 "상시"
  applyUrl: string;              // 실제 신청 페이지 (mock URL OK)
  recommendReason: string;       // 추천 이유 — 비서/큐레이션 톤
  /** provider 원본 카테고리 (Phase 9.6, 없을 수 있음) */
  rawCategory?: string;
  /** backend 가 제시한 추천/insight 힌트 카테고리 (Phase 9.6, 없을 수 있음) */
  aiInsightHint?: string;
  /** 항목별 출처 (Phase 9.8): "k-startup-news" / "k-startup-service" / "mock" */
  itemSource?: string;
}

export const SUPPORT_CATEGORIES: SupportCategory[] = [
  "사업화",
  "정책자금",
  "R&D",
  "멘토링",
  "창업교육",
  "법률·세무·노무",
  "투자/IR",
];

export const SUPPORT_REGIONS: string[] = [
  "전국",
  "서울",
  "경기",
  "인천",
  "부산",
  "대구",
  "광주",
  "대전",
  "세종",
  "강원",
];

export const MOCK_SUPPORT_ITEMS: SupportItem[] = [
  {
    id: "supp-001",
    title: "예비창업패키지 2026 신규 모집",
    organization: "창업진흥원",
    category: "사업화",
    region: "전국",
    target: "예비창업자 (사업자등록 전)",
    fieldSummary: "사업화 자금 + 멘토링 + 시제품 제작",
    maxAmount: "최대 1억 원",
    status: "모집중",
    deadline: "2026.06.15",
    applyUrl: "https://www.k-startup.go.kr/",
    recommendReason: "초기 아이디어가 있고 사업자등록 전이라면 가장 표준적인 출발점입니다.",
  },
  {
    id: "supp-002",
    title: "초기창업패키지 2026",
    organization: "창업진흥원",
    category: "사업화",
    region: "전국",
    target: "창업 3년 이내 기업",
    fieldSummary: "사업화 자금 + 시장 진입 지원",
    maxAmount: "최대 1억 원",
    status: "모집중",
    deadline: "2026.06.30",
    applyUrl: "https://www.k-startup.go.kr/",
    recommendReason: "MVP 출시 후 시장 검증이 필요한 단계에 적합합니다.",
  },
  {
    id: "supp-003",
    title: "청년창업사관학교 16기",
    organization: "중소벤처기업진흥공단",
    category: "사업화",
    region: "전국",
    target: "만 39세 이하, 창업 3년 이내",
    fieldSummary: "1년간 입주 + 사업화 자금 + 전담 코칭",
    maxAmount: "최대 1억 원",
    status: "마감임박",
    deadline: "2026.05.30",
    applyUrl: "https://start.kosmes.or.kr/",
    recommendReason: "청년 창업자에게 가장 종합 지원이 강한 프로그램입니다.",
  },
  {
    id: "supp-004",
    title: "중소기업 정책자금 운전자금 융자",
    organization: "중소벤처기업진흥공단",
    category: "정책자금",
    region: "전국",
    target: "중소기업 (업력 무관)",
    fieldSummary: "운전자금/시설자금 융자, 저금리",
    maxAmount: "기업당 최대 10억 원",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.kosmes.or.kr/",
    recommendReason: "매출이 발생 중인 스타트업의 현금흐름 안정화에 적합합니다.",
  },
  {
    id: "supp-005",
    title: "기술보증기금 청년창업 특례보증",
    organization: "기술보증기금",
    category: "정책자금",
    region: "전국",
    target: "만 39세 이하 창업자",
    fieldSummary: "보증서 발급으로 시중은행 대출 연계",
    maxAmount: "최대 3억 원 보증",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.kibo.or.kr/",
    recommendReason: "은행권 대출이 막혀있는 초기 청년 창업자에게 유효합니다.",
  },
  {
    id: "supp-006",
    title: "TIPS (민간투자주도형 R&D)",
    organization: "중소벤처기업부",
    category: "R&D",
    region: "전국",
    target: "TIPS 운영사로부터 투자받은 7년 이내 기업",
    fieldSummary: "최대 2년 R&D 자금 + 사업화 자금",
    maxAmount: "최대 7억 원 (R&D 5억 + 사업화 2억)",
    status: "모집중",
    deadline: "2026.07.31",
    applyUrl: "https://www.jointips.or.kr/",
    recommendReason: "딥테크/기술 기반 창업이라면 본 프로그램이 가장 큰 R&D 펀딩 통로입니다.",
  },
  {
    id: "supp-007",
    title: "창업성장기술개발사업 (디딤돌)",
    organization: "중소벤처기업부",
    category: "R&D",
    region: "전국",
    target: "창업 7년 이내 기업",
    fieldSummary: "1년 R&D 자금",
    maxAmount: "최대 1.2억 원",
    status: "마감임박",
    deadline: "2026.05.25",
    applyUrl: "https://www.smtech.go.kr/",
    recommendReason: "초기 R&D 검증이 필요한 단계의 표준 트랙입니다.",
  },
  {
    id: "supp-008",
    title: "1:1 전담 멘토링 (창업멘토링협의회)",
    organization: "창업진흥원",
    category: "멘토링",
    region: "전국",
    target: "예비/초기 창업자",
    fieldSummary: "분야별 (마케팅/기술/투자) 전담 멘토 매칭",
    maxAmount: "무료",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.k-startup.go.kr/",
    recommendReason: "직접 자금 지원은 없지만 의사결정 보조용으로 유효합니다.",
  },
  {
    id: "supp-009",
    title: "스타트업 부트캠프 (스파크랩 · 디캠프 · 매쉬업엔젤스 등 공통 연계)",
    organization: "민간 액셀러레이터 연합",
    category: "멘토링",
    region: "서울",
    target: "초기 창업팀",
    fieldSummary: "3개월 부트캠프 + Demo Day + 초기 시드 투자 연계",
    maxAmount: "5천만 원 ~ 2억 원 (참여사별 상이)",
    status: "모집중",
    deadline: "2026.06.20",
    applyUrl: "https://dcamp.kr/",
    recommendReason: "초기 시드를 빠르게 받고 네트워크를 확보하려는 팀에 적합.",
  },
  {
    id: "supp-010",
    title: "K-Startup 창업교육 온라인 강좌",
    organization: "창업진흥원",
    category: "창업교육",
    region: "전국",
    target: "예비/초기 창업자",
    fieldSummary: "BM/마케팅/재무/투자 등 100+ 강좌",
    maxAmount: "무료",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.k-startup.go.kr/",
    recommendReason: "사업 시작 전 기본기 점검에 유용합니다.",
  },
  {
    id: "supp-011",
    title: "법률·세무·노무 1:1 무료상담",
    organization: "중소벤처기업부 · 창업진흥원",
    category: "법률·세무·노무",
    region: "전국",
    target: "예비/창업기업",
    fieldSummary: "변호사/회계사/세무사/노무사 전문가 상담",
    maxAmount: "회당 무료 (월 2회 한도)",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.k-startup.go.kr/",
    recommendReason: "본 서비스의 법률 검토 결과를 변호사 의견으로 보강하고 싶을 때 활용 가능합니다.",
  },
  {
    id: "supp-012",
    title: "스타트업 표준계약서 / 약관 검토 지원",
    organization: "한국공정거래조정원",
    category: "법률·세무·노무",
    region: "전국",
    target: "중소기업/스타트업",
    fieldSummary: "약관·하도급계약 사전심사 + 공정거래법 가이드",
    maxAmount: "무료",
    status: "상시모집",
    deadline: "상시",
    applyUrl: "https://www.kofair.or.kr/",
    recommendReason: "B2B 계약서/약관에 들어가는 불공정 조항을 사전 점검할 때 유효합니다.",
  },
  {
    id: "supp-013",
    title: "IR Day · 투자 매칭 (KVIC 모태펀드 연계)",
    organization: "한국벤처투자",
    category: "투자/IR",
    region: "전국",
    target: "시리즈 A 직전~중 단계 스타트업",
    fieldSummary: "VC 매칭 IR Day + 사후 follow-up",
    maxAmount: "투자 라운드별 상이",
    status: "모집중",
    deadline: "2026.07.10",
    applyUrl: "https://www.kvic.or.kr/",
    recommendReason: "PMF 검증 후 본격 라운드 진입 직전 단계 팀에 적합.",
  },
  {
    id: "supp-014",
    title: "서울창업허브 입주기업 모집",
    organization: "서울특별시",
    category: "사업화",
    region: "서울",
    target: "창업 7년 이내 기업",
    fieldSummary: "무료 입주 공간 + 멘토링 + IR 지원",
    maxAmount: "공간 + 운영지원 (현금성 지원 별도)",
    status: "마감임박",
    deadline: "2026.05.31",
    applyUrl: "https://www.seoulstartuphub.com/",
    recommendReason: "서울 기반 팀이 사무공간 + 네트워크를 동시에 확보하려 할 때.",
  },
  {
    id: "supp-015",
    title: "지식재산권 출원 비용 지원 (특허·상표)",
    organization: "한국발명진흥회",
    category: "법률·세무·노무",
    region: "전국",
    target: "중소기업/스타트업",
    fieldSummary: "특허/실용신안/상표/디자인 출원료 일부 지원",
    maxAmount: "건당 최대 200만 원",
    status: "모집중",
    deadline: "2026.08.31",
    applyUrl: "https://www.kipa.org/",
    recommendReason: "브랜드/기술 권리화 비용 부담을 줄이고 싶을 때.",
  },
];
