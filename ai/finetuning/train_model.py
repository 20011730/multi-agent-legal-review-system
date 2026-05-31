import json
import glob
import os
import re
import pandas as pd
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader

# ================= 1. 데이터 준비 (앞선 단계와 동일) =================
base_path = "/root/embedding-finetuning/115/3.개방데이터/1.데이터/Other/QA데이터"
qa_files = glob.glob(os.path.join(base_path, "*.json"))

def clean_text(text):
    if not text: return ""
    cleaned = re.sub(r'[^가-힣a-zA-Z0-9\s.,!?\'\"]', '', text)
    return re.sub(r'\s+', ' ', cleaned).strip()

qa_pairs = []
for file_path in qa_files:
    if os.path.basename(file_path).startswith("._") or os.path.getsize(file_path) == 0:
        continue
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # E5 모델 권장 사항: 쿼리 앞에는 'query: ', 문단 앞에는 'passage: ' 접두어 추가
            query = "query: " + clean_text(data.get("question", ""))
            positive = "passage: " + clean_text(data.get("commentary", ""))
            
            if len(query) > 7 and len(positive) > 9: # 접두어 길이 제외하고 내용이 있는지 확인
                qa_pairs.append({"query": query, "commentary": positive})
    except Exception:
        pass

df = pd.DataFrame(qa_pairs)
print(f"파인튜닝에 사용할 데이터: {len(df)}건")

# ================= 2. Sentence-Transformers 학습 포맷 변환 =================
train_examples = []
for _, row in df.iterrows():
    train_examples.append(InputExample(texts=[row['query'], row['commentary']]))

# 논문 권장 배치 사이즈 32 적용 
train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=32)

# ================= 3. 임베딩 모델 로드 및 학습 설정 =================
print("모델을 다운로드하고 학습을 준비합니다...")
# e5-multilingual-base 모델 로드
model = SentenceTransformer('intfloat/multilingual-e5-base')

# In-Batch Negatives를 위한 MNR Loss 적용 [cite: 152, 155]
train_loss = losses.MultipleNegativesRankingLoss(model=model)

# ================= 4. 파인튜닝 실행 =================
print("파인튜닝을 시작")
output_dir = "./legal-e5-finetuned"

model.fit(
    train_objectives=[(train_dataloader, train_loss)],
    epochs=3, # 에포크는 필요에 따라 조절 (보통 3~5)
    warmup_steps=100,
    output_path=output_dir,
    show_progress_bar=True
)

print(f"학습 완료! 파인튜닝된 모델이 '{output_dir}' 폴더에 저장되었습니다.")