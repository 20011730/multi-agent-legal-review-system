import json
import glob
import os
import re
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer, util

# ================= 1. 테스트 데이터 로드 =================
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
                qa_pairs.append({"query": query, "commentary": positive})
    except Exception:
        pass

df = pd.DataFrame(qa_pairs)
train_df = df.sample(frac=0.8, random_state=42)
test_df = df.drop(train_df.index).reset_index(drop=True)

queries = test_df['query'].tolist()
corpus_texts = test_df['commentary'].tolist()

# ================= 2. 모델 로드 및 임베딩 =================
print("원본 베이스 모델 로드 중...")
base_model = SentenceTransformer('intfloat/multilingual-e5-base')
print("파인튜닝된 모델 로드 중...")
tuned_model = SentenceTransformer('./legal-e5-finetuned')

print("\n임베딩 계산 중... (약 1~2분 소요)")
base_corpus_emb = base_model.encode(corpus_texts, convert_to_tensor=True, show_progress_bar=False)
base_query_emb = base_model.encode(queries, convert_to_tensor=True, show_progress_bar=False)

tuned_corpus_emb = tuned_model.encode(corpus_texts, convert_to_tensor=True, show_progress_bar=False)
tuned_query_emb = tuned_model.encode(queries, convert_to_tensor=True, show_progress_bar=False)

# 코사인 유사도 계산
base_scores = util.cos_sim(base_query_emb, base_corpus_emb)
tuned_scores = util.cos_sim(tuned_query_emb, tuned_corpus_emb)

# ================= 3. 정성적 비교 (오답 vs 정답 사례 추출) =================
print("\n🔍 [정성적 평가] 파인튜닝 전/후 검색 결과 비교\n")
found_examples = 0

for idx in range(len(queries)):
    true_idx = idx # 테스트셋 구조상 쿼리 인덱스와 정답 인덱스가 동일함
    
    # 각 모델이 1순위로 찾은 코퍼스(해설)의 인덱스 추출
    base_top1_idx = torch.argmax(base_scores[idx]).item()
    tuned_top1_idx = torch.argmax(tuned_scores[idx]).item()
    
    # 핵심 조건: 파인튜닝 모델은 1순위로 정답을 맞췄으나, 베이스 모델은 틀린 경우
    if tuned_top1_idx == true_idx and base_top1_idx != true_idx:
        print(f"[{found_examples + 1}번째 극적 개선 사례]")
        print(f"🗣️ 질문(Query)     : {queries[idx].replace('query: ', '')}")
        print(f"✅ 실제 정답       : {corpus_texts[true_idx].replace('passage: ', '')[:150]}...")
        print(f"❌ 베이스 모델(1순위): {corpus_texts[base_top1_idx].replace('passage: ', '')[:150]}...")
        print(f"🎯 파인튜닝 모델(1순위): {corpus_texts[tuned_top1_idx].replace('passage: ', '')[:150]}...\n")
        print("-" * 70 + "\n")
        
        found_examples += 1
        # 보기 쉽게 딱 3개의 극적인 개선 케이스만 출력
        if found_examples >= 3: 
            break

if found_examples == 0:
    print("극적으로 결과가 뒤바뀐 사례를 찾지 못했습니다. (베이스 모델도 이미 잘 맞췄거나, 둘 다 틀린 경우)")