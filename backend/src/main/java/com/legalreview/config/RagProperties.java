package com.legalreview.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 법령/판례 RAG (Chroma) 관련 설정.
 *
 * application.yml 예시:
 * <pre>
 * app:
 *   rag:
 *     enabled: false
 *     chroma:
 *       base-url: http://localhost:8000
 *       laws-collection: laws
 *       cases-collection: cases
 *     top-k:
 *       law: 3
 *       case: 2
 *     embedding:
 *       model: BAAI/bge-m3
 *       dimension: 1024
 * </pre>
 *
 * 모든 값은 환경변수로도 주입 가능 (e.g. APP_RAG_ENABLED=true).
 * 추후 top-k 실험(law3+case2 vs law5+case3)을 위해 하드코딩을 피하고 설정값으로 분리.
 */
@Configuration
@ConfigurationProperties(prefix = "app.rag")
@Getter
@Setter
public class RagProperties {

    /** RAG 사용 여부 (false면 기존 LawSearchService 흐름만 사용). */
    private boolean enabled = false;

    private final Chroma chroma = new Chroma();
    private final TopK topK = new TopK();
    private final Embedding embedding = new Embedding();
    private final Prompt prompt = new Prompt();
    private final Ingestion ingestion = new Ingestion();
    private final Experiment experiment = new Experiment();

    @Getter @Setter
    public static class Chroma {
        private String baseUrl = "http://localhost:8000";
        private String lawsCollection = "laws";
        private String casesCollection = "cases";
        /** 요청 timeout(초). */
        private int timeoutSeconds = 15;
    }

    @Getter @Setter
    public static class TopK {
        /** 법령 검색 top-k (조문 chunk 단위). */
        private int law = 3;
        /** 판례 검색 top-k (판시사항/판단이유 chunk 단위). */
        private int caze = 2; // "case"는 Java 예약어
    }

    @Getter @Setter
    public static class Embedding {
        /** 임베딩 모델 이름. Chroma 컬렉션 생성 시 일관성 유지를 위해 메타데이터 기록 권장. */
        private String model = "BAAI/bge-m3";
        /** 임베딩 차원수. 컬렉션 생성 시 검증용. */
        private int dimension = 1024;
    }

    @Getter @Setter
    public static class Prompt {
        /** evidence 1건당 프롬프트에 들어갈 본문 최대 글자수 (토큰 폭증 방지). */
        private int maxEvidenceChars = 220;
        /** 프롬프트에 주입할 evidence 총 건수 상한 (legal 우선). */
        private int maxItemsLegal = 5;
        /** BIZ/JUDGE에 전달할 요약(타이틀만) 항목 수. */
        private int maxItemsCommon = 3;
    }

    @Getter @Setter
    public static class Ingestion {
        /** 운영 endpoint와 충돌 방지용 dev controller 활성화 여부. enabled=true 시에만 동작. */
        private boolean devEndpointEnabled = true;
        /** 시드 적재 시 기존 chunk를 덮어쓸지(true) 건너뛸지(false). */
        private boolean overwriteExisting = false;
    }

    /**
     * 실험 추적 설정.
     * - enabled=true 면 각 세션 분석 시 실험 메타(experimentTag, ragTopkLaw 등)와 타이밍을 ReviewSession에 기록한다.
     * - tag는 사람이 읽을 수 있는 실험 식별자 (e.g. "rag-law3-case2-v1", "baseline-openapi-v1").
     * - app.rag.enabled와 독립 — RAG가 꺼져 있어도 실험 태그만 켜서 baseline 측정 가능.
     */
    @Getter @Setter
    public static class Experiment {
        private boolean enabled = false;
        private String tag = "default";
    }
}
