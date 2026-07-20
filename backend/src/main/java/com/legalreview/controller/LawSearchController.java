package com.legalreview.controller;

import com.legalreview.dto.response.LawSearchResponse;
import com.legalreview.service.LawSearchService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "법령/판례 검색", description = "국가법령정보센터 OPEN API를 통한 법령 및 판례 검색")
@RestController
@RequestMapping("/api/law/search")
@RequiredArgsConstructor
public class LawSearchController {

    private final LawSearchService lawSearchService;

    @Operation(summary = "법령 검색", description = "키워드로 법령을 검색합니다.")
    @GetMapping("/laws")
    public ResponseEntity<LawSearchResponse> searchLaws(
            @Parameter(description = "검색 키워드", required = true, example = "개인정보보호법")
            @RequestParam(name = "query") String query,
            @Parameter(description = "결과 수 (기본 10, 최대 100)", required = false, example = "10")
            @RequestParam(name = "display", required = false, defaultValue = "10") int display) {
        return ResponseEntity.ok(lawSearchService.searchLaws(query, display));
    }

    @Operation(summary = "판례 검색", description = "키워드로 판례를 검색합니다.")
    @GetMapping("/cases")
    public ResponseEntity<LawSearchResponse> searchCases(
            @Parameter(description = "검색 키워드", required = true, example = "개인정보")
            @RequestParam(name = "query") String query,
            @Parameter(description = "결과 수 (기본 10, 최대 100)", required = false, example = "10")
            @RequestParam(name = "display", required = false, defaultValue = "10") int display) {
        return ResponseEntity.ok(lawSearchService.searchCases(query, display));
    }
}
