package com.legalreview.service.startup;

import com.legalreview.dto.startup.StartupSupportItem;
import com.legalreview.dto.startup.StartupSupportListResponse;
import com.legalreview.dto.startup.StartupSupportListResponse.AppliedFilters;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 스타트업 지원사업 정보 서비스 (Phase 3 — provider 분리).
 *
 * Phase 2 까지는 본 서비스가 직접 mock 데이터를 보유했으나, Phase 3 에서는
 * {@link StartupSupportProvider} 인터페이스에 위임한다.
 *
 * 현재 활성 provider: {@link StartupSupportMockProvider} (단일 Bean).
 * 추후 외부 API / DB provider 추가 시 본 서비스 코드는 그대로 두고 provider 만 교체.
 *
 * 향후 확장 포인트 (이번 turn 미구현, 설계만 명시):
 *   - findAll() 결과를 응답 메타 (source / count / lastUpdated) 와 함께 감싸는 ResponseEnvelope 도입 가능.
 *     단, 현재는 frontend StartupSupport.tsx 가 배열을 직접 받는 구조라 응답 형식은 유지.
 *   - 필터 query parameter (category/region/status) 지원 시 본 서비스에 filter(...) 메서드 추가.
 *   - 캐싱 (Caffeine 등) 도입 시 본 서비스 또는 provider 레이어에서 처리.
 */
@Service
@RequiredArgsConstructor
public class StartupSupportService {

    private final StartupSupportProvider provider;

    public List<StartupSupportItem> findAll() {
        return provider.findAll();
    }

    /**
     * 선택적 필터링 (Phase 3 — backend 필터 query parameter 지원).
     *
     * 모든 인자가 null/blank 면 {@link #findAll()} 과 동일 결과 (15건 전체).
     *
     * 필터 규칙:
     *   - category: trim 후 정확 일치 (예: "R&D", "법률·세무·노무")
     *   - status:   trim 후 정확 일치 (예: "마감임박", "모집중", "상시모집")
     *   - region:   trim 후 정확 일치 또는 item.region 이 "전국" 이면 항상 통과
     *               (전국 사업은 어느 지역 필터에도 노출되는 것이 자연스러움)
     *   - keyword:  trim 후 case-insensitive contains 매칭. title/organization/target/
     *               fieldSummary/recommendReason 중 어느 하나라도 매칭되면 통과
     */
    public List<StartupSupportItem> findAll(String category, String status, String region, String keyword) {
        String cat = normalize(category);
        String st  = normalize(status);
        String rg  = normalize(region);
        String kw  = normalize(keyword);
        if (cat.isEmpty() && st.isEmpty() && rg.isEmpty() && kw.isEmpty()) {
            return provider.findAll();
        }
        String kwLower = kw.toLowerCase();
        return provider.findAll().stream()
                .filter(item -> cat.isEmpty() || cat.equals(item.category()))
                .filter(item -> st.isEmpty() || st.equals(item.status()))
                .filter(item -> rg.isEmpty() || rg.equals(item.region()) || "전국".equals(item.region()))
                .filter(item -> kw.isEmpty() || matchesKeyword(item, kwLower))
                .collect(Collectors.toList());
    }

    private static boolean matchesKeyword(StartupSupportItem item, String kwLower) {
        return containsLower(item.title(), kwLower)
                || containsLower(item.organization(), kwLower)
                || containsLower(item.target(), kwLower)
                || containsLower(item.fieldSummary(), kwLower)
                || containsLower(item.recommendReason(), kwLower);
    }

    private static boolean containsLower(String haystack, String needleLower) {
        return haystack != null && haystack.toLowerCase().contains(needleLower);
    }

    private static String normalize(String v) {
        return v == null ? "" : v.trim();
    }

    public Optional<StartupSupportItem> findById(String id) {
        return provider.findById(id);
    }

    /** 현재 데이터 출처 식별자 (로깅·디버그 + envelope 응답 source 필드용). */
    public String currentSource() {
        return provider.sourceName();
    }

    /**
     * 응답 envelope 생성 (Phase 5).
     * items 는 {@link #findAll(String, String, String, String)} 결과 그대로,
     * source 는 provider 가 알려준 식별자, lastUpdated 는 호출 시점 now(),
     * filters 는 입력값 그대로 echo (blank → null).
     */
    public StartupSupportListResponse findAllEnvelope(String category, String status, String region, String keyword) {
        List<StartupSupportItem> items = findAll(category, status, region, keyword);
        return new StartupSupportListResponse(
                items,
                currentSource(),
                items.size(),
                Instant.now(),
                AppliedFilters.of(category, status, region, keyword)
        );
    }
}
