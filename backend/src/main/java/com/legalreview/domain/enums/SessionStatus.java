package com.legalreview.domain.enums;

import java.util.Arrays;

public enum SessionStatus {
    CREATED,
    ANALYZING,
    COMPLETED,
    FAILED;

    public static SessionStatus from(String value) {
        if (value == null || value.isBlank()) {
            return FAILED;
        }
        return Arrays.stream(values())
                .filter(v -> v.name().equals(value))
                .findFirst()
                .orElse(FAILED);
    }
}
