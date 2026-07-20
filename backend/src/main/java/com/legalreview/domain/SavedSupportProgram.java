package com.legalreview.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "saved_support_programs",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_saved_support_user_program", columnNames = {"user_id", "program_id"})
        },
        indexes = {
                @Index(name = "idx_saved_support_user_saved_at", columnList = "user_id, saved_at"),
                @Index(name = "idx_saved_support_user_deadline", columnList = "user_id, application_deadline")
        }
)
@Getter
@Setter
@NoArgsConstructor
public class SavedSupportProgram {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "program_id", nullable = false, length = 120)
    private String programId;

    @Column(name = "program_title", nullable = false, length = 500)
    private String programTitle;

    @Column(name = "organization_name", length = 255)
    private String organizationName;

    @Column(name = "application_deadline", length = 80)
    private String applicationDeadline;

    @Column(name = "source_url", length = 1000)
    private String sourceUrl;

    @Column(length = 120)
    private String category;

    @Column(length = 80)
    private String status;

    @Column(length = 80)
    private String region;

    @Column(name = "field_summary", length = 1000)
    private String fieldSummary;

    @Column(name = "saved_at", nullable = false, updatable = false)
    private LocalDateTime savedAt = LocalDateTime.now();

    @Column(length = 1000)
    private String memo;
}
