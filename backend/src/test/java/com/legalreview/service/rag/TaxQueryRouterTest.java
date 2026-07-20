package com.legalreview.service.rag;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TaxQueryRouterTest {

    private final TaxQueryRouter router = new TaxQueryRouter();

    @Test
    void detectsTaxRelatedQueries() {
        assertThat(router.isTaxRelated("부가가치세 매입세액 불공제")).isTrue();
        assertThat(router.isTaxRelated("가공 세금계산서 가산세 감면")).isTrue();
        assertThat(router.isTaxRelated("법인세 손금 산입 가능 여부")).isTrue();
        assertThat(router.isTaxRelated("상속세 평가 기준")).isTrue();
        assertThat(router.isTaxRelated("프리랜서 외주 계약 원천징수")).isTrue();
    }

    @Test
    void ignoresGeneralLegalQueries() {
        assertThat(router.isTaxRelated("근로계약 해지 절차")).isFalse();
        assertThat(router.isTaxRelated("개인정보 유출 책임")).isFalse();
        assertThat(router.isTaxRelated("임대차 계약 갱신")).isFalse();
        assertThat(router.isTaxRelated(null)).isFalse();
        assertThat(router.isTaxRelated("   ")).isFalse();
    }
}
