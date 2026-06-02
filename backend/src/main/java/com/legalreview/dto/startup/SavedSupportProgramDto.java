package com.legalreview.dto.startup;

import com.legalreview.domain.SavedSupportProgram;

import java.time.LocalDateTime;

public record SavedSupportProgramDto(
        Long id,
        String programId,
        String title,
        String organization,
        String category,
        String region,
        String fieldSummary,
        String status,
        String deadline,
        String applyUrl,
        LocalDateTime savedAt,
        String deadlineLabel,
        Integer daysLeft,
        String deadlineStatus
) {
    public static SavedSupportProgramDto of(
            SavedSupportProgram saved,
            String deadlineLabel,
            Integer daysLeft,
            String deadlineStatus
    ) {
        return new SavedSupportProgramDto(
                saved.getId(),
                saved.getProgramId(),
                saved.getProgramTitle(),
                saved.getOrganizationName(),
                saved.getCategory(),
                saved.getRegion(),
                saved.getFieldSummary(),
                saved.getStatus(),
                saved.getApplicationDeadline(),
                saved.getSourceUrl(),
                saved.getSavedAt(),
                deadlineLabel,
                daysLeft,
                deadlineStatus
        );
    }
}
