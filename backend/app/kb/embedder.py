"""Embedding via any OpenAI-compatible /embeddings endpoint.

Falls back to nothing for now — if the user's configured API doesn't support
/embeddings (e.g. DeepSeek), the upload fails with a clear error directing
them to switch provider or enable the local bge-m3 option (future).
"""
import logging

import httpx

logger = logging.getLogger(__name__)

BATCH_SIZE = 10  # Aliyun bailian text-embedding-v3/v4 caps at 10 texts/request


async def embed_texts(
    texts: list[str], base_url: str, api_key: str, model: str, progress_cb=None
) -> list[list[float]]:
    """Embed a list of texts via OpenAI-compatible endpoint.
    progress_cb: optional async callable(text) per batch completed."""
    from openai import AsyncOpenAI, OpenAIError

    client = AsyncOpenAI(
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        timeout=120.0,
        http_client=httpx.AsyncClient(trust_env=False, timeout=120.0),
    )
    vectors: list[list[float]] = []
    batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        try:
            resp = await client.embeddings.create(model=model, input=batch)
        except OpenAIError as e:
            raise EmbedError(f"嵌入请求失败（{model}）: {e}") from e
        vectors.extend([d.embedding for d in resp.data])
        if progress_cb:
            try:
                await progress_cb(f"向量化 {min(i + BATCH_SIZE, len(texts))}/{len(texts)}")
            except Exception:  # noqa: BLE001 — progress is best-effort
                pass
    return vectors


class EmbedError(RuntimeError):
    pass
