"""工具4: 反应物化学信息查询

输入反应物名称（英文），返回各反应物的化学数据。
不进行 LLM 推理 —— 反应推测由 Agent 自行完成。

注意：PubChem 不支持中文名查询。如输入中文名，返回 hint 提示 Agent 翻译后重试。
"""

from __future__ import annotations

import re
from typing import Optional

from .registry import ChemTool
from ..utils.pubchem_client import PubChemClient


class ReactionPredictTool(ChemTool):
    """反应物化学信息查询"""

    def __init__(self, pubchem: Optional[PubChemClient] = None):
        self._pubchem = pubchem or PubChemClient()

    @property
    def name(self) -> str:
        return "predict_reaction"

    @property
    def description(self) -> str:
        return (
            "查询反应物的化学信息（分子式、分子量、SMILES），辅助推测化学反应。"
            "输入反应物名称（英文），返回各物质的化学数据。"
            "Agent 应基于返回数据自行推断反应类型、产物和方程式。"
            "注意：PubChem 不支持中文名，如输入中文返回 hint 提示翻译为英文后重试。"
        )

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "reactants": {
                    "type": "string",
                    "description": "反应物描述（英文），如 'acetic acid and ethanol'、'NaOH + HCl'",
                },
            },
            "required": ["reactants"],
        }

    async def execute(self, reactants: str = "", **kwargs) -> dict:
        r = reactants.strip()
        if not r:
            return {"success": False, "error": "请提供反应物"}

        # 中文检测
        if bool(re.search(r'[一-鿿]', r)):
            return {
                "success": False,
                "error": "pubchem_not_support_chinese",
                "hint": f"PubChem 不支持中文名查询，请将 '{r}' 翻译为英文后重新调用",
            }

        # 拆分反应物（按 + 、 and 分割）
        parts = re.split(r'\s*[+＋]\s*|\s+and\s+', r, flags=re.IGNORECASE)
        parts = [p.strip() for p in parts if p.strip()]

        results = []
        for part in parts:
            info = await self._pubchem.query_by_name(part)
            entry = {"name": part}
            if info.smiles:
                entry.update({
                    "smiles": info.smiles,
                    "molecular_formula": info.molecular_formula or "",
                    "molecular_weight": info.molecular_weight or 0,
                    "iupac_name": info.iupac_name or "",
                    "found": True,
                })
            else:
                entry["found"] = False
            results.append(entry)

        return {
            "success": True,
            "reactants": results,
            "agent_instruction": (
                "请根据以上反应物信息，自行推断："
                "1. 反应类型 2. 化学方程式（配平） 3. 反应条件 4. 产物说明。"
                "回答后用 /api/formula/{方程式} 渲染图片发给用户。"
            ),
        }
