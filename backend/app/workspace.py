"""Workspace management: the working-directory anchor for all local tools.

A workspace is a folder the agent works in (name + root path). It is the anchor
for every local tool — file reads/writes and command execution are confined to
the *current* workspace root, mirroring how WorkBuddy binds a session to a
workspace folder.

Multiple workspaces can be defined (e.g. one per research project); the active
one is persisted to backend/data/workspace.json and survives restarts.
"""
import json
import logging
import sys
import threading
from pathlib import Path

from .paths import data_root

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]   # .../backend（仅开发模式使用）
# 打包后无"项目根"概念：默认工作区回退到无工作区模式；开发模式保持项目根
DEFAULT_ROOT = BACKEND_DIR.parent if not getattr(sys, "frozen", False) else None
WS_FILE = data_root() / "workspace.json"

_lock = threading.Lock()


def _default_ws() -> dict:
    if DEFAULT_ROOT is not None:
        return {"id": str(DEFAULT_ROOT), "name": "ChemAgent", "root": str(DEFAULT_ROOT)}
    return {"id": "", "name": "无工作区", "root": ""}


_state: dict = {
    "current": _default_ws()["id"],
    "workspaces": [_default_ws()],
}


def _load() -> None:
    global _state
    if WS_FILE.exists():
        try:
            data = json.loads(WS_FILE.read_text("utf-8"))
            if isinstance(data, dict) and data.get("workspaces"):
                wss = [
                    {"id": str(w["root"]), "name": str(w.get("name", "")), "root": str(w["root"])}
                    for w in data["workspaces"]
                    if w.get("root")
                ]
                if wss:
                    _state = {
                        "current": str(data.get("current") or wss[0]["id"]),
                        "workspaces": wss,
                    }
                    return
        except Exception:  # noqa: BLE001
            logger.warning("workspace.json 读取失败，回退默认工作区")
    _state = {"current": _default_ws()["id"], "workspaces": [_default_ws()]}


def _save() -> None:
    try:
        WS_FILE.parent.mkdir(parents=True, exist_ok=True)
        WS_FILE.write_text(json.dumps(_state, ensure_ascii=False, indent=2), "utf-8")
    except Exception:  # noqa: BLE001
        logger.exception("workspace.json 写入失败")


def _key(s: str) -> str:
    """路径归一化比较键：统一分隔符 + 忽略大小写（Windows 路径不敏感）。"""
    return s.replace("\\", "/").lower()


NONE_WS = {"id": "", "name": "无工作区", "root": ""}


def _current_locked() -> dict:
    """读取当前工作区（含无工作区）。调用方须已持有 _lock（不再加锁，避免不可重入死锁）。"""
    if _state["current"] == "":
        return dict(NONE_WS)
    for w in _state["workspaces"]:
        if w["id"] == _state["current"]:
            return dict(w)
    return dict(_state["workspaces"][0]) if _state["workspaces"] else dict(NONE_WS)


def current() -> dict:
    """当前工作区（id / name / root）。"""
    with _lock:
        return _current_locked()


def current_root() -> Path | None:
    """当前工作区根目录（已 resolve）；无工作区时返回 None。所有本地工具以此为锚点。"""
    with _lock:
        if _state["current"] == "":
            return None
        root = next((w["root"] for w in _state["workspaces"] if w["id"] == _state["current"]), None)
    return Path(root).resolve() if root else None


def get_all() -> dict:
    with _lock:
        return {"current": _state["current"], "workspaces": [dict(w) for w in _state["workspaces"]]}


def add(name: str, root: str) -> dict:
    """新增（或激活已存在的）工作区，并设为当前。root 必须为已存在目录。"""
    with _lock:
        p = Path((root or "").strip()).expanduser()
        if not p.is_absolute():
            if DEFAULT_ROOT is not None:
                p = (DEFAULT_ROOT / p).resolve()
            else:
                raise ValueError("打包模式下工作区必须是绝对路径")
        if not p.exists() or not p.is_dir():
            raise ValueError(f"工作区目录不存在或不是目录: {p}")
        wid = str(p)
        existing = next((w for w in _state["workspaces"] if _key(w["id"]) == _key(wid)), None)
        if existing is None:
            _state["workspaces"].append({"id": wid, "name": (name or "").strip() or p.name, "root": wid})
            _state["current"] = wid
        else:
            if (name or "").strip():
                existing["name"] = name.strip()
            _state["current"] = existing["id"]
        _save()
        return _current_locked()


def switch(ws_id: str) -> dict:
    with _lock:
        # 空 id 或 "none" → 无工作区（不限定目录）
        if not ws_id or ws_id.strip().lower() == "none":
            _state["current"] = ""
            _save()
            return _current_locked()
        match = next((w for w in _state["workspaces"] if _key(w["id"]) == _key(ws_id)), None)
        if match is None:
            raise ValueError(f"工作区不存在: {ws_id}")
        _state["current"] = match["id"]
        _save()
        return _current_locked()


def init() -> None:
    _load()
