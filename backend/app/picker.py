"""Native Windows "browse for folder" dialog via ctypes (SHBrowseForFolderW).

No third-party deps (tkinter may be absent in the venv). Blocks until the user
picks or cancels, so call it through a thread pool in async handlers.
"""
import asyncio
import ctypes
import os
from ctypes import wintypes


class _BROWSEINFO(ctypes.Structure):
    _fields_ = [
        ("hwndOwner", wintypes.HWND),
        ("pidlRoot", ctypes.c_void_p),
        ("pszDisplayName", ctypes.c_wchar * 260),
        ("lpszTitle", ctypes.c_wchar_p),
        ("ulFlags", wintypes.UINT),
        ("lpfn", ctypes.c_void_p),
        ("lParam", ctypes.c_long),
        ("iImage", ctypes.c_int),
    ]


# Folder-only + modern tree-view dialog
_BIF_RETURNONLYFSDIRS = 0x0001
_BIF_USENEWUI = 0x0050


def pick_directory_sync(title: str = "选择工作区目录") -> str:
    """Return the selected absolute folder path, or "" if cancelled / not Windows."""
    if os.name != "nt":
        raise RuntimeError("目录选择仅支持 Windows")

    # SHBrowseForFolderW 依赖 COM（STA），必须先在当前线程 OleInitialize。
    # 否则线程池线程复用后第二次调用会卡死不显示对话框（前端表现为一直转圈）。
    ole32 = ctypes.windll.ole32
    hr = ole32.OleInitialize(None)  # 0=S_OK；1=S_FALSE（该线程已初始化过）
    init_ok = hr == 0 or hr == 1
    try:
        return _pick_sync(title)
    finally:
        # 仅当本次确实由我们完成初始化才反初始化（避免破坏线程上已有的 COM 状态）
        if init_ok and hr == 0:
            ole32.OleUninitialize()


def _pick_sync(title: str) -> str:
    shell32 = ctypes.windll.shell32
    bi = _BROWSEINFO()
    bi.hwndOwner = None
    bi.pidlRoot = None
    bi.lpszTitle = title
    bi.ulFlags = _BIF_RETURNONLYFSDIRS | _BIF_USENEWUI

    shell32.SHBrowseForFolderW.argtypes = [ctypes.POINTER(_BROWSEINFO)]
    shell32.SHBrowseForFolderW.restype = ctypes.c_void_p
    item_pidl = shell32.SHBrowseForFolderW(ctypes.byref(bi))
    if not item_pidl:
        return ""

    # 用 SHGetPathFromIDListW 取完整路径（比 struct 内置 260 字段更稳），失败则回退
    buf = ctypes.create_unicode_buffer(260)
    shell32.SHGetPathFromIDListW.argtypes = [ctypes.c_void_p, wintypes.LPWSTR]
    shell32.SHGetPathFromIDListW.restype = wintypes.BOOL
    ok = shell32.SHGetPathFromIDListW(item_pidl, buf)
    free = ctypes.windll.ole32.CoTaskMemFree
    free.argtypes = [ctypes.c_void_p]
    free(item_pidl)
    return buf.value if ok else (bi.pszDisplayName or "")


async def pick_directory(title: str = "选择工作区目录") -> str:
    """Async wrapper: runs the blocking dialog in a thread so the event loop stays free."""
    # 超时兜底：对话框异常卡死时不让请求永久挂起（前端 120s 也会自行 abort）
    return await asyncio.wait_for(asyncio.to_thread(_pick_sync, title), timeout=600)
