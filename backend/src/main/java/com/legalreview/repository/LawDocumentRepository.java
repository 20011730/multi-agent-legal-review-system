package com.legalreview.repository;

import com.legalreview.domain.LawDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LawDocumentRepository extends JpaRepository<LawDocument, Long> {
    Optional<LawDocument> findByReferenceId(String referenceId);
    List<LawDocument> findByChunkedFalse();
}
