package com.legalreview.service.rag;

import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.response.EvidenceDto;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class EvidenceAssemblerTaxTribunalTest {

    private final EvidenceAssembler assembler = new EvidenceAssembler();

    @Test
    void mapsTaxTribunalEvidenceWithSafeFallbacks() {
        RetrievedChunk chunk = RetrievedChunk.builder()
                .chunkId("tax_doc_1_p1")
                .sourceType("TAX_TRIBUNAL")
                .chunkText("세금계산서 관련 사실관계와 매입세액 불공제 판단이 포함된 본문입니다.")
                .metadata(Map.of(
                        "doc_number", "조심2024서0001",
                        "tax_type", "부가가치세",
                        "decision_type", "기각",
                        "attr_year", "2022",
                        "section_type", "요지"
                ))
                .distance(0.2)
                .build();

        EvidenceDto dto = assembler.toEvidenceDto(chunk);

        assertThat(dto.getSourceType()).isEqualTo("TAX_TRIBUNAL");
        assertThat(dto.getDataSource()).isEqualTo("tax_tribunal");
        assertThat(dto.getTitle()).contains("조심2024서0001");
        assertThat(dto.getReferenceId()).isEqualTo("조심2024서0001");
        assertThat(dto.getArticleOrCourt()).contains("조세 심판례", "부가가치세", "기각");
        assertThat(dto.getUrl()).isBlank();
        assertThat(dto.getMetadata()).containsEntry("doc_number", "조심2024서0001");
        assertThat(dto.getMetadata()).doesNotContainKey("chunkId");
    }
}
