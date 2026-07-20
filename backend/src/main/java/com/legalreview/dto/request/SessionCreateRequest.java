package com.legalreview.dto.request;

import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class SessionCreateRequest {

    @NotBlank
    private String companyName;

    @NotBlank
    private String industry;

    @NotBlank
    private String reviewType;

    @NotBlank
    private String situation;

    @NotBlank
    private String content;

    @NotBlank
    private String participationMode;

    /**
     * Phase 10.4 — 지원사업 큐레이션 진입 컨텍스트 (선택).
     * null 허용 — 일반 진단 요청은 영향 없음.
     */
    private StartupContextDto startupContext;

    /**
     * Phase 10.7 — 사용자가 첨부한 파일 메타데이터 (선택).
     * 각 entry: {name, size, mimeType, uploadedAt, summary?}
     * 데모 단계 — 파일 내용 추출은 운영 단계 TODO. 메타데이터만 에이전트 프롬프트에 안내용으로 전달.
     */
    private List<Map<String, Object>> attachments;

    /**
     * Phase 10.16 — Step 2 지원사업형 추가 정보 (applicantType, executionMode, privacyHandling,
     * ipOutput, workforce, priorSupport). 모두 선택사항.
     */
    private Map<String, Object> startupExtras;

    /**
     * Phase 10.17 — 후속 질문 목록 (재분석 시 주입).
     * 각 entry: { targetAgent, message, createdAt }
     */
    private List<Map<String, Object>> followUpQuestions;

    /**
     * 분석 실행 범위.
     * ROUND1_ONLY: 첫 라운드만 실행하고 사용자 입력 대기
     * ROUND2_ONLY / ROUND3_ONLY / ROUND4_ONLY: 해당 라운드만 실행하고 다음 사용자 입력 대기
     * ROUND5_FINAL: 종합 라운드와 최종 판정 실행
     * ROUND2_FINAL: 완료 후 추가 재검토 호환 모드
     */
    private String analysisMode;

    /**
     * Python AI 단계별 호출 시 이전 agent 발언을 함께 전달하기 위한 읽기 전용 컨텍스트.
     */
    private List<Map<String, Object>> priorMessages;
}
