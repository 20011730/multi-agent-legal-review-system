package com.legalreview.service.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.legalreview.domain.LawList;
import com.legalreview.repository.LawListRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.List;
import java.util.Optional;

/**
 * 법령 목록(law_list) 메타데이터 시드 적재 서비스.
 *
 * 역할:
 *   - classpath:rag-seed/law-list.json 을 읽어 PostgreSQL law_list 테이블에 upsert
 *   - lawMst(PK)가 이미 존재하면 갱신, 없으면 신규 저장
 *
 * 기존 {@link LegalIngestionService}와 분리한 이유:
 *   - LegalIngestionService는 법령/판례 본문(laws.json/cases.json)을 다루며 LegalChunker → Chroma upsert까지 책임
 *   - LawList는 본문이 아닌 "목록 메타데이터" — chunking/Chroma 적재 대상이 아님
 *   - 따라서 별도 서비스로 분리하여 책임 명확화
 *
 * 호출:
 *   - {@code POST /api/rag/ingest/law-list} (RagDevController)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LawListIngestionService {

    private final LawListRepository lawListRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String SEED_PATH = "rag-seed/law-list.json";

    /**
     * classpath의 law-list.json을 읽어 PostgreSQL에 upsert.
     * @return 저장(신규+갱신)된 row 수
     */
    @Transactional
    public int ingestLawListSeed() {
        List<LawList> seeds = loadSeed();
        if (seeds == null || seeds.isEmpty()) {
            log.warn("[LAW-LIST-INGEST] 시드 파일이 비어 있거나 로드 실패 — 스킵");
            return 0;
        }

        int saved = 0;
        for (LawList seed : seeds) {
            if (seed.getLawMst() == null) {
                log.warn("[LAW-LIST-INGEST] lawMst가 null인 row 발견 — 스킵: lawId={}", seed.getLawId());
                continue;
            }
            saved += upsertOne(seed);
        }
        log.info("[LAW-LIST-INGEST] 적재 완료 — saved={}, totalSeeds={}", saved, seeds.size());
        return saved;
    }

    /**
     * 단건 upsert.
     * lawMst 기준으로 기존 row가 있으면 필드 값을 갱신, 없으면 신규 저장.
     * @return 저장된 경우 1, 실패 시 0
     */
    private int upsertOne(LawList seed) {
        Optional<LawList> existing = lawListRepository.findById(seed.getLawMst());
        LawList target = existing.orElseGet(LawList::new);

        // PK 포함 모든 필드를 시드 값으로 덮어쓰기 (외부 데이터 그대로 반영)
        target.setLawMst(seed.getLawMst());
        target.setLawId(seed.getLawId());
        target.setCurrentHistoryCode(seed.getCurrentHistoryCode());
        target.setLawNameKr(seed.getLawNameKr());
        target.setLawNameShort(seed.getLawNameShort());
        target.setLawTypeName(seed.getLawTypeName());
        target.setDeptName(seed.getDeptName());
        target.setDeptCode(seed.getDeptCode());
        target.setPromulgateDate(seed.getPromulgateDate());
        target.setEnforceDate(seed.getEnforceDate());
        target.setPromulgateNo(seed.getPromulgateNo());
        target.setAmendType(seed.getAmendType());
        target.setDetailLink(seed.getDetailLink());
        target.setSelfOtherLaw(seed.getSelfOtherLaw());
        target.setJointDeptInfo(seed.getJointDeptInfo());
        target.setJointPromulgateNo(seed.getJointPromulgateNo());

        try {
            lawListRepository.save(target);
            log.debug("[LAW-LIST-INGEST] {} lawMst={}, lawId={}, name={}",
                    existing.isPresent() ? "갱신" : "신규",
                    seed.getLawMst(), seed.getLawId(), seed.getLawNameKr());
            return 1;
        } catch (Exception e) {
            log.error("[LAW-LIST-INGEST] save 실패 (lawMst={}): {}", seed.getLawMst(), e.getMessage());
            return 0;
        }
    }

    private List<LawList> loadSeed() {
        try (InputStream is = new ClassPathResource(SEED_PATH).getInputStream()) {
            return objectMapper.readValue(
                    is,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, LawList.class)
            );
        } catch (Exception e) {
            log.error("[LAW-LIST-INGEST] 시드 로드 실패: {}", e.getMessage());
            return List.of();
        }
    }
}
