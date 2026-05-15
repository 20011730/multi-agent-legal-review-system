package com.legalreview.domain.enums;

import java.util.Arrays;

public enum AnalysisPhase {
    ROUND1_BIZ,
    ROUND1_LEGAL,
    WAITING_FOR_USER_R1,
    ROUND2_BIZ,
    ROUND2_LEGAL,
    WAITING_FOR_USER_R2,
    ROUND3_BIZ,
    ROUND3_LEGAL,
    JUDGING,
    COLLECTING_EVIDENCE;

    public static AnalysisPhase fromNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return Arrays.stream(values())
                .filter(v -> v.name().equals(value))
                .findFirst()
                .orElse(null);
    }

    public boolean isWaitingForUser() {
        return this == WAITING_FOR_USER_R1 || this == WAITING_FOR_USER_R2;
    }
}
