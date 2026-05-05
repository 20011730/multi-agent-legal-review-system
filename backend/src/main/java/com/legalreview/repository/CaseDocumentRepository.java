package com.legalreview.repository;

import com.legalreview.domain.CaseDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CaseDocumentRepository extends JpaRepository<CaseDocument, Long> {
    Optional<CaseDocument> findByReferenceId(String referenceId);
    List<CaseDocument> findByChunkedFalse();
}
