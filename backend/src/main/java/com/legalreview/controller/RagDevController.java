package com.legalreview.controller;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.request.SessionCreateRequest;
import com.legalreview.dto.response.EvidenceDto;
import com.legalreview.dto.response.ExperimentSessionDto;
import com.legalreview.dto.response.ExperimentSummaryDto;
import com.legalreview.service.rag.ChromaSearchService;
import com.legalreview.service.rag.ExperimentService;
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
