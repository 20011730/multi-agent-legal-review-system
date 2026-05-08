package com.legalreview.service;

import com.legalreview.dto.response.EvidenceDto;
import com.legalreview.dto.response.LawSearchItemDto;
import com.legalreview.dto.response.LawSearchResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 법제처 OPEN API를 통한 법령/판례 검색 서비스.
 * XML 응답을 파싱하여 DTO로 변환한다.
 * verdict/review detail에서 evidence 후보로 재사용 가능.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LawSearchService {

    private static final int DEFAULT_DISPLAY = 10;

    private final LawApiClient lawApiClient;

    // ── 법령 검색 ──

    public LawSearchResponse searchLaws(String query) {
        return searchLaws(query, DEFAULT_DISPLAY);
    }

    public LawSearchResponse searchLaws(String query, int display) {
        if (!lawApiClient.isConfigured()) {
            log.warn("LAW_API_OC가 설정되지 않아 법령 검색을 건너뜁니다.");
            return emptyResponse(query);
        }

        try {
            String xml = lawApiClient.searchLaws(query, display);
            return parseLawXml(query, xml);
        } catch (Exception e) {
            log.error("법령 검색 실패: query={}", query, e);
            return emptyResponse(query);
        }
    }

    // ── 판례 검색 ──

    public LawSearchResponse searchCases(String query) {
        return searchCases(query, DEFAULT_DISPLAY);
    }

    public LawSearchResponse searchCases(String query, int display) {
        if (!lawApiClient.isConfigured()) {
            log.warn("LAW_API_OC가 설정되지 않아 판례 검색을 건너뜁니다.");
            return emptyResponse(query);
        }

        try {
            String xml = lawApiClient.searchCases(query, display);
            return parseCaseXml(query, xml);
        } catch (Exception e) {
            log.error("판례 검색 실패: query={}", query, e);
            return emptyResponse(query);
        }
    }

    // ── EvidenceDto 변환 (verdict/review 재사용용) ──

    /**
     * 법령 검색 결과를 기존 EvidenceDto 형식으로 변환.
     * SessionService 등에서 evidence 후보로 바로 사용 가능.
     */
    public List<EvidenceDto> searchLawsAsEvidence(String query) {
        LawSearchResponse resp = searchLaws(query);
        List<EvidenceDto> result = resp.getEvidences().stream()
                .map(LawSearchItemDto::toEvidenceDto)
                .toList();
        log.info("[LAW-DEBUG] searchLawsAsEvidence: query='{}', totalCount={}, dtoCount={}",
                query, resp.getTotalCount(), result.size());
        if (!result.isEmpty()) {
            EvidenceDto sample = result.get(0);
            log.info("[LAW-DEBUG]   법령 샘플: title='{}', sourceType={}, refId='{}'",
                    sample.getTitle(), sample.getSourceType(), sample.getReferenceId());
        }
        return result;
    }

    /**
     * 판례 검색 결과를 기존 EvidenceDto 형식으로 변환.
     */
    public List<EvidenceDto> searchCasesAsEvidence(String query) {
        LawSearchResponse resp = searchCases(query);
        List<EvidenceDto> result = resp.getEvidences().stream()
                .map(LawSearchItemDto::toEvidenceDto)
                .toList();
        log.info("[LAW-DEBUG] searchCasesAsEvidence: query='{}', totalCount={}, dtoCount={}",
                query, resp.getTotalCount(), result.size());
        if (!result.isEmpty()) {
            EvidenceDto sample = result.get(0);
            log.info("[LAW-DEBUG]   판례 샘플: title='{}', sourceType={}, refId='{}'",
                    sample.getTitle(), sample.getSourceType(), sample.getReferenceId());
        }
        return result;
    }

    // ── 법령 XML 파싱 ──

    private LawSearchResponse parseLawXml(String query, String xml) {
        if (xml == null || xml.isBlank()) {
            return emptyResponse(query);
        }

        Document doc = parseXmlDocument(xml);
        if (doc == null) {
            return emptyResponse(query);
        }

        int totalCount = parseIntSafe(getTextContent(doc.getDocumentElement(), "totalCnt"));
        List<LawSearchItemDto> items = new ArrayList<>();

        NodeList lawNodes = doc.getElementsByTagName("law");
        log.debug("법령 검색 파싱: totalCnt={}, law 노드 수={}", totalCount, lawNodes.getLength());

        for (int i = 0; i < lawNodes.getLength(); i++) {
            Element el = (Element) lawNodes.item(i);

            String title = text(el, "법령명한글");
            if (title.isEmpty()) continue;

            String shortName = text(el, "법령약칭명");
            String dept = text(el, "소관부처명");
            String enforceDate = text(el, "시행일자");
            String revisionType = text(el, "제개정구분명");
            String link = text(el, "법령상세링크");
            String lawId = text(el, "법령일련번호");

            // snippet: Python 서버와 유사한 형식
            List<String> snippetParts = new ArrayList<>();
            if (!shortName.isEmpty()) snippetParts.add("약칭: " + shortName);
            if (!revisionType.isEmpty()) snippetParts.add(revisionType);
            if (!enforceDate.isEmpty()) snippetParts.add("시행일: " + enforceDate);
            String snippet = snippetParts.isEmpty() ? title : String.join(" | ", snippetParts);

            items.add(LawSearchItemDto.builder()
                    .sourceType("LAW")
                    .title(title)
                    .snippet(snippet)
                    .referenceId(lawId)
                    .articleOrCourt(dept)
                    .url(buildUrl(link))
                    .build());
        }

        return LawSearchResponse.builder()
                .keyword(query)
                .totalCount(totalCount)
                .evidences(items)
                .build();
    }

    // ── 판례 XML 파싱 ──

    private LawSearchResponse parseCaseXml(String query, String xml) {
        if (xml == null || xml.isBlank()) {
            return emptyResponse(query);
        }

        Document doc = parseXmlDocument(xml);
        if (doc == null) {
            return emptyResponse(query);
        }

        int totalCount = parseIntSafe(getTextContent(doc.getDocumentElement(), "totalCnt"));
        List<LawSearchItemDto> items = new ArrayList<>();

        NodeList precNodes = doc.getElementsByTagName("prec");
        log.debug("판례 검색 파싱: totalCnt={}, prec 노드 수={}", totalCount, precNodes.getLength());

        for (int i = 0; i < precNodes.getLength(); i++) {
            Element el = (Element) precNodes.item(i);

            String caseName = text(el, "사건명");
            if (caseName.isEmpty()) continue;

            String caseNumber = text(el, "사건번호");
            String judgmentDate = text(el, "선고일자");
            String courtName = text(el, "법원명");
            String caseType = text(el, "사건종류명");
            String link = text(el, "판례상세링크");
            String precId = text(el, "판례일련번호");

            // snippet: Python 서버와 유사한 형식
            List<String> snippetParts = new ArrayList<>();
            if (!caseType.isEmpty()) snippetParts.add(caseType);
            if (!judgmentDate.isEmpty()) snippetParts.add("선고일: " + judgmentDate);
            if (!courtName.isEmpty()) snippetParts.add(courtName);
            String snippet = snippetParts.isEmpty() ? caseName : String.join(" | ", snippetParts);

            items.add(LawSearchItemDto.builder()
                    .sourceType("CASE")
                    .title(caseName)
                    .snippet(snippet)
                    .referenceId(!caseNumber.isEmpty() ? caseNumber : precId)
                    .articleOrCourt(courtName)
                    .url(buildUrl(link))
                    .build());
        }

        return LawSearchResponse.builder()
                .keyword(query)
                .totalCount(totalCount)
                .evidences(items)
                .build();
    }

    // ── 유틸리티 ──

    private LawSearchResponse emptyResponse(String query) {
        return LawSearchResponse.builder()
                .keyword(query)
                .totalCount(0)
                .evidences(Collections.emptyList())
                .build();
    }

    private Document parseXmlDocument(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // XXE 방지 (DOCTYPE 허용하되 외부 엔티티만 차단)
            // 법제처 API XML 응답에 DOCTYPE이 포함될 수 있으므로 disallow-doctype-decl 은 사용하지 않음
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.parse(new InputSource(new StringReader(xml)));
        } catch (Exception e) {
            log.error("[LAW-DEBUG] XML 파싱 실패: {}", e.getMessage());
            log.info("[LAW-DEBUG] 파싱 실패한 XML 원문 (앞 500자): {}",
                    xml != null && xml.length() > 500 ? xml.substring(0, 500) : xml);
            return null;
        }
    }

    private String getTextContent(Element parent, String tagName) {
        NodeList nodes = parent.getElementsByTagName(tagName);
        if (nodes.getLength() > 0 && nodes.item(0).getTextContent() != null) {
            return nodes.item(0).getTextContent().trim();
        }
        return "";
    }

    private String text(Element parent, String tagName) {
        NodeList nodes = parent.getElementsByTagName(tagName);
        if (nodes.getLength() > 0 && nodes.item(0).getTextContent() != null) {
            return nodes.item(0).getTextContent().trim();
        }
        return "";
    }

    private String buildUrl(String link) {
        if (link == null || link.isEmpty()) return "";
        // 법제처 응답의 상세링크에 OC 값이 포함되어 있으므로 제거
        String cleaned = link.replaceAll("OC=[^&]*&?", "");
        if (cleaned.startsWith("http")) return cleaned;
        return "https://www.law.go.kr" + cleaned;
    }

    private int parseIntSafe(String value) {
        if (value == null || value.isEmpty()) return 0;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
