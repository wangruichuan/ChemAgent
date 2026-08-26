"""Pipeline orchestration: parse → chunk → embed → store, runs async.

A document goes through this in the background after upload:
  pending → parsing (local or MinerU) → embedding → ready | failed
"""
import asyncio
import hashlib
import logging

from . import chunker, cleaner, embedder, parser, storage

logger = logging.getLogger(__name__)


def file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


async def run_pipeline(
    doc_id: int,
    content: bytes,
    filename: str,
    embed_model: str,
    base_url: str,
    api_key: str,
    clean_model: str = "",
    custom_cleaner: str = "",
) -> None:
    """Async pipeline entry. Never raises — failures land in doc.status=FAILED.
    clean_model: optional LLM for semantic cleaning (reuses same API config).
    custom_cleaner: optional registered cleaner name (trained model)."""
    loop = asyncio.get_running_loop()
    progress = storage.update_doc_progress

    async def cb(text: str) -> None:
        await loop.run_in_executor(None, progress, doc_id, text)

    from ..config import settings

    # persist original file for later preview (best-effort)
    try:
        storage.FILES_DIR.mkdir(parents=True, exist_ok=True)
        (storage.FILES_DIR / f"{doc_id}{_ext(filename)}").write_bytes(content)
    except OSError as e:
        logger.warning("KB doc %s: failed to store original file: %s", doc_id, e)

    try:
        storage.update_doc_status(doc_id, storage.PARSING)
        ext = _ext(filename)
        logger.info("KB doc %s (%s) pipeline start, type=%s", doc_id, filename, ext)

        if ext == ".pdf":
            markdown = await _parse_pdf_async(loop, content, filename, doc_id)
        else:
            await cb("解析中…")
            markdown = await loop.run_in_executor(None, parser.parse_local, content, filename)
        logger.info("KB doc %s parsed, %d chars", doc_id, len(markdown))

        if not markdown.strip():
            raise ValueError("未能从文档中提取出任何文本")

        # Text-level dedup: hash of rule-cleaned text (deterministic, before LLM cleaning)
        import hashlib

        rule_clean = await loop.run_in_executor(None, cleaner.clean_text, markdown)
        text_hash = hashlib.sha256(rule_clean.encode("utf-8")).hexdigest()
        dup = await loop.run_in_executor(None, storage.find_doc_by_text_hash, text_hash, doc_id)
        if dup:
            raise ValueError(f"文档内容与「{dup['filename']}」重复，已跳过入库")
        await loop.run_in_executor(None, storage.update_doc_text_hash, doc_id, text_hash)
        logger.info("KB doc %s text_hash=%s", doc_id, text_hash[:12])

        # Cleaning: rule-based always, then custom cleaner or LLM if configured
        markdown = await cleaner.clean_pipeline(
            markdown, base_url, api_key, clean_model, custom_cleaner,
            progress_cb=cb,
        )
        logger.info("KB doc %s cleaned, %d chars", doc_id, len(markdown))

        # chunk
        await cb("分块中…")
        boundaries: set[str] = set()
        if settings.chunk_model and ext == ".pdf":
            await cb("分析章节结构…")
            boundaries = await chunker.suggest_boundaries(
                markdown, settings.embed_base_url, settings.embed_api_key, settings.chunk_model
            )
            logger.info("KB doc %s: LLM boundaries=%s", doc_id, sorted(boundaries))
        chunks_text = await loop.run_in_executor(
            None, chunker.chunk_text, markdown, chunker.TARGET_CHARS, chunker.MAX_CHARS, boundaries
        )
        logger.info("KB doc %s chunked, %d chunks", doc_id, len(chunks_text))
        if not chunks_text:
            raise ValueError("文本分块结果为空")

        # embed
        storage.update_doc_status(doc_id, storage.EMBEDDING)
        vectors = await embedder.embed_texts(chunks_text, base_url, api_key, embed_model, progress_cb=cb)
        if len(vectors) != len(chunks_text):
            raise ValueError(f"嵌入数量不匹配: {len(vectors)} vs {len(chunks_text)}")

        # store
        payload = [(c, None, v) for c, v in zip(chunks_text, vectors)]
        await loop.run_in_executor(None, storage.replace_chunks, doc_id, payload)
        count = await loop.run_in_executor(None, storage.count_chunks, doc_id)
        storage.update_doc_status(doc_id, storage.READY, chunk_count=count)
        logger.info("KB doc %s ready, %d chunks", doc_id, count)

        # AI summary (best-effort, never blocks readiness)
        try:
            await cb("生成摘要…")
            summary = await _generate_summary(markdown, settings)
            if summary:
                storage.update_doc_summary(doc_id, summary)
                logger.info("KB doc %s summary: %d chars", doc_id, len(summary))
        except Exception as e:  # noqa: BLE001
            logger.warning("KB doc %s summary generation failed: %s", doc_id, e)
    except Exception as e:  # noqa: BLE001 — surface to user via status
        logger.exception("KB pipeline failed for doc %s", doc_id)
        storage.update_doc_status(doc_id, storage.FAILED, error=str(e))


_SUMMARY_PROMPT = """请用不超过 50 字的中文，一句话概括下面这篇文档讲的是什么（文档类型 / 研究主题 / 主要内容即可）。

只输出概括正文，不要任何前缀（不要写"摘要："）、不要分点、不要超过 50 字。

--- 文档开头 ---
{text}
"""


async def _generate_summary(markdown: str, settings) -> str:
    """Generate a short Chinese summary of the doc using the server LLM."""
    if not settings.chunk_model:
        return ""
    import httpx
    from openai import AsyncOpenAI

    text = markdown[:8000]  # head of the cleaned doc is enough
    client = AsyncOpenAI(
        base_url=settings.embed_base_url.rstrip("/"),
        api_key=settings.embed_api_key,
        timeout=90.0,
        http_client=httpx.AsyncClient(trust_env=False, timeout=90.0),
    )
    resp = await client.chat.completions.create(
        model=settings.chunk_model,
        messages=[{"role": "system", "content": _SUMMARY_PROMPT.format(text=text)}],
        temperature=0.2,
        max_tokens=512,
    )
    return (resp.choices[0].message.content or "").strip()


async def _parse_pdf_async(loop: asyncio.AbstractEventLoop, content: bytes, filename: str, doc_id: int) -> str:
    """PDF: classify; local types → local md; scanned → MinerU API."""
    logger.info("KB doc %s: classifying pdf...", doc_id)
    progress = storage.update_doc_progress

    async def cb(text: str) -> None:
        await loop.run_in_executor(None, progress, doc_id, text)

    # pdf-inspector can hang on complex PDFs — hard timeout, fall back to MinerU
    try:
        pdf_type, local_md = await asyncio.wait_for(
            loop.run_in_executor(None, parser.classify_pdf, content, filename),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        logger.warning("KB doc %s: pdf-inspector classify timeout, fallback to MinerU", doc_id)
        pdf_type, local_md = "unknown", None
    logger.info("KB doc %s: pdf_type=%s", doc_id, pdf_type)
    if pdf_type in parser._LOCAL_PDF_TYPES and local_md:
        return local_md
    # scanned / image_based / unknown → MinerU (needs OCR)
    storage.update_doc_status(doc_id, storage.PARSING, error=None)
    from ..config import settings
    from . import mineru
    try:
        return await mineru.parse_scanned_pdf(content, filename, settings.mineru_api_key, progress_cb=cb)
    except mineru.MinerUError as e:
        raise ValueError(f"MinerU 解析失败: {e}") from e


def _ext(filename: str) -> str:
    import os

    return os.path.splitext(filename)[1].lower()
