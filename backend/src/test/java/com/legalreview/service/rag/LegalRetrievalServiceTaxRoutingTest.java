package com.legalreview.service.rag;

import com.legalreview.config.RagProperties;
import com.legalreview.dto.rag.RetrievedChunk;
import com.legalreview.dto.request.SessionCreateRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LegalRetrievalServiceTaxRoutingTest {

    @Test
    void disabledTaxFlagsDoNotCallTaxCollection() {
        ChromaSearchService chroma = mock(ChromaSearchService.class);
        LegalRetrievalService service = service(chroma, false, false);

        service.retrieveForSession(request("부가가치세 매입세액 불공제"));

        verify(chroma).queryLaws(anyString(), anyInt());
        verify(chroma).queryExtendedCases(anyString(), anyInt());
        verify(chroma, never()).queryTaxTribunals(anyString(), anyInt());
    }

    @Test
    void generalQueryDoesNotCallTaxCollectionEvenWhenFlagsEnabled() {
        ChromaSearchService chroma = mock(ChromaSearchService.class);
        LegalRetrievalService service = service(chroma, true, true);

        service.retrieveForSession(request("개인정보 유출 책임과 손해배상"));

        verify(chroma).queryLaws(anyString(), anyInt());
        verify(chroma).queryExtendedCases(anyString(), anyInt());
        verify(chroma, never()).queryTaxTribunals(anyString(), anyInt());
    }

    @Test
    void taxQueryKeepsGeneralCaseSearchAndAddsTaxCollection() {
        ChromaSearchService chroma = mock(ChromaSearchService.class);
        when(chroma.queryTaxTribunals(anyString(), anyInt())).thenReturn(List.of(
                RetrievedChunk.builder()
                        .chunkId("tax_1_p1")
                        .sourceType("TAX_TRIBUNAL")
                        .chunkText("세금계산서 매입세액 불공제 관련 본문입니다.")
                        .metadata(Map.of("doc_number", "조심2024서0001"))
                        .distance(0.1)
                        .build()
        ));
        LegalRetrievalService service = service(chroma, true, true);

        service.retrieveForSession(request("가공 세금계산서 가산세 감면"));

        verify(chroma).queryLaws(anyString(), anyInt());
        verify(chroma).queryExtendedCases(anyString(), anyInt());
        verify(chroma).queryTaxTribunals(anyString(), anyInt());
    }

    @Test
    void taxKeywordInFollowUpQuestionAddsTaxCollection() {
        ChromaSearchService chroma = mock(ChromaSearchService.class);
        when(chroma.queryTaxTribunals(anyString(), anyInt())).thenReturn(List.of(
                RetrievedChunk.builder()
                        .chunkId("tax_2_p1")
                        .sourceType("TAX_TRIBUNAL")
                        .chunkText("부가가치세 매입세액 공제와 세금계산서 증빙 관련 본문입니다.")
                        .metadata(Map.of("doc_number", "조심2024중0002"))
                        .distance(0.1)
                        .build()
        ));
        LegalRetrievalService service = service(chroma, true, true);
        SessionCreateRequest request = request("외주 개발 계약 검토");
        request.setFollowUpQuestions(List.of(Map.of(
                "targetAgent", "risk",
                "message", "VAT와 부가가치세 매입세액 공제, 세금계산서 증빙 누락 시 환수 위험을 확인해주세요."
        )));

        service.retrieveForSession(request);

        verify(chroma).queryLaws(anyString(), anyInt());
        verify(chroma).queryExtendedCases(anyString(), anyInt());
        verify(chroma).queryTaxTribunals(anyString(), anyInt());
    }

    private LegalRetrievalService service(ChromaSearchService chroma, boolean taxEnabled, boolean taxRoutingEnabled) {
        when(chroma.queryLaws(anyString(), anyInt())).thenReturn(List.of());
        when(chroma.queryExtendedCases(anyString(), anyInt())).thenReturn(List.of());
        RagProperties properties = new RagProperties();
        properties.setEnabled(true);
        properties.getTopK().setLaw(3);
        properties.getTopK().setCaze(2);
        properties.getChroma().setCaseSearchMode("extended");
        properties.getChroma().setExtendedCasesCollection("legal_case_chunks_full");
        properties.getChroma().setExtendedCasesTopK(2);
        properties.getChroma().getTax().setEnabled(taxEnabled);
        properties.getChroma().getTax().setRoutingEnabled(taxRoutingEnabled);
        properties.getChroma().getTax().setTopK(3);
        properties.getChroma().getTax().setCandidateTopK(15);
        properties.getChroma().getTax().setMinBodyLength(50);
        return new LegalRetrievalService(properties, chroma, new EvidenceAssembler(), new TaxQueryRouter());
    }

    private SessionCreateRequest request(String situation) {
        SessionCreateRequest request = new SessionCreateRequest();
        request.setCompanyName("테스트 회사");
        request.setIndustry("서비스");
        request.setReviewType("계약");
        request.setSituation(situation);
        request.setContent("검토 대상 문장");
        return request;
    }
}
