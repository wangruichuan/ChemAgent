"""SMILES → 结构图 URL 构建

使用 smiles-drawer.js（ChemVision 同款）在浏览器端渲染分子结构。
通过 FastAPI /api/svg/{smiles} 端点提供渲染页面。
"""

from __future__ import annotations

from typing import Optional
from urllib.parse import quote as url_quote


def build_svg_url(
    smiles: str,
    base_url: str = "http://localhost:8899",
) -> Optional[str]:
    """构建分子结构图渲染 URL

    QwenPaw 用 browser_visible 打开此 URL，截图后发送给用户。

    Args:
        smiles: SMILES 字符串
        base_url: 服务基础地址

    Returns:
        渲染页面 URL，SMILES 为空时返回 None
    """
    if not smiles or not smiles.strip():
        return None
    return f"{base_url}/api/svg/{url_quote(smiles.strip())}"
