"""OPSIN IUPAC 名称解析器客户端

OPSIN 是剑桥大学开发的 IUPAC 化学名称到结构转换工具。
API 文档: https://opsin.ch.cam.ac.uk/
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote as url_quote

import httpx

logger = logging.getLogger(__name__)


@dataclass
class OpsinResult:
    """OPSIN 解析结果"""
    smiles: Optional[str] = None
    iupac_name: Optional[str] = None
    molecular_formula: Optional[str] = None
    molecular_weight: Optional[float] = None
    error: Optional[str] = None
    not_found: bool = False


class OpsinClient:
    """OPSIN REST API 客户端"""

    BASE_URL = "https://opsin.ch.cam.ac.uk/opsin"
    TIMEOUT = 8.0
    MAX_RETRIES = 3

    def __init__(self, timeout: float | None = None, proxy_url: str | None = None):
        self._timeout = timeout or self.TIMEOUT
        # Web 端可能需要代理（CORS 限制）
        self._base_url = proxy_url.rstrip("/") + "/opsin" if proxy_url else self.BASE_URL

    async def query(self, name: str) -> OpsinResult:
        """将 IUPAC 英文名称转换为 SMILES"""
        name = name.strip()
        if not name:
            return OpsinResult(error="empty_query")

        # OPSIN 不支持中文，跳过
        if self._contains_chinese(name):
            return OpsinResult(error="skip_chinese", not_found=True)

        encoded = url_quote(name)
        url = f"{self._base_url}/{encoded}.json"

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
                    resp = await client.get(url)
                    status = resp.status_code

                    if status == 200:
                        return self._parse_response(resp.json(), name)

                    if 400 <= status < 500:
                        if status == 404:
                            return OpsinResult(not_found=True, error="not_found")
                        return OpsinResult(error=f"http_{status}")

                    # 5xx: retry
                    if attempt < self.MAX_RETRIES:
                        await asyncio.sleep(0.3 * attempt)
                        continue
                    return OpsinResult(error=f"http_{status}")

            except httpx.TimeoutException:
                if attempt < self.MAX_RETRIES:
                    await asyncio.sleep(0.3 * attempt)
                    continue
                return OpsinResult(error="timeout")
            except Exception as e:
                return OpsinResult(error=str(e))

        return OpsinResult(error="max_retries_exceeded")

    def _parse_response(self, data: dict, original_name: str) -> OpsinResult:
        """解析 OPSIN JSON 响应"""
        smiles = data.get("canonicalSmiles") or data.get("smiles")
        formula = data.get("molecularFormula")
        weight = data.get("molecularWeight")
        name = data.get("iupacName") or original_name

        if smiles:
            return OpsinResult(
                smiles=smiles,
                iupac_name=name,
                molecular_formula=formula,
                molecular_weight=float(weight) if weight else None,
            )
        return OpsinResult(error="no_smiles", not_found=True)

    @staticmethod
    def _contains_chinese(text: str) -> bool:
        return bool(re.search(r'[一-鿿]', text))
