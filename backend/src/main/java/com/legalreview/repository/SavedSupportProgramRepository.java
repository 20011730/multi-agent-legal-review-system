package com.legalreview.repository;

import com.legalreview.domain.SavedSupportProgram;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SavedSupportProgramRepository extends JpaRepository<SavedSupportProgram, Long> {

    List<SavedSupportProgram> findByUserIdOrderBySavedAtDesc(Long userId);

    Optional<SavedSupportProgram> findByUserIdAndProgramId(Long userId, String programId);

    boolean existsByUserIdAndProgramId(Long userId, String programId);

    void deleteByUserIdAndProgramId(Long userId, String programId);
}
