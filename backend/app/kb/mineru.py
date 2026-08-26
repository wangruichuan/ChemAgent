"""MinerU precise API v4 client (token-authenticated, batch upload channel).

Local files can't be submitted via the single-file endpoint (URL-only),
so we use the batch channel with a single file:

  1. POST /api/v4/file-urls/batch  {files:[{name, is_ocr}], enable_formula, ...}
     → data.batch_id + data.file_urls[0] (signed OSS upload URL)
  2. PUT file bytes to file_urls[0] (no extra headers — breaks OSS signature)
  3. System auto-submits the parse task (no manual submit needed)
  4. GET /api/v4/extract-results/batch/{batch_id} until state=done
     → data.extract_result[0].full_zip_url
  5. Download zip → extract full.md

Limits: ≤200MB, ≤600 pages. Auth: Authorization: Bearer {token}.
"""
import asyncio
import io
import logging
import zipfile

import httpx

BASE = "https://mineru.net/api/v4"
MAX_POLL_SECONDS = 600
POLL_INTERVAL = 5.0

logger = logging.getLogger(__name__)


class MinerUError(RuntimeError):
    pass


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=120.0, trust_env=False)


async def parse_scanned_pdf(content: bytes, filename: str, api_key: str, progress_cb=None) -> str:
    """Submit scanned PDF via MinerU precise API and return extracted markdown.
    progress_cb: optional async callable(text: str) called on state updates."""
    if not api_key:
        raise MinerUError("未配置 MinerU API Key（MINERU_API_KEY）")
    headers = {"Authorization": f"Bearer {api_key}"}

    async with _client() as client:
        batch_id, file_url = await _request_upload(client, headers, filename)
        await _upload(client, file_url, content)
        zip_bytes = await _poll_and_download(client, headers, batch_id, progress_cb)
    return _extract_markdown(zip_bytes)


async def _request_upload(client: httpx.AsyncClient, headers: dict, filename: str) -> tuple[str, str]:
    payload = {
        "files": [{"name": filename, "is_ocr": True, "data_id": "chemagent-kb"}],
        "enable_formula": True,
        "enable_table": True,
        "language": "ch",
    }
    try:
        resp = await client.post(
            f"{BASE}/file-urls/batch", headers={**headers, "Content-Type": "application/json"}, json=payload
        )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as e:
        raise MinerUError(f"MinerU 申请上传链接失败: {e}") from e
    if body.get("code") != 0:
        raise MinerUError(f"MinerU 申请上传链接失败: {body.get('msg')} (code={body.get('code')})")
    data = body.get("data") or {}
    urls = data.get("file_urls") or []
    if not data.get("batch_id") or not urls:
        raise MinerUError(f"MinerU 响应缺少 batch_id 或 file_urls: {body}")
    return data["batch_id"], urls[0]


async def _upload(client: httpx.AsyncClient, file_url: str, content: bytes) -> None:
    try:
        resp = await client.put(file_url, content=content)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise MinerUError(f"上传文件到 MinerU OSS 失败: {e}") from e


async def _poll_and_download(
    client: httpx.AsyncClient, headers: dict, batch_id: str, progress_cb=None
) -> bytes:
    deadline = asyncio.get_event_loop().time() + MAX_POLL_SECONDS
    while True:
        try:
            resp = await client.get(f"{BASE}/extract-results/batch/{batch_id}", headers=headers)
            resp.raise_for_status()
            body = resp.json()
        except httpx.HTTPError as e:
            raise MinerUError(f"查询 MinerU 任务状态失败: {e}") from e
        if body.get("code") != 0:
            raise MinerUError(f"MinerU 查询失败: {body.get('msg')} (code={body.get('code')})")

        results = (body.get("data") or {}).get("extract_result") or []
        item = results[0] if results else {}
        state = item.get("state")

        # report progress: extracted_pages / total_pages
        if progress_cb and state in {"running", "converting", "pending"}:
            prog = item.get("extract_progress") or {}
            done = prog.get("extracted_pages")
            total = prog.get("total_pages")
            if total:
                try:
                    await progress_cb(f"OCR 解析 {done}/{total} 页")
                except Exception:  # noqa: BLE001 — progress is best-effort
                    pass

        if state == "done":
            zip_url = item.get("full_zip_url")
            if not zip_url:
                raise MinerUError("MinerU 任务完成但缺少 full_zip_url")
            try:
                zr = await client.get(zip_url)
                zr.raise_for_status()
                return zr.content
            except httpx.HTTPError as e:
                raise MinerUError(f"下载 MinerU 结果包失败: {e}") from e
        if state == "failed":
            raise MinerUError(f"MinerU 解析失败: {item.get('err_msg')}")
        if state not in {"waiting-file", "uploading", "pending", "running", "converting", ""}:
            raise MinerUError(f"MinerU 未知状态: {state}")
        if asyncio.get_event_loop().time() > deadline:
            raise MinerUError("MinerU 解析超时（600s）")
        await asyncio.sleep(POLL_INTERVAL)


def _extract_markdown(zip_bytes: bytes) -> str:
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        md_name = next((n for n in zf.namelist() if n.endswith(".md")), None)
        if not md_name:
            raise MinerUError("结果包中未找到 Markdown 文件")
        return zf.read(md_name).decode("utf-8", errors="replace")
    except zipfile.BadZipFile as e:
        raise MinerUError(f"MinerU 结果包损坏: {e}") from e
