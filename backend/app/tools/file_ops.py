"""文件三件套：list_dir / read_file / write_file。

让模型可靠地浏览 / 读取 / 写入项目内文件，替代 run_command 跑 cat / echo
（Windows 下引号与编码极易出错）。

安全约束：
- 相对路径一律相对项目根（ChemAgent）解析；
- 所有访问限定在项目根内，越界（如 C:\\Windows、家目录）直接拒绝；
- 读取做二进制检测 + 内容截断，写入限制在项目根内。
"""
import json
import logging
from pathlib import Path

from .. import workspace
from .registry import tool

logger = logging.getLogger(__name__)

MAX_READ_CHARS = 20000  # read_file 单次返回内容上限（防刷屏）
MAX_LIST_ENTRIES = 500  # list_dir 单次返回条目上限


def _root() -> Path | None:
    """当前工作区根目录；无工作区时为 None（不限制访问范围）。"""
    return workspace.current_root()


def _resolve(path: str) -> Path:
    """相对路径基于当前工作区根解析（无工作区时基于进程目录）；resolve 掉 .. 与符号链接。"""
    base = _root() or Path.cwd()
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = base / p
    return p.resolve()


def _inside_root(p: Path) -> bool:
    r = _root()
    if r is None:
        return True  # 无工作区：不限定目录
    try:
        p.relative_to(r)
        return True
    except ValueError:
        return False


def _err(msg: str) -> str:
    return json.dumps({"error": msg}, ensure_ascii=False)


@tool(
    name="list_dir",
    description=(
        "List files and directories under a path (default: project root). Returns "
        "name, type (dir/file) and size for each entry, sorted with directories first. "
        "Use this to explore the project or locate data files before reading them. "
        "An optional glob `pattern` (e.g. '*.csv') filters the entries."
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory to list, relative to project root (e.g. 'data') or absolute. Empty means project root.",
            },
            "pattern": {
                "type": "string",
                "description": "Optional glob filter, e.g. '*.csv' or 'exp_*.md'. Default '*'.",
            },
        },
    },
)
def list_dir(path: str = "", pattern: str = "*") -> str:
    try:
        target = _resolve(path or "")
    except Exception as e:  # noqa: BLE001
        return _err(f"路径解析失败: {e}")
    if not _inside_root(target):
        return _err(f"路径超出项目根（{_root()}），禁止访问: {path}")
    if not target.exists():
        return _err(f"目录不存在: {path}")
    if not target.is_dir():
        return _err(f"不是目录，无法列出: {path}")
    try:
        items = list(target.glob(pattern or "*"))
    except Exception as e:  # noqa: BLE001
        return _err(f"列目录失败: {e}")
    entries = []
    for it in items:
        try:
            is_dir = it.is_dir()
            size = 0 if is_dir else it.stat().st_size
        except OSError:
            is_dir, size = False, 0
        entries.append({"name": it.name, "type": "dir" if is_dir else "file", "size": size})
    entries.sort(key=lambda x: (x["type"] != "dir", x["name"]))
    truncated = len(entries) > MAX_LIST_ENTRIES
    entries = entries[:MAX_LIST_ENTRIES]
    return json.dumps(
        {"path": str(target), "count": len(entries), "truncated": truncated, "entries": entries},
        ensure_ascii=False,
    )


@tool(
    name="read_file",
    description=(
        "Read a text file from the project (UTF-8). Returns content with line numbers. "
        "For large files use `start_line` (1-based) and `max_lines` to read a range. "
        "Binary files (images / PDF / xlsx) are detected and reported instead of dumped. "
        "Path is relative to project root or absolute."
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File to read, relative to project root or absolute."},
            "start_line": {"type": "integer", "description": "1-based line to start from (default 1)."},
            "max_lines": {"type": "integer", "description": "Max lines to return (default 2000, cap 20000)."},
        },
        "required": ["path"],
    },
)
def read_file(path: str, start_line: int = 1, max_lines: int = 2000) -> str:
    try:
        target = _resolve(path)
    except Exception as e:  # noqa: BLE001
        return _err(f"路径解析失败: {e}")
    if not _inside_root(target):
        return _err(f"路径超出项目根（{_root()}），禁止访问: {path}")
    if not target.exists():
        return _err(f"文件不存在: {path}")
    if target.is_dir():
        return _err(f"是目录而非文件，请改用 list_dir: {path}")
    start_line = max(1, int(start_line or 1))
    max_lines = max(1, min(int(max_lines or 2000), 20000))
    try:
        raw = target.read_bytes()
    except Exception as e:  # noqa: BLE001
        return _err(f"读取失败: {e}")
    if b"\x00" in raw[:8192]:
        return json.dumps(
            {
                "path": str(target),
                "binary": True,
                "size": len(raw),
                "message": "疑似二进制文件，无法作为文本读取（可用 run_command 处理）",
            },
            ensure_ascii=False,
        )
    text = raw.decode("utf-8", errors="replace")
    lines = text.splitlines()
    total = len(lines)
    seg = lines[start_line - 1: start_line - 1 + max_lines]
    numbered = "\n".join(f"{start_line + i}\t{ln}" for i, ln in enumerate(seg))
    truncated = (start_line - 1 + len(seg)) < total
    if len(numbered) > MAX_READ_CHARS:
        numbered = numbered[:MAX_READ_CHARS] + "\n…[内容过长已截断]"
        truncated = True
    return json.dumps(
        {
            "path": str(target),
            "total_lines": total,
            "returned_start": start_line,
            "returned_end": min(start_line - 1 + len(seg), total),
            "truncated": truncated,
            "content": numbered,
        },
        ensure_ascii=False,
    )


@tool(
    name="write_file",
    description=(
        "Create or overwrite a UTF-8 text file inside the project. Parent directories "
        "are created automatically. Only paths within the project root are allowed. "
        "Returns the absolute path, bytes written and whether a new file was created. "
        "To append, read the file first then write the full combined content."
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File to write, relative to project root or absolute (must be within project root).",
            },
            "content": {"type": "string", "description": "Full file content to write."},
        },
        "required": ["path", "content"],
    },
)
def write_file(path: str, content: str) -> str:
    try:
        target = _resolve(path)
    except Exception as e:  # noqa: BLE001
        return _err(f"路径解析失败: {e}")
    if not _inside_root(target):
        return _err(f"路径超出项目根（{_root()}），禁止写入: {path}")
    try:
        existed = target.exists()
    except OSError:
        existed = False
    try:
        data = (content or "").encode("utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    except Exception as e:  # noqa: BLE001
        logger.exception("write_file failed: %s", path)
        return _err(f"写入失败: {e}")
    return json.dumps(
        {"path": str(target), "bytes_written": len(data), "created": not existed},
        ensure_ascii=False,
    )
