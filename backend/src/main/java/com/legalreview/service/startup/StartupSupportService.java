package com.legalreview.service.startup;

import com.legalreview.dto.startup.StartupSupportItem;
import com.legalreview.dto.startup.StartupSupportItemView;
import com.legalreview.dto.startup.StartupSupportListResponse;
import com.legalreview.dto.startup.StartupSupportListResponse.AppliedFilters;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 스타트업 지원사업 정보 서비스 (Phase 9.6 — enrichment + pagination + sort).
 *
 * <p>흐름:
 * <ol>
 *   <li>provider 에서 raw items 받음</li>
 *   <li>각 item 에 대해 inferredCategory + autoStatus 계산 (rawCategory 보존)</li>
 *   <li>필터 적용 (category 는 inferredCategory 기준)</li>
 *   <li>sort 적용</li>
 *   <li>pagination 적용</li>
 *   <li>{@link StartupSupportItemView} 로 변환하여 envelope 반환</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class StartupSupportService {

    private final StartupSupportProvider provider;

    public List<StartupSupportItem> findAll() {
        return provider.findAll();
    }

    /** 단건 조회 — id 검색은 provider 가 담당. */
    public Optional<StartupSupportItem> findById(String id) {
        return provider.findById(id);
    }

    /** 현재 데이터 출처 식별자. */
    public String currentSource() {
        return provider.sourceName();
    }

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;

    /**
     * 응답 envelope 생성 (page/size/sort 신규).
     * @param sort  null/blank → "latest" (deadline 내림차순 + 마감 후순위)
     */
    public StartupSupportListResponse findAllEnvelope(
            String category, String status, String region, String keyword,
            String sort, Integer pageReq, Integer sizeReq
    ) {
        int size = sizeReq == null ? DEFAULT_SIZE : Math.max(1, Math.min(MAX_SIZE, sizeReq));
        int page = pageReq == null ? 1 : Math.max(1, pageReq);
        // Phase 9.9 — 기본 정렬을 "activeFirst" (모집중 우선) 로 변경 + 신규 sort key 지원
        String sortKey = (sort == null || sort.isBlank()) ? "activefirst" : sort.trim().toLowerCase(Locale.KOREA);

        // 1. provider 호출 (전체 — 외부 API 페이지네이션은 provider 내부에서 처리)
        List<StartupSupportItem> raw = provider.findAll();

        // 2. enrichment (inferred category + auto status)
        record Enriched(StartupSupportItem base, String inferred, String autoStatus) {}
        List<Enriched> enriched = new ArrayList<>(raw.size());
        for (StartupSupportItem it : raw) {
            String inferred = StartupSupportEnricher.inferCategory(it);
            String autoStat = StartupSupportEnricher.autoStatus(it);
            enriched.add(new Enriched(it, inferred, autoStat));
        }

        // 3. filter
        String cat = normalize(category);
        String st  = normalize(status);
        String rg  = normalize(region);
        String kw  = normalize(keyword);
        String kwLower = kw.toLowerCase(Locale.KOREA);
        List<Enriched> filtered = new ArrayList<>(enriched.size());
        for (Enriched e : enriched) {
            if (!cat.isEmpty() && !cat.equals(e.inferred())) continue;
            // Phase 9.13 — status=모집중 필터에서는 상시모집 항목도 포함 (상시는 모집중의 하위 성격)
            if (!st.isEmpty()) {
                String auto = e.autoStatus();
                boolean ok = st.equals(auto)
                        || ("모집중".equals(st) && "상시모집".equals(auto));
                if (!ok) continue;
            }
            StartupSupportItem b = e.base();
            if (!rg.isEmpty() && !rg.equals(b.region()) && !"전국".equals(b.region())) continue;
            if (!kw.isEmpty() && !matchesKeyword(b, kwLower)) continue;
            filtered.add(e);
        }

        // 4. sort (Phase 9.9 신규 옵션 — activefirst / recentclosed)
        Comparator<Enriched> byDeadlineAsc = Comparator.comparing(
                (Enriched e) -> parseDateForSort(e.base().deadline()),
                Comparator.nullsLast(Comparator.naturalOrder()));
        Comparator<Enriched> byDeadlineDesc = Comparator.comparing(
                (Enriched e) -> parseDateForSort(e.base().deadline()),
                Comparator.nullsLast(Comparator.reverseOrder()));
        Comparator<Enriched> byStatusGroup = Comparator.comparingInt(
                (Enriched e) -> StartupSupportEnricher.statusGroupOrder(e.autoStatus()));
        Comparator<Enriched> comparator = switch (sortKey) {
            case "deadline" -> // 마감 임박순 — 모집중인 항목의 deadline 오름차순, 마감은 뒤로
                    byStatusGroup.thenComparing(byDeadlineAsc);
            case "title" -> Comparator.comparing(
                    (Enriched e) -> e.base().title() == null ? "" : e.base().title());
            case "recommend" -> Comparator.comparingInt(
                    (Enriched e) -> -StartupSupportEnricher.recommendScore(e.base()));
            case "latest" -> byDeadlineDesc; // 등록일자 desc (현 데이터 deadline=등록일자)
            case "recentclosed" -> // 최근 마감순 — 모집마감 항목 중 deadline desc
                    byStatusGroup.thenComparing(byDeadlineDesc);
            case "activefirst" ->
                    byStatusGroup.thenComparing(byDeadlineDesc);
            default -> byStatusGroup.thenComparing(byDeadlineDesc);
        };
        filtered.sort(comparator);

        // 5. paginate
        int totalCount = filtered.size();
        int totalPages = Math.max(1, (int) Math.ceil((double) totalCount / size));
        int safePage = Math.min(page, totalPages);
        int from = (safePage - 1) * size;
        int to = Math.min(from + size, totalCount);
        List<Enriched> pageSlice = from >= to ? List.of() : filtered.subList(from, to);

        // 6. convert to view
        List<StartupSupportItemView> views = new ArrayList<>(pageSlice.size());
        for (Enriched e : pageSlice) {
            StartupSupportItem b = e.base();
            views.add(StartupSupportItemView.of(
                    b,
                    e.inferred(),
                    e.autoStatus(),
                    b.category(),                                       // rawCategory = provider 원본
                    StartupSupportEnricher.aiInsightHint(b),            // 백엔드 힌트
                    inferItemSource(b)                                  // 항목별 출처
            ));
        }

        return new StartupSupportListResponse(
                views,
                currentSource(),
                views.size(),                       // 현 페이지 건수 (backward compat)
                Instant.now(),
                AppliedFilters.of(category, status, region, keyword),
                totalCount,
                safePage,
                size,
                totalPages,
                sortKey,
                provider.originTotal(),             // upstream 원본 총 건수
                raw.size()                          // backend 가 메모리에 로드한 건수
        );
    }

    /** 기존 4-인자 호출 backward compat. */
    public StartupSupportListResponse findAllEnvelope(
            String category, String status, String region, String keyword
    ) {
        return findAllEnvelope(category, status, region, keyword, "latest", 1, MAX_SIZE);
    }

    private static boolean matchesKeyword(StartupSupportItem item, String kwLower) {
        return containsLower(item.title(), kwLower)
                || containsLower(item.organization(), kwLower)
                || containsLower(item.target(), kwLower)
                || containsLower(item.fieldSummary(), kwLower)
                || containsLower(item.recommendReason(), kwLower);
    }

    private static boolean containsLower(String haystack, String needleLower) {
        return haystack != null && haystack.toLowerCase(Locale.KOREA).contains(needleLower);
    }

    private static String normalize(String v) {
        return v == null ? "" : v.trim();
    }

    /** 항목별 출처 분류 — id prefix 기반. */
    private static String inferItemSource(StartupSupportItem b) {
        String id = b.id() == null ? "" : b.id();
        if (id.startsWith("news-")) return "k-startup-news";
        if (id.startsWith("supt-")) return "k-startup-service";   // service01 신규 (Phase 9.10)
        if (id.startsWith("supp-")) return "mock";
        return "k-startup-service";
    }

    private static LocalDate parseDateForSort(String s) {
        if (s == null || s.isBlank()) return null;
        String[] formats = {"yyyy.MM.dd", "yyyy-MM-dd", "yyyy/MM/dd", "yyyy.M.d", "yyyy-M-d"};
        for (String f : formats) {
            try {
                return LocalDate.parse(s.trim(), DateTimeFormatter.ofPattern(f, Locale.KOREA));
            } catch (Exception ignored) { /* next */ }
        }
        return null;
    }
}
