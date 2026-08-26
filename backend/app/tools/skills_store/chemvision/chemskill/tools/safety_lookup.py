"""工具3: 化学品安全信息查询

输入化学名称（英文）或 SMILES，查询 GHS 危险标识、安全数据等。
数据源：PubChem Safety and Hazards 数据

注意：PubChem 不支持中文名查询。如输入中文名，返回 hint 提示 Agent 翻译为英文后重试。
"""

from __future__ import annotations

import re
from typing import Optional

from .registry import ChemTool
from ..utils.pubchem_client import PubChemClient


class SafetyLookupTool(ChemTool):
    """化学品安全信息查询"""

    def __init__(self, pubchem: Optional[PubChemClient] = None):
        self._pubchem = pubchem or PubChemClient()

    @property
    def name(self) -> str:
        return "safety_info"

    @property
    def description(self) -> str:
        return (
            "查询化学品的安全信息，包括 GHS 危险标识、危害分类、安全提示等。"
            "输入化学名称（英文）或 SMILES，返回安全数据摘要。"
            "注意：PubChem 不支持中文名，如输入中文返回 hint 提示翻译为英文后重试。"
        )

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "化学名称（英文）或 SMILES，如 'benzene'、'ethanol'、'CCO'",
                },
            },
            "required": ["query"],
        }

    async def execute(self, query: str = "", **kwargs) -> dict:
        q = query.strip()
        if not q:
            return {"success": False, "error": "请输入化学名称或 SMILES"}

        # 中文检测 → 返回 hint
        if bool(re.search(r'[一-鿿]', q)):
            return {
                "success": False,
                "query": q,
                "error": "pubchem_not_support_chinese",
                "hint": f"PubChem 不支持中文名查询，请将 '{q}' 翻译为英文后重新调用",
            }

        result = await self._pubchem.get_safety_info(q)

        if result.get("error") == "not_found":
            return {
                "success": False,
                "query": q,
                "error": "not_found",
                "hint": f"未找到 '{q}' 的安全信息，请检查英文名称是否正确",
            }

        if result.get("error"):
            return {
                "success": False,
                "query": q,
                "error": result["error"],
            }

        return {
            "success": True,
            "query": q,
            "cid": result.get("cid"),
            "name": result.get("name"),
            "formula": result.get("formula"),
            "weight": result.get("weight"),
            "safety": result.get("safety", {}),
            "source": "pubchem",
            "message": "安全数据来自 PubChem，仅供参考，具体安全操作请查阅权威 SDS",
        }
