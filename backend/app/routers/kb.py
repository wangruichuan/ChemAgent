"""Knowledge base REST API.

POST   /api/kb/upload            upload file (multipart) → doc_id, starts async pipeline
GET    /api/kb/documents         list docs with status
DELETE /api/kb/documents/{id}    delete doc + chunks
POST   /api/kb/search            debug: embed a query and return top-k hits
"""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from ..config import settings
from ..kb import embedder, parser, pipeline, retriever, storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kb", tags=["kb"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB before handing to parsers


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
):
    """Upload a document. Embedding + LLM cleaning use server-side config
    (EMBED_* / OPENAI_* in .env) — not exposed to the frontend."""
    filename = file.filename or "unnamed"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in parser.SUPPORTED_EXT:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext or '(无扩展名)'}")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 50MB 限制")
    if not content:
        raise HTTPException(status_code=400, detail="空文件")

    fhash = pipeline.file_hash(content)
    dup = storage.find_doc_by_hash(fhash)
    if dup:
        if dup["status"] == storage.FAILED:
            # allow re-processing a previously failed upload
            storage.delete_document(dup["id"])
        else:
            raise HTTPException(status_code=409, detail=f"文件已存在（{dup['filename']}，状态: {dup['status']}）")

    embed_model = settings.embed_model
    base_url = settings.embed_base_url
    api_key = settings.embed_api_key
    if not embed_model:
        raise HTTPException(status_code=400, detail="服务端未配置 Embedding 模型（EMBED_MODEL）")
    if not api_key:
        raise HTTPException(status_code=400, detail="服务端未配置嵌入 API Key（EMBED_API_KEY）")

    doc_id = storage.insert_document(filename, fhash, ext.lstrip("."))
    # run pipeline in background; content lives in memory, fine for personal scale
    asyncio.create_task(
        pipeline.run_pipeline(
            doc_id, content, filename,
            embed_model=settings.embed_model,
            base_url=settings.embed_base_url,
            api_key=settings.embed_api_key,
            clean_model=settings.clean_model,
        )
    )
    return {"doc_id": doc_id, "filename": filename, "status": storage.PENDING}


@router.get("/documents")
async def list_documents():
    return {"documents": storage.list_documents()}


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: int):
    if not storage.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"ok": True}


class RenameRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)


@router.patch("/documents/{doc_id}")
async def rename_document(doc_id: int, body: RenameRequest):
    name = body.filename.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    if not storage.rename_document(doc_id, name):
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"ok": True}


@router.get("/files/{doc_id}")
async def get_file(doc_id: int, download: bool = False):
    """Return the original uploaded file.
    ?download=1 → attachment (saved locally, open with the default program)."""
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    import mimetypes
    import urllib.parse

    from fastapi.responses import FileResponse

    candidates = sorted(storage.FILES_DIR.glob(f"{doc_id}.*"))
    if not candidates:
        raise HTTPException(status_code=404, detail="原始文件不存在")
    path = candidates[0]
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    quoted = urllib.parse.quote(doc["filename"])
    disposition = "attachment" if download else "inline"
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f"{disposition}; filename=\"{quoted}\"; filename*=UTF-8''{quoted}"
            )
        },
    )


@router.post("/search")
async def search(
    query: str = Form(...),
    embed_model: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    top_k: int = Form(5),
):
    embed_model = (embed_model or settings.embed_model).strip()
    base_url = (base_url or settings.embed_base_url).strip()
    api_key = (api_key or settings.embed_api_key).strip()
    if not embed_model or not api_key:
        raise HTTPException(status_code=400, detail="服务端未配置 Embedding 模型或 API Key")
    try:
        vec = (await embedder.embed_texts([query], base_url, api_key, embed_model))[0]
    except embedder.EmbedError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    hits = retriever.retrieve(vec, top_k=top_k)
    return {"query": query, "hits": hits}
