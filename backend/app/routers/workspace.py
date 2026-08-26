"""Workspace routes: list / add / switch / pick the agent's working directory,
plus artifact preview / raw bytes / execute / reveal endpoints."""
import asyncio
import mimetypes
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from .. import workspace
from .. import picker
from ..tools.file_ops import _inside_root, _resolve

router = APIRouter(prefix="/api", tags=["workspace"])

# 产物预览相关的类型映射
_IMAGE_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}
_TEXT_EXT = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".csv",
    ".txt", ".md", ".log", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf",
    ".sh", ".bat", ".ps1", ".ipynb", ".css", ".scss", ".sql", ".tex", ".rst",
    ".xml", ".env", ".vue", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
}
# 可执行扩展名 → 解释器（.py 用后端 venv 的 python，其余走 PATH）
_SCRIPT = {
    ".py": [sys.executable],
    ".js": ["node"],
    ".mjs": ["node"],
    ".cjs": ["node"],
    ".sh": ["sh"],
}
_EXEC_TIMEOUT = 60
_EXEC_MAX = 8000


def _target(path: str) -> Path:
    """解析并校验路径在工作区内（复用 file_ops 的锚定/边界逻辑）。"""
    p = _resolve(path)
    if not _inside_root(p):
        raise HTTPException(status_code=400, detail=f"路径超出工作区，禁止访问: {path}")
    return p


# ---------- 工作区管理 ----------

@router.get("/workspaces")
async def list_workspaces():
    return workspace.get_all()


class AddWorkspace(BaseModel):
    name: str = ""
    root: str


@router.post("/workspaces")
async def add_workspace(req: AddWorkspace):
    try:
        return workspace.add(req.name, req.root)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class SwitchWorkspace(BaseModel):
    id: str


@router.post("/workspaces/switch")
async def switch_workspace(req: SwitchWorkspace):
    try:
        return workspace.switch(req.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class PickWorkspace(BaseModel):
    title: str = "选择工作区目录"


@router.post("/workspaces/pick")
async def pick_workspace(req: PickWorkspace):
    """弹系统原生目录选择对话框，返回所选绝对路径（取消返回空串）。"""
    try:
        path = await picker.pick_directory(req.title or "选择工作区目录")
        return {"path": path}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ---------- 产物：预览 / 原始字节 ----------

@router.get("/workspace/preview")
async def preview_file(path: str = Query(...)):
    """返回产物预览元数据（含文本内容），前端据此决定渲染方式。"""
    p = _target(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if p.is_dir():
        raise HTTPException(status_code=400, detail="是目录而非文件")

    ext = p.suffix.lower()
    size = p.stat().st_size
    name = p.name
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    url = f"/api/workspace/raw?path={quote(str(p))}"

    if ext in _IMAGE_EXT:
        return {"name": name, "path": str(p), "size": size, "mime": _IMAGE_EXT[ext], "mode": "image", "url": url}
    if ext in (".html", ".htm"):
        return {"name": name, "path": str(p), "size": size, "mime": "text/html", "mode": "html", "url": url}
    if ext in _TEXT_EXT or mime.startswith("text/") or mime in ("application/json", "application/xml"):
        try:
            raw = p.read_bytes()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"读取失败: {e}") from e
        if b"\x00" in raw[:8192]:
            return {"name": name, "path": str(p), "size": size, "mime": mime, "mode": "binary", "url": url}
        content = raw.decode("utf-8", errors="replace")
        if len(content) > 200000:
            content = content[:200000] + "\n…[内容过长已截断]"
        mode = "markdown" if ext == ".md" else "text"
        return {"name": name, "path": str(p), "size": size, "mime": mime, "mode": mode, "content": content}
    return {"name": name, "path": str(p), "size": size, "mime": mime, "mode": "binary", "url": url}


@router.get("/workspace/raw")
async def raw_file(path: str = Query(...), download: int = 0):
    """返回文件原始字节（图片 <img> / html <iframe> / 下载）。"""
    p = _target(path)
    if not p.exists() or p.is_dir():
        raise HTTPException(status_code=404, detail="文件不存在")
    data = p.read_bytes()
    ext = p.suffix.lower()
    if ext in _IMAGE_EXT:
        ctype = _IMAGE_EXT[ext]
    elif ext in (".html", ".htm"):
        ctype = "text/html; charset=utf-8"
    else:
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    headers = {}
    if download:
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(p.name)}"
    return Response(content=data, media_type=ctype, headers=headers)


# ---------- 产物：执行 / 打开位置 ----------

class ExecuteReq(BaseModel):
    path: str


@router.post("/workspace/execute")
async def execute_file(req: ExecuteReq):
    """在工作区 cwd 下执行脚本产物（按扩展名选解释器），返回 stdout/stderr/退出码。"""
    p = _target(req.path)
    if not p.exists() or p.is_dir():
        raise HTTPException(status_code=404, detail="文件不存在")
    ext = p.suffix.lower()
    if ext not in _SCRIPT:
        raise HTTPException(status_code=400, detail=f"该类型暂不支持执行: {ext or '无扩展名'}")

    ws_root = workspace.current_root()
    cwd = str(ws_root) if ws_root else str(p.parent)
    args = _SCRIPT[ext] + [str(p)]

    def _run() -> "subprocess.CompletedProcess[bytes]":
        return subprocess.run(
            args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            shell=False, timeout=_EXEC_TIMEOUT,
        )

    try:
        proc = await asyncio.get_event_loop().run_in_executor(None, _run)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"解释器不存在: {e}") from e
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail=f"执行超时（>{_EXEC_TIMEOUT}s），已终止")

    out = proc.stdout.decode("utf-8", "replace") if proc.stdout else ""
    err = proc.stderr.decode("utf-8", "replace") if proc.stderr else ""
    if len(out) > _EXEC_MAX:
        out = out[:_EXEC_MAX] + "\n…[输出已截断]"
    if len(err) > _EXEC_MAX:
        err = err[:_EXEC_MAX] + "\n…[输出已截断]"
    return {"exit_code": proc.returncode, "stdout": out, "stderr": err}


class RevealReq(BaseModel):
    path: str


@router.post("/workspace/reveal")
async def reveal_file(req: RevealReq):
    """在系统文件管理器中定位该文件。"""
    p = _target(req.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", str(p)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(p)])
        else:
            subprocess.Popen(["xdg-open", str(p.parent)])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"打开失败: {e}") from e
    return {"ok": True}
