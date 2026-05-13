---
tags:
- sentence-transformers
- sentence-similarity
- feature-extraction
- generated_from_trainer
- dataset_size:3122
- loss:MultipleNegativesRankingLoss
base_model: intfloat/multilingual-e5-base
widget:
- source_sentence: 'query: 2011년도에 이어 같은 유치원으로 재원을 했습니다. 2012년도 5세 누리과정이라고 20만원 지원해
    준다 하더니, 유치원에서 원비 인상을 총 116,000원이나 했네요. 나라에서 지원해주면 뭐합니다. 유치원에서 이런식으로 인상을 해서 반 이상을
    가져 가는데 정말 한숨만 나옵니다. 이를 해결할 방법이 없나요?'
  sentences:
  - 'passage: 골프접대비가 1회 100만원 이하일 경우 직무와 관련하여 골프접대를 받은 공무원 및 공무원에게 골프 접대를 한 자 모두 골프접대비
    가액의 2배 이상 5배 이하에 상당하는 금액의 과태료 부과대상입니다.'
  - 'passage: 은 마케팅팀 팀장으로서, 채용관련 업무의 결재선상에 있거나 채용 관련 업무담당자에 대한 지휘감독권이 있다고 볼 수 없으므로,
    부정청탁의 상대방인 ''직무를 수행하는 공직자등''에 해당한다고 보기는 어렵습니다.'
  - 'passage: 유치원 교육비 인상과 관련하여 교육부는 " 우리부는 학부모의 유아교육비 부담완화를 위해 2012년 5세 누리과정을 시행하며
    소득구분 없이 월 20만원을 지원하게 됩니다. 일부 유치원에서 과도하게 유치원비를 인상하는 사례가 있어, 우리 부는 전국 유치원의 수업료 등을
    전수 조사하여 현황을 파악후 과다인상 억제를 위해 행정지도하며, 필요시 감사를 실시하는 등 다각적인 방안을 추진할 예정입니다."라고 회신하였습니다.회신일
    2012. 1. 4. 유아교육과 참조. 위 회신에 비추어 볼 때, 유치원 교육비의 인상을 해결하기 위하여 교육부는 전국 유치원의 수업료 등을
    전수 조사하여 현황 파악 후 과다인상 억제를 위한 행정지도를 행하며, 필요시 감사를 실시하는 등의 방법을 동원하고 있습니다.'
- source_sentence: 'query: 재건축추진위원장인 피고인이 재건축조합의 조속한 설립인가를 위해 이를 관할하는 구청의 주택과장에게 두
    차례에 걸쳐 18,750원과 12,000원 상당의 점심식사를 제공한 경우, 피고인과 공무원 사이에 특수한 사적 친분관계는 없었던 점 및 이익을
    수수한 경위와 시기 등을 종합하여 보면 사회상규에 해당하나요?'
  sentences:
  - 'passage: 1. 교직원등의 배우자는 ''공직자등''에 해당합니다. 즉, 교직원등의 배우자는 직무와 관련한 금품등을 수수하는 것이 금지되고,
    이 경우 교직원등이 이 사실을 알고도 신고하지 않은 경우 해당 교직원등이 처벌받게 됩니다. 2. 여기서 배우자는 법률에서 명시적 규정으로 사실혼
    배우자를 포함하고 있지 않는 한 법률혼 배우자만을 의미합니다.'
  - 'passage: 학생들이 교사의 결혼을 축하하는 의미로 식장에서 축가를 부르는 것은 청탁금지법상 금품등에 해당한다고 보기 어렵고, 설령 금품등에
    해당한다고 하더라도 제8조 제3항 제8호에 따라 사회상규상 허용될 수 있습니다. 청탁금지법 제8조 제3항 제8호는 다른 법령기준 또는 사회상규에
    따라 허용되는 금품등을 예외사유로 인정하고 있습니다. 이때 사회상규는 수수의 동기목적시기경위, 직무의 내용, 당사자의 관계, 수수한 금품등의
    가액, 청탁과 결부 여부 등을 종합적으로 고려하여 판단합니다.'
  - 'passage: 단순히 사교적, 의례적 범위 내의 것이라고 볼 수는 없습니다.'
- source_sentence: 'query: 면 지역 병설유치원에서 소수의 원아로 운영되는 유치원의 운영자입니다. 최근에 조기입학을 희망하는 유아가
    취원하여 3년 무상교육비 지원이 완료되었고, 올해부터 교육비를 납부해야 하는데, 조기입학자인 해당 유아 1명을 제외하고는 누리과정비를 지원받고
    있어 수익자부담경비가 전혀 없고, 표준학교운영비만으로도 운영이 가능할 경우, 해당 원아가 누리과정비 지원에서는 제외되나요?'
  sentences:
  - 'passage: 유아교육법 제24조 및 유아교육법 시행령 제29조에 따르면 초등학교 취학 직전아동에 대한 무상교육유아학비 또는 보육료 지원은
    3년을 초과할 수 없고 해당기간 중에는 보건복지부 보육사업 안내지침에서 보는 바와 같이 양육수당과 중복하여 지원을 받을 수 없도록 규정하고
    있습니다. 다만, 무상교육 기간 3년을 초과한 아동이 어린이집 또는 유치원 재원 시에는 만 84개월 미만까지 양육수당 지원 가능하다고 봅니다.
    또한, 취학 직전 아동에 대한 무상교육 비용 지원은 교육부장관이 예산의 범위에서 관계 행정기관의 장과 협의하여 고시한 원아 1인당 지원 단가에
    의하되 아동의 보호자에게 지원하는 것을 원칙으로 하고 있습니다. 또한, 초 중등교육법 제13조에 의하면, 모든 국민은 보호하는 자녀 또는 아동이
    6세가 된 날이 속하는 해의 다음 해 3월 1일에 그 자녀 또는 아동을 초등학교에 입학시켜야 하고, 초등학교를 졸업할 때까지 다니게 하여야
    한다. 모든 국민은 제1항에도 불구하고 그가 보호하는 자녀 또는 아동이 5세가 된 날이 속하는 해의 다음 해 또는 7세가 된 날이 속하는 해의
    다음 해에 그 자녀 또는 아동을 초등학교에 입학시킬 수 있다. 이 경우에도 그 자녀 또는 아동이 초등학교에 입학한 해의 3월 1일부터 졸업할
    때까지 초등학교에 다니게 하여야 한다. 모든 국민은 보호하는 자녀 또는 아동이 초등학교를 졸업한 학년의 다음 학년 초에 그 자녀 또는 아동을
    중학교에 입학시켜야 하고, 중학교를 졸업할 때까지 다니게 하여야 한다. 제1항부터 제3항까지의 규정에 따른 취학 의무의 이행과 이행 독려 등에
    필요한 사항은 대통령령으로 정한다고 규정하고 있습니다. 따라서 이러한 규정에 비추어 보면, 다른 아동들에 대한 무상교육 비용 지원으로 별도
    수납하는 수익자부담경비가 전혀 없다 하더라도 무상교육 지원 비용 만큼은 수익자가 비용을 부담하도록 하는 것이 위 법령 및 지침, 초 중등교육법
    제13조에 따른 취학의무 부여 및 예외적 유예 허용, 다른 아동들과의 형평성, 무상교육 지원 비용과 양육수당의 중복지원을 불인정하는 등 취지에
    부합하는 것으로 판단됩니다. 다만, 양육수당을 지원받는 경우 그 초과액에 대해서는 입학금 및 수업료를 제외한 그 밖의 납부금에 대해서 명시적인
    면제 또는 감면 규정이 없는 점을 감안하여 유아교육법 시행규칙 제7조에 준하여 처리할 수 있을 것으로 봅니다.'
  - 'passage: 1. 논문심사 교수들은 논문에 대한 심사 평가 등 업무를 담당하며 논문 심사 통과 여부와 관련하여 사실상 또는 실질적인 영향력을
    미칠 가능성이 있는 점 논문심사 결과에 따라 대학원생은 직접 이익 또는 불이익을 받게 되는 점 금품등 수수로 인하여 직무집행의 공정성이 의심받게
    될 수 있는 상황인 점 등을 고려할 때 교수들과 학생 간에는 직무관련성이 인정될 수 있습니다. 2. 따라서 인당 3만원 이내의 식사라 할지라도
    사교의례 등의 목적으로 제공된 음식물이라고 보기 어려우므로 청탁금지법상 제재 대상에 해당할 수 있습니다.'
  - 'passage: 대학부설 평생교육원에서 초중고등학생 대상 교육과정의 운영 가부와 관련하여 교육부는 " 대학부설 평생교육원에서는 초중고등학생을
    대상으로 하는 과정을 개설할 수 없음을 알려드립니다. "학원의 설립운영 및 과외교습에 관한 법률" 일부개정''11.7.25으로, 동법 제2조의2학원의
    종류제1항 1호 다목에 의하면 "초중등교육법" 제2조에 따른 학교의 학생에 대해 교습을 하려고 하면 학원으로 등록하여 교습을 하도록 규정하고
    있습니다. 다만, 국가, 지방자치단체, 시도교육청교육지원청, 학교 포함, 공공기관으로부터 위탁MOU 체결, 예산 전부 또는 일부 지원을 받아
    학교에서 주관하여 운영하는 경우에는 가능함을 알려드립니다."라고 회신하였습니다.회신일 20130802 1107 평생직업교육국 평생학습정책과
    참조. 위 회신에 비추어 볼 때, 초중등교육법 제2조에 따른 학교의 학생에 대해 교습을 하고자 하는 경우에는 학원으로 등록하여 교습하여야 하므로,
    원칙적으로 대학 부설의 평생교육원에서 청소년을 대상으로 "미리 듣는 대학 강의 청소년을 위한 수사학리더의 사고와 표현원리"이라는 교육과정을
    운영할 수는 없을 것으로 보입니다.'
- source_sentence: 'query: SW교사 및 정보컴퓨터교사의 채용 방식에 대해서 궁금합니다.'
  sentences:
  - 'passage: 자격증의 나이스 입력과 관련하여 교육부는 "외고 등 특목고진학을 위한 선행학습에 따른 사교육을 유발하는 입학전형 요소 배제의
    일환으로 초중학교는 2010학년도부터 고등학교는 2011학년도 이후부터는 학교생활기록부의 자격증 및 인증 취득상황란에 각종 인증 취득사항은
    입력하지 않습니다. 다만, 고등학생이 재학중 취득한 국가기술자격법에 의한 국가기술자격증, 개별법령에 의한 국가자격증, 자격기본법에 의한 국가공인을
    받은 민간자격증 중 기술관련 자격증에 한하여 입력합니다."라고 회신하였습니다.회신일 2011. 9. 1. 학교선진화과 참조. 위 회신에 비추어
    볼 때, 특목고진학을 위한 선행학습에 따른 사교육을 유발하는 입학전형 요소 배제의 일환으로, 원칙적으로 학교생활기록부의 자격증 및 인증 취득상황란에
    각종 인증 취득사항은 입력하지 않으므로, 질의 사안의 경우 국제공인자격증 CCNA, LPIC, OCJP의 취득은 나이스에 입력할 수 없을 것으로
    보입니다.'
  - 'passage: 공직자등 또는 배우자가 지체 없이 금품등을 반환 또는 인도하거나 거부의 의사를 표시한 경우는 처벌대상에서 제외됩니다.'
  - 'passage: SW교사정보컴퓨터교사의 채용과 관련하여 교육부는 "교사 채용과 관련하여, 현재 중등 정보컴퓨터 교사는 시도교육청의 중등교사
    임용시험을 통해 공개 채용하고 있으며, 기간제 교사 채용은 학교와 시도교육청의 교원 수급 상황에 따라 이루어집니다. 교원 임용에 관한 자세한
    사항은 시도교육청에 문의하시기 바랍니다."라고 회신하였습니다.20180509 미래교육기획과 참조. 위 회신에 비추어 볼 때, SW교사정보컴퓨터교사는
    시도교육청의 중등교사 임용시험을 통해 공개 채용하고 있으며, 기간제 교사 채용은 학교와 시도교육청의 교원 수급 상황에 따라 이루어집니다.'
- source_sentence: 'query: 공무원이 결혼을 앞둔 여자친구 혹은 남자친구로부터 100만원을 초과하는 명품 가방을 받을 경우 처벌대상인가?'
  sentences:
  - 'passage: 다른 부정청탁행위와 달리 공공기관의 재화용역 관련 부정청탁행위는 정상적인 거래관행을 판단 기준으로 제시합니다. 이는 공공기관이
    생산공급관리하는 재화 및 용역을 특정 개인단체법인에게 법령에서 정하는 가격 또는 정상적인 거래관행에서 벗어나 매각교환사용수익점유하도록 하는
    행위를 의미합니다.'
  - 'passage: 직무와 관련하여 1회 100만원 이하의 금품등을 수수한 경우 대가성이 인정되면 뇌물죄가 성립되어 형사처벌 대상에 해당합니다.'
  - 'passage: 결혼을 앞둔 연인 사이인 점에 비추어 100만원을 초과하는 고액의 명품 가방이라도 사회상규에 따라 허용되는 금품등에 해당하여
    수수 금지 금품 등이 아닙니다.'
pipeline_tag: sentence-similarity
library_name: sentence-transformers
---

# SentenceTransformer based on intfloat/multilingual-e5-base

This is a [sentence-transformers](https://www.SBERT.net) model finetuned from [intfloat/multilingual-e5-base](https://huggingface.co/intfloat/multilingual-e5-base). It maps sentences & paragraphs to a 768-dimensional dense vector space and can be used for semantic textual similarity, semantic search, paraphrase mining, text classification, clustering, and more.

## Model Details

### Model Description
- **Model Type:** Sentence Transformer
- **Base model:** [intfloat/multilingual-e5-base](https://huggingface.co/intfloat/multilingual-e5-base) <!-- at revision d128750597153bb5987e10b1c3493a34e5a4502a -->
- **Maximum Sequence Length:** 512 tokens
- **Output Dimensionality:** 768 dimensions
- **Similarity Function:** Cosine Similarity
<!-- - **Training Dataset:** Unknown -->
<!-- - **Language:** Unknown -->
<!-- - **License:** Unknown -->

### Model Sources

- **Documentation:** [Sentence Transformers Documentation](https://sbert.net)
- **Repository:** [Sentence Transformers on GitHub](https://github.com/UKPLab/sentence-transformers)
- **Hugging Face:** [Sentence Transformers on Hugging Face](https://huggingface.co/models?library=sentence-transformers)

### Full Model Architecture

```
SentenceTransformer(
  (0): Transformer({'max_seq_length': 512, 'do_lower_case': False}) with Transformer model: XLMRobertaModel 
  (1): Pooling({'word_embedding_dimension': 768, 'pooling_mode_cls_token': False, 'pooling_mode_mean_tokens': True, 'pooling_mode_max_tokens': False, 'pooling_mode_mean_sqrt_len_tokens': False, 'pooling_mode_weightedmean_tokens': False, 'pooling_mode_lasttoken': False, 'include_prompt': True})
  (2): Normalize()
)
```

## Usage

### Direct Usage (Sentence Transformers)

First install the Sentence Transformers library:

```bash
pip install -U sentence-transformers
```

Then you can load this model and run inference.
```python
from sentence_transformers import SentenceTransformer

# Download from the 🤗 Hub
model = SentenceTransformer("sentence_transformers_model_id")
# Run inference
sentences = [
    'query: 공무원이 결혼을 앞둔 여자친구 혹은 남자친구로부터 100만원을 초과하는 명품 가방을 받을 경우 처벌대상인가?',
    'passage: 결혼을 앞둔 연인 사이인 점에 비추어 100만원을 초과하는 고액의 명품 가방이라도 사회상규에 따라 허용되는 금품등에 해당하여 수수 금지 금품 등이 아닙니다.',
    'passage: 다른 부정청탁행위와 달리 공공기관의 재화용역 관련 부정청탁행위는 정상적인 거래관행을 판단 기준으로 제시합니다. 이는 공공기관이 생산공급관리하는 재화 및 용역을 특정 개인단체법인에게 법령에서 정하는 가격 또는 정상적인 거래관행에서 벗어나 매각교환사용수익점유하도록 하는 행위를 의미합니다.',
]
embeddings = model.encode(sentences)
print(embeddings.shape)
# [3, 768]

# Get the similarity scores for the embeddings
similarities = model.similarity(embeddings, embeddings)
print(similarities.shape)
# [3, 3]
```

<!--
### Direct Usage (Transformers)

<details><summary>Click to see the direct usage in Transformers</summary>

</details>
-->

<!--
### Downstream Usage (Sentence Transformers)

You can finetune this model on your own dataset.

<details><summary>Click to expand</summary>

</details>
-->

<!--
### Out-of-Scope Use

*List how the model may foreseeably be misused and address what users ought not to do with the model.*
-->

<!--
## Bias, Risks and Limitations

*What are the known or foreseeable issues stemming from this model? You could also flag here known failure cases or weaknesses of the model.*
-->

<!--
### Recommendations

*What are recommendations with respect to the foreseeable issues? For example, filtering explicit content.*
-->

## Training Details

### Training Dataset

#### Unnamed Dataset


* Size: 3,122 training samples
* Columns: <code>sentence_0</code> and <code>sentence_1</code>
* Approximate statistics based on the first 1000 samples:
  |         | sentence_0                                                                          | sentence_1                                                                           |
  |:--------|:------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------|
  | type    | string                                                                              | string                                                                               |
  | details | <ul><li>min: 14 tokens</li><li>mean: 52.65 tokens</li><li>max: 143 tokens</li></ul> | <ul><li>min: 12 tokens</li><li>mean: 132.21 tokens</li><li>max: 512 tokens</li></ul> |
* Samples:
  | sentence_0                                                                                                       | sentence_1                                                                                                                                                                                                                                              |
  |:-----------------------------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | <code>query: 청탁금지법 제5조 제1항 제8호의 기금은 무엇입니까?</code>                                                                | <code>passage: 기금은 특정목적 및 시책추진을 위해 특정자금을 운용할 필요가 있는 경우 설치합니다.</code>                                                                                                                                                                                    |
  | <code>query: 법인 소속 종업원이 업무와 관련하여 부정청탁을 한 경우 제3자인 법인을 위한 부정청탁에 해당하여 부정청탁을 한 종업원의 행위는 2천만원 이하의 과태료 부과대상인가요?</code> | <code>passage: 법인 소속 종업원이 업무와 관련하여 부정청탁을 한 경우 제3자인 법인을 위한 부정청탁에 해당하여 부정청탁을 한 종업원의 행위는 2천만원 이하의 과태료 부과대상입니다.</code>                                                                                                                                      |
  | <code>query: 강연료 지급시 원고료를 별도로 지급해도 문제가 없는지?</code>                                                               | <code>passage: 개정된 청탁금지법 시행령대통령령 제28590호, 2018. 1. 17. 공포시행에 따라 공무원의 외부강의 사례금에 대한 직급별 구분이 폐지되고, 시간당 40만원으로 일원화되었습니다. 또한, 공무원은 1시간을 초과하여 강연을 하더라도 사례금 총액은 강의시간에 관계없이 1시간 상한액의 1.5배를 넘지 못합니다. 이에 따라 장관 등 공무원의 외부강의에 대하여 사례금은 최대 60만원까지 지급할 수 있습니다.</code> |
* Loss: [<code>MultipleNegativesRankingLoss</code>](https://sbert.net/docs/package_reference/sentence_transformer/losses.html#multiplenegativesrankingloss) with these parameters:
  ```json
  {
      "scale": 20.0,
      "similarity_fct": "cos_sim"
  }
  ```

### Training Hyperparameters
#### Non-Default Hyperparameters

- `per_device_train_batch_size`: 32
- `per_device_eval_batch_size`: 32
- `multi_dataset_batch_sampler`: round_robin

#### All Hyperparameters
<details><summary>Click to expand</summary>

- `overwrite_output_dir`: False
- `do_predict`: False
- `eval_strategy`: no
- `prediction_loss_only`: True
- `per_device_train_batch_size`: 32
- `per_device_eval_batch_size`: 32
- `per_gpu_train_batch_size`: None
- `per_gpu_eval_batch_size`: None
- `gradient_accumulation_steps`: 1
- `eval_accumulation_steps`: None
- `torch_empty_cache_steps`: None
- `learning_rate`: 5e-05
- `weight_decay`: 0.0
- `adam_beta1`: 0.9
- `adam_beta2`: 0.999
- `adam_epsilon`: 1e-08
- `max_grad_norm`: 1
- `num_train_epochs`: 3
- `max_steps`: -1
- `lr_scheduler_type`: linear
- `lr_scheduler_kwargs`: None
- `warmup_ratio`: 0.0
- `warmup_steps`: 0
- `log_level`: passive
- `log_level_replica`: warning
- `log_on_each_node`: True
- `logging_nan_inf_filter`: True
- `save_safetensors`: True
- `save_on_each_node`: False
- `save_only_model`: False
- `restore_callback_states_from_checkpoint`: False
- `no_cuda`: False
- `use_cpu`: False
- `use_mps_device`: False
- `seed`: 42
- `data_seed`: None
- `jit_mode_eval`: False
- `bf16`: False
- `fp16`: False
- `fp16_opt_level`: O1
- `half_precision_backend`: auto
- `bf16_full_eval`: False
- `fp16_full_eval`: False
- `tf32`: None
- `local_rank`: 0
- `ddp_backend`: None
- `tpu_num_cores`: None
- `tpu_metrics_debug`: False
- `debug`: []
- `dataloader_drop_last`: False
- `dataloader_num_workers`: 0
- `dataloader_prefetch_factor`: None
- `past_index`: -1
- `disable_tqdm`: False
- `remove_unused_columns`: True
- `label_names`: None
- `load_best_model_at_end`: False
- `ignore_data_skip`: False
- `fsdp`: []
- `fsdp_min_num_params`: 0
- `fsdp_config`: {'min_num_params': 0, 'xla': False, 'xla_fsdp_v2': False, 'xla_fsdp_grad_ckpt': False}
- `fsdp_transformer_layer_cls_to_wrap`: None
- `accelerator_config`: {'split_batches': False, 'dispatch_batches': None, 'even_batches': True, 'use_seedable_sampler': True, 'non_blocking': False, 'gradient_accumulation_kwargs': None}
- `parallelism_config`: None
- `deepspeed`: None
- `label_smoothing_factor`: 0.0
- `optim`: adamw_torch
- `optim_args`: None
- `adafactor`: False
- `group_by_length`: False
- `length_column_name`: length
- `project`: huggingface
- `trackio_space_id`: trackio
- `ddp_find_unused_parameters`: None
- `ddp_bucket_cap_mb`: None
- `ddp_broadcast_buffers`: False
- `dataloader_pin_memory`: True
- `dataloader_persistent_workers`: False
- `skip_memory_metrics`: True
- `use_legacy_prediction_loop`: False
- `push_to_hub`: False
- `resume_from_checkpoint`: None
- `hub_model_id`: None
- `hub_strategy`: every_save
- `hub_private_repo`: None
- `hub_always_push`: False
- `hub_revision`: None
- `gradient_checkpointing`: False
- `gradient_checkpointing_kwargs`: None
- `include_inputs_for_metrics`: False
- `include_for_metrics`: []
- `eval_do_concat_batches`: True
- `fp16_backend`: auto
- `push_to_hub_model_id`: None
- `push_to_hub_organization`: None
- `mp_parameters`: 
- `auto_find_batch_size`: False
- `full_determinism`: False
- `torchdynamo`: None
- `ray_scope`: last
- `ddp_timeout`: 1800
- `torch_compile`: False
- `torch_compile_backend`: None
- `torch_compile_mode`: None
- `include_tokens_per_second`: False
- `include_num_input_tokens_seen`: no
- `neftune_noise_alpha`: None
- `optim_target_modules`: None
- `batch_eval_metrics`: False
- `eval_on_start`: False
- `use_liger_kernel`: False
- `liger_kernel_config`: None
- `eval_use_gather_object`: False
- `average_tokens_across_devices`: True
- `prompts`: None
- `batch_sampler`: batch_sampler
- `multi_dataset_batch_sampler`: round_robin

</details>

### Framework Versions
- Python: 3.11.10
- Sentence Transformers: 3.3.1
- Transformers: 4.57.6
- PyTorch: 2.4.1+cu124
- Accelerate: 1.13.0
- Datasets: 4.8.4
- Tokenizers: 0.22.2

## Citation

### BibTeX

#### Sentence Transformers
```bibtex
@inproceedings{reimers-2019-sentence-bert,
    title = "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
    author = "Reimers, Nils and Gurevych, Iryna",
    booktitle = "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing",
    month = "11",
    year = "2019",
    publisher = "Association for Computational Linguistics",
    url = "https://arxiv.org/abs/1908.10084",
}
```

#### MultipleNegativesRankingLoss
```bibtex
@misc{henderson2017efficient,
    title={Efficient Natural Language Response Suggestion for Smart Reply},
    author={Matthew Henderson and Rami Al-Rfou and Brian Strope and Yun-hsuan Sung and Laszlo Lukacs and Ruiqi Guo and Sanjiv Kumar and Balint Miklos and Ray Kurzweil},
    year={2017},
    eprint={1705.00652},
    archivePrefix={arXiv},
    primaryClass={cs.CL}
}
```

<!--
## Glossary

*Clearly define terms in order to be accessible across audiences.*
-->

<!--
## Model Card Authors

*Lists the people who create the model card, providing recognition and accountability for the detailed work that goes into its construction.*
-->

<!--
## Model Card Contact

*Provides a way for people who have updates to the Model Card, suggestions, or questions, to contact the Model Card authors.*
-->