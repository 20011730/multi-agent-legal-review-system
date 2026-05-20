package com.legalreview.service.startup;

import com.legalreview.dto.startup.StartupSupportItem;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * 정적 mock 데이터 기반 {@link StartupSupportProvider} 구현 (Phase 3).
 *
 * Phase 1 frontend mock (mockStartupSupport.ts) → Phase 2 service 내부 mock →
 * Phase 3 분리된 provider 로 이관.
 *
 * 데이터 내용은 Phase 2 그대로 — id/title/category/status/region/target/fieldSummary/
 * maxAmount/deadline/applyUrl/recommendReason 모두 동일.
 *
 * 향후 KStartupApiProvider 등이 추가되면 본 클래스는 fallback 또는 dev profile 전용으로 유지 가능.
 */
@Component
public class StartupSupportMockProvider implements StartupSupportProvider {
    // Phase 8: 항상 등록되는 @Component 로 전환.
    //   - provider=mock (기본): 유일한 StartupSupportProvider Bean → 자동 주입
    //   - provider=k-startup: KStartupProvider 가 @Primary 로 우선 주입, 본 클래스는 fallback DI 대상
    //   - 두 Bean 동시 존재 시 service 는 @Primary 가 붙은 KStartupProvider 를 자동 선택
    //   - 본 클래스는 항상 직접 클래스 타입(StartupSupportMockProvider) 으로 주입 가능 → fallback 안전

    private static final List<StartupSupportItem> ITEMS = buildItems();

    @Override
    public List<StartupSupportItem> findAll() {
        return ITEMS;
    }

    @Override
    public Optional<StartupSupportItem> findById(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        return ITEMS.stream().filter(i -> id.equals(i.id())).findFirst();
    }

    @Override
    public String sourceName() {
        return "mock";
    }

    private static List<StartupSupportItem> buildItems() {
        return List.of(
                new StartupSupportItem(
                        "supp-001",
                        "예비창업패키지 2026 신규 모집",
                        "창업진흥원",
                        "사업화",
                        "전국",
                        "예비창업자 (사업자등록 전)",
                        "사업화 자금 + 멘토링 + 시제품 제작",
                        "최대 1억 원",
                        "모집중",
                        "2026.06.15",
                        "https://www.k-startup.go.kr/",
                        "초기 아이디어가 있고 사업자등록 전이라면 가장 표준적인 출발점입니다."
                ),
                new StartupSupportItem(
                        "supp-002",
                        "초기창업패키지 2026",
                        "창업진흥원",
                        "사업화",
                        "전국",
                        "창업 3년 이내 기업",
                        "사업화 자금 + 시장 진입 지원",
                        "최대 1억 원",
                        "모집중",
                        "2026.06.30",
                        "https://www.k-startup.go.kr/",
                        "MVP 출시 후 시장 검증이 필요한 단계에 적합합니다."
                ),
                new StartupSupportItem(
                        "supp-003",
                        "청년창업사관학교 16기",
                        "중소벤처기업진흥공단",
                        "사업화",
                        "전국",
                        "만 39세 이하, 창업 3년 이내",
                        "1년간 입주 + 사업화 자금 + 전담 코칭",
                        "최대 1억 원",
                        "마감임박",
                        "2026.05.30",
                        "https://start.kosmes.or.kr/",
                        "청년 창업자에게 가장 종합 지원이 강한 프로그램입니다."
                ),
                new StartupSupportItem(
                        "supp-004",
                        "중소기업 정책자금 운전자금 융자",
                        "중소벤처기업진흥공단",
                        "정책자금",
                        "전국",
                        "중소기업 (업력 무관)",
                        "운전자금/시설자금 융자, 저금리",
                        "기업당 최대 10억 원",
                        "상시모집",
                        "상시",
                        "https://www.kosmes.or.kr/",
                        "매출이 발생 중인 스타트업의 현금흐름 안정화에 적합합니다."
                ),
                new StartupSupportItem(
                        "supp-005",
                        "기술보증기금 청년창업 특례보증",
                        "기술보증기금",
                        "정책자금",
                        "전국",
                        "만 39세 이하 창업자",
                        "보증서 발급으로 시중은행 대출 연계",
                        "최대 3억 원 보증",
                        "상시모집",
                        "상시",
                        "https://www.kibo.or.kr/",
                        "은행권 대출이 막혀있는 초기 청년 창업자에게 유효합니다."
                ),
                new StartupSupportItem(
                        "supp-006",
                        "TIPS (민간투자주도형 R&D)",
                        "중소벤처기업부",
                        "R&D",
                        "전국",
                        "TIPS 운영사로부터 투자받은 7년 이내 기업",
                        "최대 2년 R&D 자금 + 사업화 자금",
                        "최대 7억 원 (R&D 5억 + 사업화 2억)",
                        "모집중",
                        "2026.07.31",
                        "https://www.jointips.or.kr/",
                        "딥테크/기술 기반 창업이라면 본 프로그램이 가장 큰 R&D 펀딩 통로입니다."
                ),
                new StartupSupportItem(
                        "supp-007",
                        "창업성장기술개발사업 (디딤돌)",
                        "중소벤처기업부",
                        "R&D",
                        "전국",
                        "창업 7년 이내 기업",
                        "1년 R&D 자금",
                        "최대 1.2억 원",
                        "마감임박",
                        "2026.05.25",
                        "https://www.smtech.go.kr/",
                        "초기 R&D 검증이 필요한 단계의 표준 트랙입니다."
                ),
                new StartupSupportItem(
                        "supp-008",
                        "1:1 전담 멘토링 (창업멘토링협의회)",
                        "창업진흥원",
                        "멘토링",
                        "전국",
                        "예비/초기 창업자",
                        "분야별 (마케팅/기술/투자) 전담 멘토 매칭",
                        "무료",
                        "상시모집",
                        "상시",
                        "https://www.k-startup.go.kr/",
                        "직접 자금 지원은 없지만 의사결정 보조용으로 유효합니다."
                ),
                new StartupSupportItem(
                        "supp-009",
                        "스타트업 부트캠프 (스파크랩 · 디캠프 · 매쉬업엔젤스 등 공통 연계)",
                        "민간 액셀러레이터 연합",
                        "멘토링",
                        "서울",
                        "초기 창업팀",
                        "3개월 부트캠프 + Demo Day + 초기 시드 투자 연계",
                        "5천만 원 ~ 2억 원 (참여사별 상이)",
                        "모집중",
                        "2026.06.20",
                        "https://dcamp.kr/",
                        "초기 시드를 빠르게 받고 네트워크를 확보하려는 팀에 적합."
                ),
                new StartupSupportItem(
                        "supp-010",
                        "K-Startup 창업교육 온라인 강좌",
                        "창업진흥원",
                        "창업교육",
                        "전국",
                        "예비/초기 창업자",
                        "BM/마케팅/재무/투자 등 100+ 강좌",
                        "무료",
                        "상시모집",
                        "상시",
                        "https://www.k-startup.go.kr/",
                        "사업 시작 전 기본기 점검에 유용합니다."
                ),
                new StartupSupportItem(
                        "supp-011",
                        "법률·세무·노무 1:1 무료상담",
                        "중소벤처기업부 · 창업진흥원",
                        "법률·세무·노무",
                        "전국",
                        "예비/창업기업",
                        "변호사/회계사/세무사/노무사 전문가 상담",
                        "회당 무료 (월 2회 한도)",
                        "상시모집",
                        "상시",
                        "https://www.k-startup.go.kr/",
                        "본 서비스의 법률 검토 결과를 변호사 의견으로 보강하고 싶을 때 활용 가능합니다."
                ),
                new StartupSupportItem(
                        "supp-012",
                        "스타트업 표준계약서 / 약관 검토 지원",
                        "한국공정거래조정원",
                        "법률·세무·노무",
                        "전국",
                        "중소기업/스타트업",
                        "약관·하도급계약 사전심사 + 공정거래법 가이드",
                        "무료",
                        "상시모집",
                        "상시",
                        "https://www.kofair.or.kr/",
                        "B2B 계약서/약관에 들어가는 불공정 조항을 사전 점검할 때 유효합니다."
                ),
                new StartupSupportItem(
                        "supp-013",
                        "IR Day · 투자 매칭 (KVIC 모태펀드 연계)",
                        "한국벤처투자",
                        "투자/IR",
                        "전국",
                        "시리즈 A 직전~중 단계 스타트업",
                        "VC 매칭 IR Day + 사후 follow-up",
                        "투자 라운드별 상이",
                        "모집중",
                        "2026.07.10",
                        "https://www.kvic.or.kr/",
                        "PMF 검증 후 본격 라운드 진입 직전 단계 팀에 적합."
                ),
                new StartupSupportItem(
                        "supp-014",
                        "서울창업허브 입주기업 모집",
                        "서울특별시",
                        "사업화",
                        "서울",
                        "창업 7년 이내 기업",
                        "무료 입주 공간 + 멘토링 + IR 지원",
                        "공간 + 운영지원 (현금성 지원 별도)",
                        "마감임박",
                        "2026.05.31",
                        "https://www.seoulstartuphub.com/",
                        "서울 기반 팀이 사무공간 + 네트워크를 동시에 확보하려 할 때."
                ),
                new StartupSupportItem(
                        "supp-015",
                        "지식재산권 출원 비용 지원 (특허·상표)",
                        "한국발명진흥회",
                        "법률·세무·노무",
                        "전국",
                        "중소기업/스타트업",
                        "특허/실용신안/상표/디자인 출원료 일부 지원",
                        "건당 최대 200만 원",
                        "모집중",
                        "2026.08.31",
                        "https://www.kipa.org/",
                        "브랜드/기술 권리화 비용 부담을 줄이고 싶을 때."
                )
        );
    }
}
