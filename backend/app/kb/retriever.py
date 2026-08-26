"""Retrieval: brute-force cosine similarity over all ready chunks.

Personal-scale (<50k chunks): full scan + cosine is fine (tens of ms).
"""
import json

from . import storage


def retrieve(query_embedding: list[float], top_k: int = 5) -> list[dict]:
    """Return top-k chunks: {content, source, filename, score}."""
    chunks = storage.all_chunks()
    scored = []
    for c in chunks:
        try:
            vec = json.loads(c["embedding"])
        except (TypeError, json.JSONDecodeError):
            continue
        score = storage.cosine_similarity(query_embedding, vec)
        if score > 0:
            scored.append({
                "content": c["content"],
                "source": c["source"] or "",
                "filename": c["filename"],
                "score": round(score, 4),
            })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
