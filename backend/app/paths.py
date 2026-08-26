"""统一的数据根目录解析（Electron / PyInstaller 打包适配）。

开发模式：数据落在 backend/data/（保持现状）。
打包模式：数据落在 CHEMAGENT_DATA 环境变量指定目录（Electron 主进程
会设为 %APPDATA%/ChemAgent/data），或 exe 同级 data/ 兜底。
技能库等用户可写内容一律放数据根，绝不放 PyInstaller 解压目录（_MEIPASS 只读）。

优先级：
1. 环境变量 CHEMAGENT_DATA（Electron 显式设置，最稳）
2. 打包模式：exe 同级 data/
3. 开发模式：backend/data/
"""
import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def data_root() -> Path:
    """数据根目录（kb.db、workspace.json、skills_store 的父目录）。"""
    env = os.environ.get("CHEMAGENT_DATA")
    if env:
        return Path(env).resolve()
    if _is_frozen():
        return Path(sys.executable).resolve().parent / "data"
    return Path(__file__).resolve().parents[1] / "data"


def bundled_skills_dir() -> Path | None:
    """PyInstaller 打包时打进 _MEIPASS 的内置技能库；未打包或无内置时返回 None。"""
    if not _is_frozen():
        return None
    base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent / "_internal"))
    d = base / "skills_store"
    return d if d.is_dir() else None


def ensure_data_dirs() -> None:
    """启动时确保数据根与技能库就绪：首次运行把内置技能库复制到数据根。"""
    root = data_root()
    (root / "kb").mkdir(parents=True, exist_ok=True)
    skills_dir = root / "skills_store"
    if not skills_dir.exists():
        bundled = bundled_skills_dir()
        if bundled is not None:
            import shutil

            shutil.copytree(bundled, skills_dir)
    else:
        skills_dir.mkdir(parents=True, exist_ok=True)
