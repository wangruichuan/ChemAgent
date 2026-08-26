"""run_command: 受控的本地命令执行，让模型真正运行 skills 里的脚本/命令。

执行策略：
- Windows 用 PowerShell（powershell -NoProfile -Command），比 cmd /c 对引号更可靠
- POSIX 用 sh -c
- 若命令只有简单的 可执行文件+参数（无 shell 语法），直接 exec，引号最完整
- 使用同步 subprocess.run 经线程池执行，规避 Windows 上 asyncio 子进程
  （ProactorEventLoop 之外）抛 NotImplementedError 的问题

安全约束：
- 超时（默认 60s），防卡死
- 输出截断（默认 8000 字符），防刷屏
- 返回退出码，失败时模型可看到 stderr
"""
import asyncio
import json
import logging
import subprocess
import sys
from pathlib import Path

from .. import workspace
from .registry import tool

logger = logging.getLogger(__name__)

MAX_OUTPUT = 8000
TIMEOUT = 60

# PowerShell / sh 保留的 shell 语法，需要走 shell
_SHELL_SYNTAX = ("|", ">", "<", "&", "^", "%", "*", "?")


def _split_args(command: str):
    """自定义分词：尊重引号、忽略反斜杠转义（Windows 路径友好）。"""
    args = []
    buf = []
    quote = None
    for ch in command:
        if quote:
            if ch == quote:
                quote = None
            else:
                buf.append(ch)
        elif ch in ('"', "'"):
            quote = ch
        elif ch.isspace():
            if buf:
                args.append("".join(buf))
                buf = []
        else:
            buf.append(ch)
    if quote:
        raise ValueError("未闭合的引号")
    if buf:
        args.append("".join(buf))
    return args


def _needs_shell(command: str) -> bool:
    return any(ch in command for ch in _SHELL_SYNTAX)


@tool(
    description=(
        "Run a command on the local machine and return its output. Use this "
        "to execute scripts or run CLI tools. On Windows this uses PowerShell. "
        "Quoting works correctly (e.g. python -c \"print(1)\" is fine). 60s "
        "timeout, output truncated to 8000 chars. Keep commands simple and "
        "self-contained; avoid interactive prompts (they will hang)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Command to run, e.g. 'python script.py --query 深度学习'",
            },
            "cwd": {
                "type": "string",
                "description": "Working directory. Optional; defaults to the project root.",
            },
        },
        "required": ["command"],
    },
)
async def run_command(command: str, cwd: str = "") -> str:
    is_win = sys.platform == "win32"

    if not _needs_shell(command):
        # 简单命令：分词后直接 exec，引号最完整（不经 shell）
        try:
            args = _split_args(command)
        except ValueError as e:
            return json.dumps({"error": f"命令解析失败: {e}"}, ensure_ascii=False)
        if not args:
            return json.dumps({"error": "空命令"}, ensure_ascii=False)
    elif is_win:
        # Windows shell 语法：走 PowerShell
        args = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
    else:
        args = ["sh", "-c", command]

    # 工作区锚定：有工作区时默认 cwd = 工作区根；无工作区时 cwd 原样（空则继承进程目录）
    ws_root = workspace.current_root()
    if ws_root is not None:
        if cwd:
            cp = Path(cwd)
            eff_cwd = str(cp if cp.is_absolute() else (ws_root / cp))
        else:
            eff_cwd = str(ws_root)
    else:
        eff_cwd = cwd or None

    logger.info("run_command: %s (cwd=%s)", command, eff_cwd or ".")
    try:
        def _run() -> "subprocess.CompletedProcess[bytes]":
            return subprocess.run(
                args,
                cwd=eff_cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                timeout=TIMEOUT,
            )

        # 经线程池执行同步 subprocess，规避 Windows asyncio 子进程
        # 在非 ProactorEventLoop 下抛 NotImplementedError 的问题
        proc = await asyncio.get_event_loop().run_in_executor(None, _run)
    except FileNotFoundError as e:
        return json.dumps({"error": f"命令或解释器不存在: {e}"}, ensure_ascii=False)
    except subprocess.TimeoutExpired:
        return json.dumps(
            {"error": f"命令执行超时（>{TIMEOUT}s），已终止"}, ensure_ascii=False
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("run_command failed")
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    out = proc.stdout.decode("utf-8", errors="replace") if proc.stdout else ""
    err = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
    if len(out) > MAX_OUTPUT:
        out = out[:MAX_OUTPUT] + f"\n…[输出已截断，共 {len(out)} 字符]"
    if len(err) > MAX_OUTPUT:
        err = err[:MAX_OUTPUT] + f"\n…[输出已截断，共 {len(err)} 字符]"

    return json.dumps(
        {
            "exit_code": proc.returncode,
            "stdout": out,
            "stderr": err,
        },
        ensure_ascii=False,
    )
