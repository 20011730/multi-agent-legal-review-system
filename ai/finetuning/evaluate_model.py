import json
import glob
import os
import re
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer, util

# ================= 1. 테스트 데이터 준비 =================
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
            query = "query: " + clean_text(data.get("question", ""))
            positive = "passage: " + clean_text(data.get("commentary", ""))
            
            if len(query) > 7 and len(positive) > 9:
                qa_pairs.append({
                    "query": query, 
                    "commentary": positive
                })
    except Exception:
        pass

df = pd.DataFrame(qa_pairs)

# 학습 때와 동일하게 8:2 비율로 나누고 남은 20%를 테스트셋으로 사용
train_df = df.sample(frac=0.8, random_state=42)
test_df = df.drop(train_df.index).reset_index(drop=True)

print(f"평가에 사용할 테스트 데이터: {len(test_df)}건\n")

queries = test_df['query'].tolist()
corpus_texts = test_df['commentary'].tolist()

# ================= 2. 평가 함수 정의 =================
def evaluate_model(model_name_or_path, queries, corpus_texts, k=3):
    print(f"[{model_name_or_path}] 모델 로드 중...")
    model = SentenceTransformer(model_name_or_path)

    print("임베딩 및 유사도 계산 중 (잠시만 기다려주세요)...")
    corpus_embeddings = model.encode(corpus_texts, convert_to_tensor=True, show_progress_bar=False)
    query_embeddings = model.encode(queries, convert_to_tensor=True, show_progress_bar=False)

    cos_scores = util.cos_sim(query_embeddings, corpus_embeddings)

    hits = 0
    mrr_sum = 0.0

    for query_idx in range(len(queries)):
        true_corpus_idx = query_idx
        top_results = torch.topk(cos_scores[query_idx], k=k)
        top_indices = top_results.indices.tolist()
        
        if true_corpus_idx in top_indices:
            hits += 1
            
        try:
            rank = top_indices.index(true_corpus_idx) + 1
            mrr_sum += (1.0 / rank)
        except ValueError:
            pass

    recall = hits / len(queries)
    mrr = mrr_sum / len(queries)
    return recall, mrr

# ================= 3. 두 모델 평가 실행 =================
# 1) 원본 베이스 모델 평가
base_model_name = 'intfloat/multilingual-e5-base'
base_recall, base_mrr = evaluate_model(base_model_name, queries, corpus_texts)

print("-" * 50)

# 2) 파인튜닝된 모델 평가
finetuned_model_path = './legal-e5-finetuned'
tuned_recall, tuned_mrr = evaluate_model(finetuned_model_path, queries, corpus_texts)

# ================= 4. 최종 결과 비교 출력 =================
print("\n" + "="*50)
print("🏆 E5 모델 파인튜닝 전/후 성능 비교 (K=3)")
print("="*50)
print(f"지표\t\t| 베이스 모델\t| 파인튜닝 모델\t| 향상도")
print("-" * 50)
print(f"Recall@3\t| {base_recall:.4f}\t| {tuned_recall:.4f}\t| +{(tuned_recall - base_recall):.4f}")
print(f"MRR@3\t\t| {base_mrr:.4f}\t| {tuned_mrr:.4f}\t| +{(tuned_mrr - base_mrr):.4f}")
print("="*50)