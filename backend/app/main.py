"""FastAPI entrypoint. Run: uvicorn app.main:app --reload --port 8000"""
import logging
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import workspace
from .config import settings
from .kb import storage as kb_storage
from .paths import ensure_data_dirs
from .routers import chat, kb, skills, workspace as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# 数据根就绪（打包后首次启动把内置技能库复制到数据根），再做后续初始化
ensure_data_dirs()
kb_storage.init_db()
workspace.init()

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(skills.router)
app.include_router(kb.router)
app.include_router(ws_router.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


def _frontend_dist() -> Path | None:
    """前端构建产物目录：Electron 打包模式下随 exe 打进 _MEIPASS/frontend_dist。

    存在时挂载为静态站，Electron 窗口直接加载 http://127.0.0.1:8000（同源，无 CORS 问题）；
    dev 模式（Vite 5173）不挂载，避免干扰。
    """
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent / "_internal"))
        d = base / "frontend_dist"
        return d if d.is_dir() else None
    d = Path(__file__).resolve().parents[1] / "frontend" / "dist"
    return d if d.is_dir() else None


# 静态站挂载必须放在所有 API 路由之后，否则 /api 会被 / 抢先匹配
_dist = _frontend_dist()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
