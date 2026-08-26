"""工具1: 化学名称→SMILES 结构解析

输入化学名称（英文/IUPAC/俗名），输出 SMILES、分子式、分子量等结构信息。
数据源：PubChem API + OPSIN（双源容错）

注意：PubChem 不支持中文名查询。如输入中文名，工具会返回 hint 提示 Agent 翻译为英文后重试。
"""

from __future__ import annotations

import re
from typing import Optional

from .registry import ChemTool
from ..utils.pubchem_client import PubChemClient
from ..utils.opsin_client import OpsinClient
from ..utils.smiles_utils import normalize_smiles, is_likely_smiles
from ..utils.svg_renderer import build_svg_url


class NameToStructureTool(ChemTool):
    """化学名称解析为分子结构"""

    def __init__(
        self,
        pubchem: Optional[PubChemClient] = None,
        opsin: Optional[OpsinClient] = None,
    ):
        self._pubchem = pubchem or PubChemClient()
        self._opsin = opsin or OpsinClient()

    @property
    def name(self) -> str:
        return "name_to_structure"

    @property
    def description(self) -> str:
        return (
            "将化学名称转换为分子结构信息。"
            "支持英文名、IUPAC名、俗名、SMILES 输入。"
            "返回 SMILES、分子式、分子量、标准名称、结构图 URL。"
            "注意：PubChem 不支持中文名查询，如输入中文名返回 not_found，"
            "请 Agent 将中文翻译为英文后重新调用本工具。"
        )

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "化学名称（英文），如 'benzoic acid'、'aspirin'、'ethanol'",
                },
            },
            "required": ["name"],
        }

    async def execute(self, name: str = "", **kwargs) -> dict:
        query = name.strip()
        if not query:
            return {"success": False, "error": "请输入化学名称"}

        # 如果输入已经是 SMILES 格式，直接跳转到 SMILES 查询
        if is_likely_smiles(query):
            info = await self._pubchem.query_by_smiles(normalize_smiles(query))
            if info.smiles:
                return self._build_success(info, query, source="pubchem_direct")

        # 中文名检测 → 返回 hint
        is_chinese = bool(re.search(r'[一-鿿]', query))
        if is_chinese:
            return {
                "success": False,
                "query": query,
                "error": "pubchem_not_support_chinese",
                "hint": f"PubChem 不支持中文名查询，请将 '{query}' 翻译为英文后重新调用",
            }

        # 1. 直接用名称查 PubChem
        info = await self._pubchem.query_by_name(query)
        if info.smiles:
            return self._build_success(info, query, source="pubchem")

        # 2. OPSIN 解析（IUPAC 英文名）
        opsin_result = await self._opsin.query(query)
        if opsin_result.smiles:
            pubchem_info = await self._pubchem.query_by_smiles(opsin_result.smiles)
            if pubchem_info.smiles:
                return self._build_success(pubchem_info, query, source="opsin+pubchem")
            return {
                "success": True,
                "query": query,
                "smiles": opsin_result.smiles,
                "molecular_formula": opsin_result.molecular_formula or "",
                "molecular_weight": opsin_result.molecular_weight or 0,
                "iupac_name": opsin_result.iupac_name or query,
                "source": "opsin",
                "svg_url": build_svg_url(opsin_result.smiles),
            }

        # 3. 全部失败
        return {
            "success": False,
            "query": query,
            "error": "not_found",
            "hint": f"PubChem 和 OPSIN 均未找到 '{query}'，请检查英文名称是否正确",
        }

    def _build_success(self, info, original_query: str, source: str = "pubchem") -> dict:
        result = {
            "success": True,
            "query": original_query,
            "smiles": info.smiles,
            "molecular_formula": info.molecular_formula or "",
            "molecular_weight": info.molecular_weight or 0,
            "iupac_name": info.iupac_name or "",
            "cid": info.cid,
            "source": source,
        }
        if info.smiles:
            result["svg_url"] = build_svg_url(info.smiles)
        return result
