package com.legalreview.repository;

import com.legalreview.domain.CaseDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CaseDocumentRepository extends JpaRepository<CaseDocument, Long> {
    
    // 기존 메서드 유지 (다른 기능에서 사용 가능)
    Optional<CaseDocument> findByReferenceId(String referenceId);
    List<CaseDocument> findByChunkedFalse();
    
    // 배치 적재 시 대용량 중복 체크 최적화를 위해 추가
    boolean existsByReferenceId(String referenceId);
}