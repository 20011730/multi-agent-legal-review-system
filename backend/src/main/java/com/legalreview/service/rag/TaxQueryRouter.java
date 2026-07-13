package com.legalreview.service.rag;

import org.springframework.stereotype.Component;

import java.util.Set;

@Component
public class TaxQueryRouter {

    private static final Set<String> TAX_KEYWORDS = Set.of(
            "조세", "세금", "과세", "부가가치세", "부가세", "법인세", "소득세",
            "종합소득세", "양도소득세", "상속세", "증여세", "원천징수", "매입세액",
            "세금계산서", "손금", "손금산입", "손금불산입", "필요경비", "가산세",
            "경정청구", "조세심판", "세무", "과세처분", "심판청구", "국세",
            "세액", "세율", "공제", "불공제"
    );

    public boolean isTaxRelated(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        for (String keyword : TAX_KEYWORDS) {
            if (text.contains(keyword)) {
                return true;
            }
        }
        return false;
    }
}
