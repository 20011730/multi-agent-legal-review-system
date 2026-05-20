package com.legalreview.controller;

import com.legalreview.dto.startup.StartupSupportItem;
import com.legalreview.dto.startup.StartupSupportListResponse;
import com.legalreview.service.startup.StartupSupportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 스타트업 지원사업 mock API (Phase 2).
 *
 * 정책:
 *   - 인증 없음 (Phase 1 frontend 가 비인증으로 호출하던 흐름 그대로).
 *   - RAG / 법률 검색 endpoint 와 분리된 별도 path.
 *   - 추후 K-Startup OpenAPI / DB 연동 시 Service 만 교체.
 */
@Tag(name = "스타트업 지원사업", description = "정부지원사업·정책자금·R&D·멘토링 등 큐레이션 (Phase 2 mock)")
@RestController
@RequestMapping("/api/startup-support")
@RequiredArgsConstructor
public class StartupSupportController {

    private final StartupSupportService startupSupportService;

    @Operation(
            summary = "전체 지원사업 목록 (선택적 필터링, envelope 응답)",
            description = "Phase 5 — 응답 envelope 구조 도입.\n"
                    + "구조: { items: [...], source: string, count: number, lastUpdated: ISO-8601, filters: {...} }.\n"
                    + "category / status / region / keyword 가 모두 비어있으면 mock 15건 전체 반환."
    )
    @GetMapping
    public ResponseEntity<StartupSupportListResponse> findAll(
            @Parameter(description = "카테고리 정확 일치 (예: 사업화, 정책자금, R&D, 멘토링, 창업교육, 법률·세무·노무, 투자/IR)")
            @RequestParam(value = "category", required = false) String category,
            @Parameter(description = "모집 상태 정확 일치 (예: 마감임박, 모집중, 상시모집)")
            @RequestParam(value = "status", required = false) String status,
            @Parameter(description = "지역 정확 일치 또는 '전국' 자동 통과 (예: 서울, 경기)")
            @RequestParam(value = "region", required = false) String region,
            @Parameter(description = "키워드 contains 매칭")
            @RequestParam(value = "keyword", required = false) String keyword,
            @Parameter(description = "정렬: latest / deadline / recommend / title")
            @RequestParam(value = "sort", required = false) String sort,
            @Parameter(description = "페이지(1-base), default 1")
            @RequestParam(value = "page", required = false) Integer page,
            @Parameter(description = "페이지 크기, default 20, max 100")
            @RequestParam(value = "size", required = false) Integer size) {
        return ResponseEntity.ok(
                startupSupportService.findAllEnvelope(category, status, region, keyword, sort, page, size));
    }

    @Operation(summary = "지원사업 단건 조회", description = "id 에 해당하는 지원사업 1건을 반환. 없으면 404.")
    @GetMapping("/{id}")
    public ResponseEntity<StartupSupportItem> findById(
            @Parameter(description = "지원사업 ID (예: supp-001)", required = true)
            @PathVariable("id") String id) {
        return startupSupportService.findById(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
