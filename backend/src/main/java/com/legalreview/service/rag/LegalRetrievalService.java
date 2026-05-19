package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.EvidenceDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 법령/판례 RAG retrieval orchestration.
 *
 * 책임:
 *  1) 사용자 입력(SessionCreateRequest)으로부터 검색 쿼리 생성
 *     - 원문 + reviewType + industry 결합
 *  2) Chroma의 laws/cases 컬렉션을 각각 top-k 검색
 *  3) 결과를 EvidenceDto 리스트로 변환 (assembler 사용)
 *  4) 멀티에이전트가 공통으로 참조할 수 있는 evidence pool로 반환
 *
 * 호출 시점은 AnalysisAsyncRunner.runAnalysis()의 토론 시작 직전 1회.
 * 라운드마다 반복 호출하지 않는다 — 같은 evidence pool을 모든 에이전트가 참조한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LegalRetrievalService {

    private final RagProperties ragProperties;
    private final ChromaSearchService chromaSearchService;
    private final EvidenceAssembler evidenceAssembler;

    /**
     * 세션 입력 기반 retrieval 1회.
     * RAG가 비활성이거나 Chroma 미응답이면 빈 리스트 반환 (호출 측이 legacy fallback 가능).
     *
     * @return 법령 chunk + 판례 chunk를 합친 EvidenceDto 리스트 (법령 먼저, 판례 나중).
     */
    public List<EvidenceDto> retrieveForSession(SessionCreateRequest request) {
        if (!ragProperties.isEnabled()) {
            log.debug("[RAG] disabled — retrieveForSession 건너뜀");
            return List.of();
        }

        String query = buildQuery(request);
        if (query.isBlank()) return List.of();

        int kLaw = Math.max(0, ragProperties.getTopK().getLaw());
        int kCase = Math.max(0, ragProperties.getTopK().getCaze());

        List<RetrievedChunk> lawChunks = chromaSearchService.queryLaws(query, kLaw);
        // ── CASE over-fetch: 외부 시스템 case 가 score 마진(예: 0.003)으로 본문 풍부 case 를 누르고
        //    top-K(=2) 안에 들어와 사용자에게 amber 메타만 노출되는 회귀를 방지하기 위해,
        //    Chroma 에서 kCase 의 OVER_FETCH_MULTIPLIER 배수로 over-fetch 한 뒤
        //    body-rich(tier=1) 우선 → meta-only(tier=0) 순으로 정렬, 최종 kCase 건만 반환.
        //    하드코딩 도메인 boost 가 아니며, body_status / data_source 메타 기반 정렬일 뿐.
        int caseFetchK = Math.max(kCase, kCase * OVER_FETCH_MULTIPLIER);
        List<RetrievedChunk> caseChunks = chromaSearchService.queryCases(query, caseFetchK);

        // ── CASE chunk 안정 정렬: 본문 풍부(tier 1) → 메타 only(tier 0) 우선순위 ──
        //   * Chroma 가 내려준 distance 순(코사인 유사도) 은 그대로 유지하되,
        //     같은 score 범위 내에서 외부 시스템 출처(meta only) 가 본문 풍부 case 보다 상위 노출
        //     되는 케이스를 보정 (예: 임대차 query 의 score=0.837 meta-only vs 0.832 body-rich).
        //   * stable sort 라 같은 tier 내에서는 chroma 가 내려준 순서가 보존됨.
        //   * meta only 도 제거하지 않고 뒤로 미루기만 함 (참고용 메타로 표시 가능).
        caseChunks = reorderCaseChunks(caseChunks);
        // ── CASE 후보 ε-tie 다양화 (2026-05-19 추가, 후보 2 최소 구현) ──
        //   * top-K(=2) 안에 같은 case_number 의 chunk (body + holding 등) 가 두 자리 모두
        //     차지하는 경우(DUP_CN) → 사용자에게 같은 사건이 중복 노출되는 문제.
        //   * 동일 sort tier 내에서 score 차이가 EPSILON 이하인 후보 중 case_number 가 다른
        //     첫 chunk 를 slot 2 에 우선 배치. score 차이가 EPSILON 보다 크면 원래 순서 유지
        //     (낮은 점수 후보를 억지로 올리지 않음).
        //   * slot 1 (CASE_TOP) 은 절대 변경하지 않음 — body-rich 우선 정책 보존.
        caseChunks = diversifyByCaseNumber(caseChunks, kCase);
        // over-fetch 후 최종 kCase 건만 반환 (body-rich 우선이라 자동으로 emerald 카드가 앞에 옴).
        if (caseChunks.size() > kCase) {
            caseChunks = new ArrayList<>(caseChunks.subList(0, kCase));
        }

        log.info("[RAG] retrieval 완료 — query='{}', lawTopK={}, caseTopK={}, lawHits={}, caseHits={}",
                truncate(query, 80), kLaw, kCase, lawChunks.size(), caseChunks.size());

        List<EvidenceDto> evidences = new ArrayList<>(lawChunks.size() + caseChunks.size());
        evidences.addAll(evidenceAssembler.toEvidenceDtos(lawChunks));
        evidences.addAll(evidenceAssembler.toEvidenceDtos(caseChunks));
        return evidences;
    }

    /**
     * data_source 가 명시적 외부 시스템(법제처 OPEN API 의 prec 풀 외부) 인 경우 set.
     * 이 출처의 case 는 본문이 lawService.do?target=prec 으로 조회 불가 → meta-only fallback chunk 만 존재.
     */
    private static final Set<String> EXTERNAL_DATA_SOURCES = Set.of("국세법령정보시스템");

    /**
     * CASE over-fetch 배수. 최종 노출은 kCase 건이지만, body-rich 우선 필터링을 위해
     * Chroma 에는 kCase * OVER_FETCH_MULTIPLIER 건 조회.
     * - 외부 시스템 case 가 score 마진 0.003 정도로 본문 풍부 case 를 누르고
     *   top-2 안에 들어와 사용자에게 amber 메타만 노출되는 경우를 방지.
     * - 도메인 분기 (의료/학폭/형사/행정/임대차·부동산) 로 prefix 제거 후 raw query 가
     *   외부 system meta 클러스터와 강하게 매칭되는 경우 (예: "부동산 매매 계약" → 국세 사해행위 메타 다수)
     *   body-rich 후순위 case 까지 over-fetch 범위에 진입하도록 5 로 상향.
     * - kCase=2 → 10 건 조회. Chroma RPC 비용 증가 미미 (단일 collection 1회).
     */
    private static final int OVER_FETCH_MULTIPLIER = 5;

    /**
     * CASE chunk 의 우선순위 tier 계산.
     *   tier=1: 본문 풍부 (data_source 가 외부 시스템 아님 AND body_status 가 빈값 또는 "ok")
     *   tier=0: meta-only (외부 시스템 출처 또는 body_status≠ok)
     */
    private static int caseTier(RetrievedChunk c) {
        String bs = c.metaString("body_status");
        String ds = c.metaString("data_source");
        boolean bodyMissing = !bs.isEmpty() && !bs.equals("ok");
        boolean external = EXTERNAL_DATA_SOURCES.contains(ds);
        return (bodyMissing || external) ? 0 : 1;
    }

    /** caseChunks 를 tier 1(본문) → tier 0(메타) 순으로 안정 정렬. */
    private List<RetrievedChunk> reorderCaseChunks(List<RetrievedChunk> chunks) {
        List<RetrievedChunk> sorted = new ArrayList<>(chunks);
        // tier 내림차순. Java List.sort 는 stable 이라 같은 tier 내 chroma 원래 순서 유지.
        sorted.sort(Comparator.comparingInt((RetrievedChunk c) -> -caseTier(c)));
        return sorted;
    }

    /**
     * CASE 후보 다양화 — score 차이 EPSILON 이내에서 case_number 가 다른 후보 우선 배치.
     *
     * 원칙:
     *   - slot 1 (CASE_TOP) 절대 불변 — body-rich 우선 정책 보존.
     *   - slot 2 부터: 이미 배치된 case_number 와 동일한 chunk 는 skip 하되,
     *     score 차이가 EPSILON 보다 작은 동순위 후보 안에서만 skip 적용.
     *   - 적합한 후보가 없으면 원래 순서대로 fallback.
     *   - meta-only(tier=0) 영역에서는 다양화 미적용 (data 양 부족 시 그대로 노출).
     */
    private static final double DIVERSITY_EPSILON = 0.02;

    private static List<RetrievedChunk> diversifyByCaseNumber(List<RetrievedChunk> chunks, int kCase) {
        if (chunks.size() <= 1 || kCase <= 1) return chunks;
        // slot 1: 그대로
        List<RetrievedChunk> picked = new ArrayList<>(kCase);
        picked.add(chunks.get(0));
        Set<String> usedCaseNumbers = new HashSet<>();
        usedCaseNumbers.add(chunks.get(0).metaString("case_number"));
        // remaining = chunks 의 slot 1 제외
        // slot 2..kCase: 다양화 적용
        for (int slot = 1; slot < kCase; slot++) {
            int chosenIdx = -1;
            // body-rich tier 인 picked.get(0) 와 같은 tier 인 후보까지만 ε 비교
            // (tier 가 떨어지면 score 가 어차피 큰 차이로 떨어진다 보고 ε 후보 풀에서 제외)
            int baseTier = caseTier(picked.get(0));
            Double baseScore = picked.get(0).getDistance() == null ? null
                    : (1.0 - picked.get(0).getDistance() / 2.0);
            for (int i = 1; i < chunks.size(); i++) {
                RetrievedChunk c = chunks.get(i);
                if (caseTier(c) != baseTier) continue;  // 다른 tier 는 skip (이미 reorderCaseChunks 가 정렬했으므로 더 이상 후보 없음)
                Double sim = c.getDistance() == null ? null : (1.0 - c.getDistance() / 2.0);
                if (baseScore != null && sim != null && (baseScore - sim) > DIVERSITY_EPSILON) {
                    break;  // ε 초과 → 더 이상 다양화 후보 풀 없음
                }
                String cn = c.metaString("case_number");
                if (cn.isEmpty() || !usedCaseNumbers.contains(cn)) {
                    chosenIdx = i;
                    break;
                }
            }
            if (chosenIdx < 0) {
                // 다양화 적합 후보 없음 → 원래 순서 다음 chunk 사용 (slot 그대로)
                if (picked.size() < chunks.size()) {
                    // 이미 사용된 chunk 다음 것
                    for (int i = 1; i < chunks.size(); i++) {
                        if (!picked.contains(chunks.get(i))) {
                            picked.add(chunks.get(i));
                            usedCaseNumbers.add(chunks.get(i).metaString("case_number"));
                            break;
                        }
                    }
                }
            } else {
                picked.add(chunks.get(chosenIdx));
                usedCaseNumbers.add(chunks.get(chosenIdx).metaString("case_number"));
            }
        }
        // 남은 chunk 들은 원래 순서로 picked 뒤에 붙임 (over-fetch 잔여, subList 후 잘림)
        List<RetrievedChunk> result = new ArrayList<>(chunks.size());
        result.addAll(picked);
        for (RetrievedChunk c : chunks) {
            if (!picked.contains(c)) result.add(c);
        }
        return result;
    }

    /**
     * 검색 쿼리 생성:
     *   "{reviewType} {industry} {content} {situation?}"
     * (LLM 임베딩이 한국어 처리 가능한 모델이라는 전제 — multilingual-e5-base.)
     *
     * 도메인 분기 (2026-05-19 추가, 의료 → 다중 도메인 확장):
     *   content/situation 안에 특정 도메인 키워드가 있고,
     *   reviewType 가 default 후보(marketing/contract/general) 또는
     *   industry 가 default 후보(tech/general/default) 인 경우,
     *   해당 prefix 가 임베딩 매칭을 도메인 외부(prec 광범위 사건명)로 dilute 하는 효과가 있어
     *   prefix 를 검색 쿼리에서 제외한다.
     *
     *   - 사용자가 명시한 비-default 도메인 (예: industry=healthcare, reviewType=criminal) 값은 그대로 유지
     *   - 특정 data_source 강제 boost 아님 — 자연스러운 쿼리 텍스트 조정
     *   - 도메인 후보: 의료 / 학폭(교육 행정) / 형사 / 행정 / 임대차·부동산
     */
    private static final Set<String> MEDICAL_DOMAIN_KEYWORDS = Set.of(
            "의료", "진료", "병원", "의사", "수술", "오진", "진단", "치료",
            "설명의무", "의료사고", "의료과실", "의료분쟁", "의료조정", "의료중재",
            "치과", "정형외과", "내과", "신경외과", "성형외과", "산부인과",
            "환자", "부작용", "처방", "임플란트", "약사", "약품",
            // 2026-05-19 보강: 의료 분야이지만 기존 키워드에 미포함이라
            // isMedicalSpecific 게이트가 실패하던 borderline 어휘 — 보수적으로 5개 추가.
            //   - 분만/마취/알레르기/한방/응급 모두 의료 context 외 일상에서는 거의 안 쓰임 → false positive 위험 ↓
            //   - 합병증은 "수술" 키워드로 이미 잡히므로 추가 불필요
            "분만", "마취", "알레르기", "한방", "응급"
    );
    private static final Set<String> SCHOOL_VIOLENCE_KEYWORDS = Set.of(
            "학교폭력", "학폭", "학교폭력대책심의위원회", "학교폭력예방",
            "가해학생", "피해학생", "학생 징계", "교권 침해", "학교장 통고",
            "학생부", "출석정지", "전학", "퇴학", "서면사과", "접촉금지"
    );
    private static final Set<String> CRIMINAL_KEYWORDS = Set.of(
            "형사", "고소", "고발", "절도", "폭행", "사기", "횡령", "배임",
            "명예훼손", "모욕", "성범죄", "처벌", "구속", "기소", "공판",
            "강도", "방화", "협박", "공갈",
            // 2026-05-20 보강: 형사 직접 어휘 추가 (false positive 위험 낮은 것만)
            "마약", "음주운전", "범죄", "업무방해"
            // 주의: "약물" 단일 키워드는 의료 알레르기/처방 등과 충돌 위험 → 추가 안 함.
            //       "약물 범죄" query 는 "범죄" 키워드로 캐치됨.
    );
    private static final Set<String> ADMIN_KEYWORDS = Set.of(
            "행정처분", "영업정지", "과징금", "면허취소", "취소소송",
            "행정심판", "행정소송", "인허가", "제재처분", "행정명령",
            "허가취소", "처분취소", "이의신청"
    );
    private static final Set<String> TENANT_REALESTATE_KEYWORDS = Set.of(
            "임대차", "보증금", "전세", "월세", "임대인", "임차인",
            "임대차보호법", "주택임대차보호법", "상가임대차", "계약갱신",
            "권리금", "명도", "전세금", "임차보증금"
            // 주의: "부동산" 단일 키워드는 의도적으로 제외.
            //   - 국세 사해행위 case 다수가 "부동산 매매계약" 사건명에 "부동산" 포함하여
            //     domain prefix 제거 시 외부 system meta-only 클러스터로 매칭 dilute 됨.
            //   - 임대차/임차 핵심 어휘만 유지하면 충분.
    );
    /** reviewType 가 이 set 에 있으면 "사용자 default" 로 간주 — 도메인 분기 시 제거 가능. */
    private static final Set<String> DEFAULT_LIKE_REVIEW_TYPES = Set.of(
            "marketing", "contract", "general"
    );
    /** industry 가 이 set 에 있으면 "사용자 default" 로 간주 — 도메인 분기 시 제거 가능. */
    private static final Set<String> DEFAULT_LIKE_INDUSTRIES = Set.of(
            "tech", "general", "default"
    );

    private static boolean containsAny(String text, Set<String> kws) {
        if (text == null || text.isEmpty()) return false;
        for (String kw : kws) {
            if (text.contains(kw)) return true;
        }
        return false;
    }

    /**
     * content / situation 에서 식별되는 도메인 키워드 set 들 중 하나라도 매칭되면 true.
     * - 단일 분기 플래그 — 한 query 가 여러 도메인 키워드 (예: 의료 + 형사) 를 함께
     *   가질 수 있지만, default prefix 제외는 결과적으로 동일 동작
     * - 도메인 boost 아님, 사건명/판례 내용에 자주 등장하는 어휘를 식별해
     *   default-like reviewType/industry 의 dilution 효과를 회피하기 위한 휴리스틱
     */
    private static boolean isFocusedDomain(String content, String situation) {
        return containsAny(content, MEDICAL_DOMAIN_KEYWORDS) || containsAny(situation, MEDICAL_DOMAIN_KEYWORDS)
                || containsAny(content, SCHOOL_VIOLENCE_KEYWORDS) || containsAny(situation, SCHOOL_VIOLENCE_KEYWORDS)
                || containsAny(content, CRIMINAL_KEYWORDS) || containsAny(situation, CRIMINAL_KEYWORDS)
                || containsAny(content, ADMIN_KEYWORDS) || containsAny(situation, ADMIN_KEYWORDS)
                || containsAny(content, TENANT_REALESTATE_KEYWORDS) || containsAny(situation, TENANT_REALESTATE_KEYWORDS);
    }

    private static boolean isMedicalSpecific(String content, String situation) {
        return containsAny(content, MEDICAL_DOMAIN_KEYWORDS) || containsAny(situation, MEDICAL_DOMAIN_KEYWORDS);
    }

    /**
     * 의료 도메인 query reformulation 보조어 (2026-05-19 추가).
     *
     * 의도: 사용자가 짧은 일반 키워드 ("의료사고", "의료과실" 등) 만 입력했을 때,
     *   prec 의 의료 인접 case 사건명 (업무상과실치상, 보건범죄단속...) 이 강하게 매칭되어
     *   한국의료분쟁조정중재원 (medi) 의 짧은 case body 가 top-5 안에 진입하지 못하는 문제를 완화.
     *
     * 보강 방식:
     *   - 의료 도메인 검출 시, content 에 없는 보조어만 query 에 추가 (token 단위 dedup)
     *   - 특정 data_source 강제 boost 가 아님 — query 텍스트만 자연 어휘로 확장
     *   - 보조어 6개 (진료/수술/처치/손해배상/설명의무/부작용) — medi 본문에 자주 등장하면서
     *     의료 도메인의 일반 의미를 잘 포괄. 너무 길어지지 않도록 short list 유지.
     *   - 학폭/형사/행정/임대차 도메인에는 영향 없음 — isMedicalSpecific 게이트로 격리.
     */
    private static final List<String> MEDICAL_REFORMULATION_TOKENS = List.of(
            "진료", "수술", "처치", "손해배상", "설명의무", "부작용"
    );

    /**
     * 학폭/교육행정 도메인 reformulation 보조어 (2026-05-19).
     * 학폭 사건의 가해/피해 학생, 학교장 통고, 처분 등 prec/admrul/expc/detc 본문에
     * 자주 등장하는 행정 의미 어휘. 보조어 5개로 제한.
     */
    private static final List<String> SCHOOL_VIOLENCE_REFORMULATION_TOKENS = List.of(
            "처분", "징계", "학생", "학교", "심의"
    );

    /**
     * 행정처분 도메인 reformulation 보조어. 처분취소 / 영업정지 / 면허취소 등
     * 행정 사건의 공통 어휘. 보조어 4개.
     */
    private static final List<String> ADMIN_REFORMULATION_TOKENS = List.of(
            "처분", "취소", "위법", "재량"
    );

    /**
     * 임대차/부동산 도메인 reformulation 보조어. 임대차/임차/보증금 등 정확한 어휘
     * 외에 임대차 사건 본문에 자주 등장하는 어휘. 보조어 4개.
     */
    private static final List<String> TENANT_REALESTATE_REFORMULATION_TOKENS = List.of(
            "보증금", "임대인", "임차인", "계약"
    );

    /**
     * 형사 도메인 reformulation 보조어 (2026-05-20).
     * 형사 prec body 에 빈출하는 어휘로, 형사 외 도메인 (의료/학폭/행정/임대차) 본문에는
     * 거의 등장하지 않는 fingerprint 어휘 4개. content dedup 후 추가.
     *   - "처벌" / "유죄" / "피고인" / "선고" — 모두 형사 사건 본문의 핵심 어휘
     *   - 너무 broad 한 "범죄" 는 reformulation 으로는 미사용 (이미 detection 키워드에 포함)
     */
    private static final List<String> CRIMINAL_REFORMULATION_TOKENS = List.of(
            "처벌", "유죄", "피고인", "선고"
    );

    private static boolean isSchoolViolenceSpecific(String content, String situation) {
        return containsAny(content, SCHOOL_VIOLENCE_KEYWORDS) || containsAny(situation, SCHOOL_VIOLENCE_KEYWORDS);
    }
    private static boolean isAdminSpecific(String content, String situation) {
        return containsAny(content, ADMIN_KEYWORDS) || containsAny(situation, ADMIN_KEYWORDS);
    }
    private static boolean isTenantSpecific(String content, String situation) {
        return containsAny(content, TENANT_REALESTATE_KEYWORDS) || containsAny(situation, TENANT_REALESTATE_KEYWORDS);
    }
    private static boolean isCriminalSpecific(String content, String situation) {
        return containsAny(content, CRIMINAL_KEYWORDS) || containsAny(situation, CRIMINAL_KEYWORDS);
    }

    private String buildQuery(SessionCreateRequest request) {
        String content = request.getContent();
        String situation = request.getSituation();
        boolean focused = isFocusedDomain(content, situation);

        LinkedHashSet<String> tokens = new LinkedHashSet<>();
        String reviewType = request.getReviewType();
        String industry = request.getIndustry();

        // focused 도메인 + default-like reviewType/industry 는 prefix 제외 (자연 쿼리 조정).
        // 사용자가 명시한 비-default 값(예: industry=healthcare, reviewType=criminal) 은 그대로 유지.
        if (reviewType != null) {
            boolean isDefaultLike = DEFAULT_LIKE_REVIEW_TYPES.contains(reviewType);
            if (!(focused && isDefaultLike)) tokens.add(reviewType);
        }
        if (industry != null) {
            boolean isDefaultLike = DEFAULT_LIKE_INDUSTRIES.contains(industry);
            if (!(focused && isDefaultLike)) tokens.add(industry);
        }
        if (content != null) tokens.add(content);
        // situation 은 보조적이므로 너무 긴 경우만 제외
        if (situation != null && situation.length() < 200) {
            tokens.add(situation);
        }
        // 도메인 reformulation 보조어 추가 (content 에 이미 포함된 토큰은 dedup).
        // - 의료/학폭/행정/임대차 4개 도메인 모두 동일 정책.
        // - 사용자 query 의 의미를 바꾸지 않도록 자연 어휘만 짧게 보강.
        // - 도메인 게이트 외부에는 영향 없음.
        String contentSafe = content == null ? "" : content;
        if (isMedicalSpecific(content, situation)) {
            for (String tok : MEDICAL_REFORMULATION_TOKENS) {
                if (!contentSafe.contains(tok)) tokens.add(tok);
            }
            log.debug("[RAG] buildQuery medical-specific — reformulation 보조어 추가");
        }
        if (isSchoolViolenceSpecific(content, situation)) {
            for (String tok : SCHOOL_VIOLENCE_REFORMULATION_TOKENS) {
                if (!contentSafe.contains(tok)) tokens.add(tok);
            }
            log.debug("[RAG] buildQuery school-violence — reformulation 보조어 추가");
        }
        if (isAdminSpecific(content, situation)) {
            for (String tok : ADMIN_REFORMULATION_TOKENS) {
                if (!contentSafe.contains(tok)) tokens.add(tok);
            }
            log.debug("[RAG] buildQuery admin — reformulation 보조어 추가");
        }
        if (isTenantSpecific(content, situation)) {
            for (String tok : TENANT_REALESTATE_REFORMULATION_TOKENS) {
                if (!contentSafe.contains(tok)) tokens.add(tok);
            }
            log.debug("[RAG] buildQuery tenant/real-estate — reformulation 보조어 추가");
        }
        if (isCriminalSpecific(content, situation)) {
            for (String tok : CRIMINAL_REFORMULATION_TOKENS) {
                if (!contentSafe.contains(tok)) tokens.add(tok);
            }
            log.debug("[RAG] buildQuery criminal — reformulation 보조어 추가");
        }
        if (focused) {
            log.debug("[RAG] buildQuery focused-domain detected — default prefix 제외 적용");
        }
        return String.join(" ", tokens).trim();
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "...";
    }
}
