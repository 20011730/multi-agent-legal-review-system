package com.legalreview.controller;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.EvidenceDto;
import com.legalreview.dto.rag.LawChromaIngestionResult;
import com.legalreview.dto.rag.LawDocumentBatchIngestionResult;
import com.legalreview.dto.rag.LawDocumentIngestionResult;
import com.legalreview.dto.rag.LawListApiIngestionResult;
import com.legalreview.dto.response.ExperimentSessionDto;
import com.legalreview.dto.response.ExperimentSummaryDto;
import com.legalreview.service.rag.ChromaSearchService;
import com.legalreview.service.rag.ExperimentService;
import com.legalreview.service.rag.LawDocumentChromaIngestionService;
import com.legalreview.service.rag.LawDocumentIngestionService;
import com.legalreview.service.rag.LawListIngestionService;
import com.legalreview.service.rag.LegalIngestionService;
import com.legalreview.service.rag.LegalRetrievalService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * RAG 개발/검증용 내부 controller.
 * 운영 API와 분리된 /api/rag/* 경로 사용.
 *
 * 활성 조건:
 *   - app.rag.enabled=true
 *   - app.rag.ingestion.dev-endpoint-enabled=true
 *
 * 두 조건 중 하나라도 false면 503으로 응답.
 *
 * 제공 endpoint:
 *   POST /api/rag/ingest                   — 시드 데이터 적재 (laws + cases)
 *   POST /api/rag/retrieve                 — 사용자 입력 기반 retrieval 미리보기
 *   GET  /api/rag/health                   — Chroma 상태 + 컬렉션 카운트
 */
@Slf4j
@RestController
@RequestMapping("/api/rag")
@RequiredArgsConstructor
public class RagDevController {

    private final LegalIngestionService ingestionService;
    private final LegalRetrievalService retrievalService;
    private final ChromaSearchService chromaSearchService;
    private final RagProperties ragProperties;
    private final ExperimentService experimentService;
    private final LawListIngestionService lawListIngestionService;
    private final LawDocumentIngestionService lawDocumentIngestionService;
    private final LawDocumentChromaIngestionService lawDocumentChromaIngestionService;

    @PostMapping("/ingest")
    public ResponseEntity<?> ingest() {
        ResponseEntity<?> guard = guardEnabled();
        if (guard != null) return guard;
        log.info("[RAG-DEV] /api/rag/ingest 호출");
        LegalIngestionService.IngestionReport report = ingestionService.runSeedIngestion();
        return ResponseEntity.ok(report);
    }

    /**
     * law_list 메타데이터 시드 적재 (개발용).
     *
     * 기존 /ingest는 법령·판례 "본문"을 PG + Chroma에 적재.
     * 본 endpoint는 법령 "목록 메타데이터"를 PG의 law_list 테이블에만 upsert.
     *  - lawMst가 이미 존재하면 갱신, 없으면 신규 저장
     *  - Chroma에는 적재되지 않음 (chunking/임베딩 대상이 아님)
     *
     * 가드는 dev-endpoint-enabled만 체크 (rag.enabled와 무관 — Chroma 미실행 환경에서도 적재 가능).
     */
    @PostMapping("/ingest/law-list")
    public ResponseEntity<?> ingestLawList() {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        log.info("[RAG-DEV] /api/rag/ingest/law-list 호출 (classpath seed)");
        int count = lawListIngestionService.ingestLawListSeed();
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("message", "law_list seed ingestion completed");
        resp.put("count", count);
        return ResponseEntity.ok(resp);
    }

    /**
     * 국가법령정보센터 법령 목록 API에서 직접 적재 (개발용).
     *
     * 안전장치:
     *  - 기본 maxPages=1 (실수로 전체 수집 방지)
     *  - display는 1~100 범위로 clamp (서비스 내부)
     *  - 페이지 사이 requestDelayMs sleep
     *
     * 환경변수: LAW_API_OC 필요. 미설정 시 결과의 totalCnt=-1, pagesProcessed=0 반환.
     */
    @PostMapping("/ingest/law-list/api")
    public ResponseEntity<?> ingestLawListFromApi(
            @RequestParam(value = "maxPages", required = false, defaultValue = "1") int maxPages,
            @RequestParam(value = "display", required = false, defaultValue = "100") int display) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        log.info("[RAG-DEV] /api/rag/ingest/law-list/api 호출 — maxPages={}, display={}",
                maxPages, display);
        LawListApiIngestionResult result = lawListIngestionService.ingestLawListFromApi(maxPages, display);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("message", "law_list API ingestion completed");
        resp.put("totalCnt", result.getTotalCnt());
        resp.put("pagesProcessed", result.getPagesProcessed());
        resp.put("savedCount", result.getSavedCount());
        resp.put("display", result.getDisplay());
        resp.put("completedAll", result.isCompletedAll());
        resp.put("skippedRows", result.getSkippedRows());
        resp.put("failedPages", result.getFailedPages());
        return ResponseEntity.ok(resp);
    }

    // ─────────────────────── law_documents 본문 적재 (개발용) ───────────────────────
    //  - 기본 정책: 5,583건 일괄 수집 X. lawMst/lawId/keyword/recommended 단위 선별 수집.
    //  - Chroma upsert는 본 단계의 책임 X (다음 단계: LegalChunker → ChromaSearchService).

    /**
     * lawMst(법령일련번호) 단건 본문 수집.
     * 예: POST /api/rag/ingest/law-documents/api?lawMst=280119
     */
    @PostMapping("/ingest/law-documents/api")
    public ResponseEntity<?> ingestLawDocumentByMstOrId(
            @RequestParam(value = "lawMst", required = false) Integer lawMst,
            @RequestParam(value = "lawId", required = false) String lawId) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;

        if (lawMst == null && (lawId == null || lawId.isBlank())) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "lawMst 또는 lawId 중 하나는 필수입니다."));
        }

        log.info("[RAG-DEV] /api/rag/ingest/law-documents/api — lawMst={}, lawId={}", lawMst, lawId);
        LawDocumentIngestionResult result = (lawMst != null)
                ? lawDocumentIngestionService.ingestByLawMst(lawMst)
                : lawDocumentIngestionService.ingestByLawId(lawId);
        return ResponseEntity.ok(toResultMap(result, "law document ingestion completed"));
    }

    /**
     * keyword 부분일치 batch 수집.
     * 예: POST /api/rag/ingest/law-documents/api/by-keyword?keyword=표시&limit=5
     */
    @PostMapping("/ingest/law-documents/api/by-keyword")
    public ResponseEntity<?> ingestLawDocumentsByKeyword(
            @RequestParam("keyword") String keyword,
            @RequestParam(value = "limit", required = false, defaultValue = "5") int limit) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        log.info("[RAG-DEV] /api/rag/ingest/law-documents/api/by-keyword — keyword={}, limit={}", keyword, limit);
        LawDocumentBatchIngestionResult result = lawDocumentIngestionService.ingestByKeyword(keyword, limit);
        return ResponseEntity.ok(result);
    }

    /**
     * 추천 주요 법령 batch 수집 (정확명칭 우선 + 부분일치 fallback, 최대 20건).
     * 예: POST /api/rag/ingest/law-documents/api/recommended
     */
    @PostMapping("/ingest/law-documents/api/recommended")
    public ResponseEntity<?> ingestRecommendedLawDocuments() {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        log.info("[RAG-DEV] /api/rag/ingest/law-documents/api/recommended");
        LawDocumentBatchIngestionResult result = lawDocumentIngestionService.ingestRecommendedLaws();
        return ResponseEntity.ok(result);
    }

    /**
     * law_documents → Chroma laws collection 적재 (개발용).
     * 동작:
     *   - chunked=false 인 LawDocument를 limit개 가져와
     *   - LegalChunker로 조문 단위 chunk 생성
     *   - Chroma laws 컬렉션에 upsert
     *   - upsert 성공 문서만 chunked=true 마킹
     *
     * 예: POST /api/rag/ingest/chroma/laws?limit=20
     *
     * 응답: {processedDocuments, chunkedDocuments, totalChunks, failedDocuments, failedReferenceIds, collectionName}
     */
    @PostMapping("/ingest/chroma/laws")
    public ResponseEntity<?> ingestChromaLaws(
            @RequestParam(value = "limit", required = false, defaultValue = "20") int limit) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;

        if (!ragProperties.isEnabled()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "app.rag.enabled=false — Chroma 적재 불가",
                    "hint", ".env에 APP_RAG_ENABLED=true 설정 후 재시작"));
        }

        log.info("[RAG-DEV] /api/rag/ingest/chroma/laws — limit={}", limit);
        LawChromaIngestionResult result = lawDocumentChromaIngestionService.ingestPendingLawDocuments(limit);
        return ResponseEntity.ok(result);
    }

    private static Map<String, Object> toResultMap(LawDocumentIngestionResult r, String message) {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("success", r.isSuccess());
        resp.put("lawMst", r.getLawMst());
        resp.put("lawId", r.getLawId());
        resp.put("title", r.getTitle());
        resp.put("documentId", r.getDocumentId());
        resp.put("contentLength", r.getContentLength());
        resp.put("message", r.isSuccess() ? message : r.getMessage());
        return resp;
    }

    /**
     * law_list 파일 업로드 적재 (개발용).
     * multipart/form-data — 필드 이름 "file".
     *
     *  - .json → ingestJson
     *  - .csv  → ingestCsv (헤더 snake_case/camelCase 모두 지원)
     *  - .xlsx/.xls → 현재 미지원 (Apache POI 의존성 미도입). CSV로 변환 후 업로드 권장
     *  - 그 외 → 400
     *
     * lawMst 기준 upsert로 멱등 보장.
     */
    @PostMapping(path = "/ingest/law-list/file", consumes = "multipart/form-data")
    public ResponseEntity<?> ingestLawListFile(@RequestParam("file") MultipartFile file) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;

        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "file is empty"));
        }

        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase(Locale.ROOT);
        String ext;
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "filename has no extension",
                    "filename", file.getOriginalFilename()));
        }
        ext = name.substring(dot + 1);

        log.info("[RAG-DEV] /api/rag/ingest/law-list/file 호출 — filename={}, size={}",
                file.getOriginalFilename(), file.getSize());

        int count;
        String type;
        try (InputStream is = file.getInputStream()) {
            switch (ext) {
                case "json":
                    type = "json";
                    count = lawListIngestionService.ingestJson(is);
                    break;
                case "csv":
                    type = "csv";
                    count = lawListIngestionService.ingestCsv(is);
                    break;
                case "xlsx":
                case "xls":
                    return ResponseEntity.badRequest().body(Map.of(
                            "error", "Excel import is not enabled yet. Please convert to CSV.",
                            "hint", "CSV 헤더 예: law_mst,law_id,law_name_kr,..."));
                default:
                    return ResponseEntity.badRequest().body(Map.of(
                            "error", "unsupported file extension: " + ext,
                            "supported", List.of("json", "csv")));
            }
        } catch (Exception e) {
            log.error("[RAG-DEV] 파일 업로드 처리 실패: {}", e.getMessage());
            return ResponseEntity.status(500).body(Map.of("error", "ingestion failed: " + e.getMessage()));
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("message", "law_list file ingestion completed");
        resp.put("type", type);
        resp.put("count", count);
        return ResponseEntity.ok(resp);
    }

    /**
     * 입력 SessionCreateRequest와 동일한 구조로 검색 쿼리 작성 → retrieval 결과 반환.
     * 실제 세션을 생성하지 않으므로 안전.
     */
    @PostMapping("/retrieve")
    public ResponseEntity<?> retrieve(@RequestBody SessionCreateRequest request) {
        ResponseEntity<?> guard = guardEnabled();
        if (guard != null) return guard;

        List<EvidenceDto> evidences = retrievalService.retrieveForSession(request);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("count", evidences.size());
        resp.put("evidences", evidences);
        return ResponseEntity.ok(resp);
    }

    /**
     * 빠른 검증용 GET 변형 — 단일 query string으로 retrieval 호출.
     * 예: GET /api/rag/retrieve?query=표시광고%20부당광고%20사업자
     *
     * SessionCreateRequest의 content 필드에 query 그대로 넣어 동일 흐름 사용.
     */
    @GetMapping("/retrieve")
    public ResponseEntity<?> retrieveByQuery(
            @RequestParam("query") String query,
            @RequestParam(value = "reviewType", required = false, defaultValue = "marketing") String reviewType,
            @RequestParam(value = "industry", required = false, defaultValue = "tech") String industry) {
        ResponseEntity<?> guard = guardEnabled();
        if (guard != null) return guard;

        SessionCreateRequest req = new SessionCreateRequest();
        req.setCompanyName("debug");
        req.setIndustry(industry);
        req.setReviewType(reviewType);
        req.setSituation("debug retrieval");
        req.setContent(query == null ? "" : query);
        req.setParticipationMode("observe");

        List<EvidenceDto> evidences = retrievalService.retrieveForSession(req);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("query", query);
        resp.put("count", evidences.size());
        resp.put("evidences", evidences);
        return ResponseEntity.ok(resp);
    }

    /**
     * 디버깅용 — Chroma 컬렉션 sample 조회.
     * 예: GET /api/rag/debug/laws/sample?limit=5
     */
    @GetMapping("/debug/{collection}/sample")
    public ResponseEntity<?> debugSample(
            @PathVariable String collection,
            @RequestParam(value = "limit", defaultValue = "5") int limit) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        List<Map<String, Object>> sample = chromaSearchService.dumpSample(collection, limit);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("collection", collection);
        resp.put("count", sample.size());
        resp.put("samples", sample);
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("enabled", ragProperties.isEnabled());
        resp.put("chromaBaseUrl", ragProperties.getChroma().getBaseUrl());
        resp.put("lawsCollection", ragProperties.getChroma().getLawsCollection());
        resp.put("casesCollection", ragProperties.getChroma().getCasesCollection());
        if (ragProperties.isEnabled()) {
            resp.put("lawsCount", chromaSearchService.countCollection(ragProperties.getChroma().getLawsCollection()));
            resp.put("casesCount", chromaSearchService.countCollection(ragProperties.getChroma().getCasesCollection()));
        }
        return ResponseEntity.ok(resp);
    }

    // ─────────── 실험 추적 endpoint ───────────
    // 실험 endpoint는 RAG 비활성 상태에서도 baseline 측정 결과를 조회할 수 있어야 하므로,
    // enabled 가드 없이 dev-endpoint-enabled만 체크.

    @GetMapping("/experiment/sessions")
    public ResponseEntity<?> listSessions(
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String tag) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        List<ExperimentSessionDto> rows = experimentService.listRecentSessions(limit, tag);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("count", rows.size());
        resp.put("filterTag", tag);
        resp.put("currentExperimentTag", ragProperties.getExperiment().getTag());
        resp.put("currentExperimentEnabled", ragProperties.getExperiment().isEnabled());
        resp.put("currentRagEnabled", ragProperties.isEnabled());
        resp.put("currentTopK", Map.of(
                "law", ragProperties.getTopK().getLaw(),
                "case", ragProperties.getTopK().getCaze()));
        resp.put("sessions", rows);
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/experiment/summary")
    public ResponseEntity<?> summary(@RequestParam String tag) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        ExperimentSummaryDto summary = experimentService.summarize(tag);
        return ResponseEntity.ok(summary);
    }

    @GetMapping("/experiment/compare")
    public ResponseEntity<?> compare(@RequestParam String tagA, @RequestParam String tagB) {
        ResponseEntity<?> guard = guardDevEndpoint();
        if (guard != null) return guard;
        return ResponseEntity.ok(experimentService.compare(tagA, tagB));
    }

    /** dev endpoint만 가드 (rag.enabled는 무관). */
    private ResponseEntity<?> guardDevEndpoint() {
        if (!ragProperties.getIngestion().isDevEndpointEnabled()) {
            return ResponseEntity.status(503).body(Map.of("error", "app.rag.ingestion.dev-endpoint-enabled=false"));
        }
        return null;
    }

    /** enabled / dev-endpoint 가드. 비활성이면 503 응답 반환, 정상이면 null 리턴 후 본 로직 진행. */
    private ResponseEntity<?> guardEnabled() {
        if (!ragProperties.isEnabled()) {
            return ResponseEntity.status(503).body(Map.of("error", "app.rag.enabled=false"));
        }
        if (!ragProperties.getIngestion().isDevEndpointEnabled()) {
            return ResponseEntity.status(503).body(Map.of("error", "app.rag.ingestion.dev-endpoint-enabled=false"));
        }
        return null;
    }
}
