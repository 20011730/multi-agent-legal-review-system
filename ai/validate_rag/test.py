import chromadb
from collections import defaultdict
client = chromadb.PersistentClient(
    path="/Users/hyejin/Desktop/학교/4-2/Capstone_2/Capstone_2/ai/generate_rag/chroma_data")
col = client.get_collection("laws")
print("총 chunk:", col.count())   # 22만대면 v5 재임베딩 반영됨

total = col.count(); off, page = 0, 5000
arts = defaultdict(set)
while off < total:
    got = col.get(include=["metadatas"], limit=page, offset=off)
    for md in (got["metadatas"] or []):
        if md.get("title","") == "지방자치법":
            arts["지방자치법"].add(md.get("articleNo",""))
    off += page
    if not got["metadatas"]: break
print("corpus의 지방자치법 조문 수:", len(arts["지방자치법"]))