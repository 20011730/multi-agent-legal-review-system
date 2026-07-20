package com.legalreview.service.startup;

import com.legalreview.dto.startup.StartupSupportItem;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * StartupSupportItem 가공 유틸 (Phase 9.9).
 *
 * <p>상태 분류 (사용자 친화 명칭):
 * <ul>
 *   <li><b>모집중</b> — deadline ≥ today+8</li>
 *   <li><b>마감임박</b> — today ≤ deadline ≤ today+7</li>
 *   <li><b>모집마감</b> — deadline &lt; today</li>
 *   <li><b>상시모집</b> — deadline 텍스트가 "상시", "예산 소진 시" 등 상시성 표현</li>
 *   <li><b>확인 필요</b> — deadline 누락/파싱 불가 (기존 status 가 위 표준값이면 그대로 유지)</li>
 * </ul>
 *
 * <p>날짜 포맷 지원: {@code YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYY년 M월 D일}.
 */
public final class StartupSupportEnricher {

    private StartupSupportEnricher() {}

    private static final Map<String, List<String>> CATEGORY_KEYWORDS = new LinkedHashMap<>();
    static {
        CATEGORY_KEYWORDS.put("투자/IR", List.of(
                "투자", "ir", "데모데이", "피칭", "투자유치", "vc", "엔젤"));
        CATEGORY_KEYWORDS.put("R&D", List.of(
                "r&d", "rnd", "연구개발", "기술개발", "tips", "팁스", "특허기술"));
        CATEGORY_KEYWORDS.put("법률·세무·노무", List.of(
                "법률", "세무", "노무", "회계", "특허", "지식재산", "ip"));
        CATEGORY_KEYWORDS.put("정책자금", List.of(
                "자금", "융자", "보증", "대출", "정책자금", "지원금"));
        CATEGORY_KEYWORDS.put("멘토링", List.of(
                "멘토링", "컨설팅", "상담", "자문"));
        CATEGORY_KEYWORDS.put("창업교육", List.of(
                "교육", "아카데미", "세미나", "설명회", "캠프", "강좌"));
        CATEGORY_KEYWORDS.put("사업화", List.of(
                "사업화", "창업사업화", "지원사업", "패키지", "바우처", "poc", "실증", "스케일업"));
    }

    public static final String S_OPEN = "모집중";
    public static final String S_URGENT = "마감임박";
    public static final String S_ALWAYS = "상시모집";
    public static final String S_CLOSED = "모집마감";
    public static final String S_UNKNOWN = "확인 필요";

    /** 표준 status set — 기존 API 가 보내는 status 가 이 셋에 있으면 인정. */
    private static final List<String> STANDARD_STATUSES = List.of(S_OPEN, S_URGENT, S_ALWAYS, S_CLOSED, S_UNKNOWN);

    private static final String DEFAULT_CATEGORY = "사업화";

    public static String inferCategory(StartupSupportItem item) {
        if (item == null) return DEFAULT_CATEGORY;
        String haystack = lowercaseJoin(
                item.title(), item.fieldSummary(), item.recommendReason(),
                item.target(), item.organization(), item.category());
        if (haystack.isEmpty()) return defaultIfKnown(item.category());
        for (Map.Entry<String, List<String>> e : CATEGORY_KEYWORDS.entrySet()) {
            for (String kw : e.getValue()) {
                if (haystack.contains(kw)) return e.getKey();
            }
        }
        return defaultIfKnown(item.category());
    }

    private static String defaultIfKnown(String raw) {
        if (raw == null) return DEFAULT_CATEGORY;
        for (String known : CATEGORY_KEYWORDS.keySet()) {
            if (known.equals(raw)) return raw;
        }
        return DEFAULT_CATEGORY;
    }

    public static String aiInsightHint(StartupSupportItem item) {
        return inferCategory(item);
    }

    // ───────── 날짜 파싱 ─────────

    private static final Pattern KOR_DATE = Pattern.compile("(\\d{4})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일");

    /** deadline → LocalDate. 실패하면 null. */
    public static LocalDate parseDeadline(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        // 한국어 표현
        Matcher m = KOR_DATE.matcher(t);
        if (m.find()) {
            try {
                return LocalDate.of(Integer.parseInt(m.group(1)),
                        Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            } catch (Exception ignored) { /* fall through */ }
        }
        // 표준 포맷들
        String[] formats = {"yyyy-MM-dd", "yyyy.MM.dd", "yyyy/MM/dd", "yyyy.M.d", "yyyy-M-d", "yyyyMMdd"};
        for (String f : formats) {
            try {
                return LocalDate.parse(t, DateTimeFormatter.ofPattern(f, Locale.KOREA));
            } catch (Exception ignored) { /* try next */ }
        }
        return null;
    }

    /** deadline 텍스트가 "상시" 류인지. */
    public static boolean isAlwaysOpen(String s) {
        if (s == null) return false;
        String t = s.trim();
        if (t.isEmpty()) return false;
        return t.contains("상시") || t.contains("예산 소진") || t.contains("예산소진")
                || t.contains("연중") || t.contains("수시");
    }

    /** "확인 필요" 같은 표현인지. */
    public static boolean isUnknownDeadline(String s) {
        if (s == null) return true;
        String t = s.trim();
        if (t.isEmpty()) return true;
        return t.contains("확인") || t.contains("공고문") || t.equals("미정");
    }

    /**
     * 제목 / 요약 / 지원대상에 상시성 표현이 명확히 포함되어 있는지 — 9.14 보강.
     * 보수적 매칭: "수시", "연중" 단독 토큰은 다른 맥락(수시 평가, 연중 무휴 등)에 쓰여 false positive 가능 →
     * "수시 모집" / "수시 접수" / "연중 모집" / "연중 접수" / "상시 접수" / "예산 소진 시" 등
     * 동사·명사 결합 형태만 인정.
     */
    private static boolean titleSuggestsAlwaysOpen(StartupSupportItem item) {
        if (item == null) return false;
        String[] fields = { item.title(), item.fieldSummary(), item.target() };
        for (String f : fields) {
            if (f == null || f.isBlank()) continue;
            // 명확한 단일 토큰
            if (f.contains("(상시)") || f.contains("(상시 모집)")) return true;
            if (f.contains("상시모집") || f.contains("상시 모집")) return true;
            if (f.contains("상시 접수") || f.contains("상시접수")) return true;
            if (f.contains("예산 소진") || f.contains("예산소진")) return true;
            // 결합형 — 단독 "수시"/"연중" 은 제외, "수시·연중 모집/접수" 만 인정
            if (f.contains("수시 모집") || f.contains("수시모집")
                    || f.contains("수시 접수") || f.contains("수시접수")) return true;
            if (f.contains("연중 모집") || f.contains("연중모집")
                    || f.contains("연중 접수") || f.contains("연중접수")) return true;
        }
        return false;
    }

    /**
     * deadline 기반 자동 status. status 문자열은 보조 근거.
     * Phase 9.13: 제목에 "(상시)" 표기가 있으면 상시모집으로 분류 (deadline 이 미래여도 상시 우선).
     */
    public static String autoStatus(StartupSupportItem item) {
        if (item == null) return S_UNKNOWN;
        String deadline = item.deadline();
        if (isAlwaysOpen(deadline) || titleSuggestsAlwaysOpen(item)) return S_ALWAYS;

        LocalDate d = parseDeadline(deadline);
        if (d == null) {
            // deadline 파싱 불가 → 기존 status 가 표준이면 그대로
            String orig = item.status();
            if (orig != null) {
                if ("마감".equals(orig)) return S_CLOSED;
                if (STANDARD_STATUSES.contains(orig)) return orig;
            }
            if (isUnknownDeadline(deadline)) return S_UNKNOWN;
            return S_UNKNOWN;
        }
        LocalDate today = LocalDate.now();
        if (d.isBefore(today)) return S_CLOSED;
        long days = java.time.temporal.ChronoUnit.DAYS.between(today, d);
        if (days <= 7) return S_URGENT;
        return S_OPEN;
    }

    /**
     * 추천 점수 — 신청 가능 여부 가중치 ↑, 마감 페널티 강화.
     */
    public static int recommendScore(StartupSupportItem item) {
        if (item == null) return 0;
        int score = 0;
        String st = autoStatus(item);
        switch (st) {
            case S_URGENT -> score += 40;
            case S_OPEN -> score += 30;
            case S_ALWAYS -> score += 18;
            case S_UNKNOWN -> score += 0;
            case S_CLOSED -> score -= 60;
            default -> {}
        }
        String cat = inferCategory(item);
        switch (cat) {
            case "투자/IR" -> score += 25;
            case "R&D" -> score += 20;
            case "사업화" -> score += 15;
            case "정책자금" -> score += 12;
            case "법률·세무·노무" -> score += 10;
            default -> score += 5;
        }
        String hay = lowercaseJoin(item.title(), item.fieldSummary(), item.recommendReason());
        if (hay.contains("법률") || hay.contains("계약") || hay.contains("ip") || hay.contains("지식재산")) score += 10;

        // recency: 마감일이 가까울수록 (모집중일 때만)
        LocalDate d = parseDeadline(item.deadline());
        if (d != null && !d.isBefore(LocalDate.now())) {
            long days = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), d);
            if (days <= 30) score += 10;
            else if (days <= 90) score += 5;
        }
        return score;
    }

    /** 정렬 그룹 — activeFirst 정렬에 사용. 작을수록 위. */
    public static int statusGroupOrder(String autoStatus) {
        if (autoStatus == null) return 99;
        return switch (autoStatus) {
            case S_OPEN -> 0;
            case S_URGENT -> 1;
            case S_ALWAYS -> 2;
            case S_UNKNOWN -> 3;
            case S_CLOSED -> 4;
            default -> 5;
        };
    }

    private static String lowercaseJoin(String... ss) {
        StringBuilder sb = new StringBuilder();
        for (String s : ss) {
            if (s == null) continue;
            sb.append(s.toLowerCase(Locale.KOREA)).append(' ');
        }
        return sb.toString();
    }
}
