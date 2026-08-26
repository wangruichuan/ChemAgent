"""工具2: SMILES 结构信息查询

输入 SMILES 字符串，返回化学名称、分子式、分子量等详细信息。
数据源：PubChem API
"""

from __future__ import annotations

from typing import Optional

from .registry import ChemTool
from ..utils.pubchem_client import PubChemClient
from ..utils.smiles_utils import normalize_smiles, validate_smiles
from ..utils.svg_renderer import build_svg_url


class SmilesInspectorTool(ChemTool):
    """SMILES 结构信息查询"""

    def __init__(self, pubchem: Optional[PubChemClient] = None):
        self._pubchem = pubchem or PubChemClient()

    @property
    def name(self) -> str:
        return "inspect_smiles"

    @property
    def description(self) -> str:
        return (
            "查询 SMILES 字符串对应的化学信息。"
            "输入一个 SMILES 字符串，返回 IUPAC 名称、分子式、分子量、CID 等。"
            "适用于：用户提供了 SMILES，需要获取完整化学信息时调用。"
        )

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "smiles": {
                    "type": "string",
                    "description": "SMILES 字符串，如 'CC(=O)Oc1ccccc1C(=O)O'（阿司匹林）",
                },
            },
            "required": ["smiles"],
        }

    async def execute(self, smiles: str = "", **kwargs) -> dict:
        """执行 SMILES 信息查询"""
        s = normalize_smiles(smiles)
        if not s:
            return {"success": False, "error": "请输入 SMILES 字符串"}

        if not validate_smiles(s):
            return {
                "success": False,
                "error": f"'{s}' 不是有效的 SMILES 格式，请检查括号匹配和字符",
            }

        # PubChem SMILES 查询
        info = await self._pubchem.query_by_smiles(s)

        if info.smiles:
            result = {
                "success": True,
                "input_smiles": s,
                "canonical_smiles": info.smiles,
                "iupac_name": info.iupac_name or "",
                "molecular_formula": info.molecular_formula or "",
                "molecular_weight": info.molecular_weight or 0,
                "cid": info.cid,
                "inchi": info.inchi,
                "inchi_key": info.inchi_key,
                "source": "pubchem",
            }
            result["svg_url"] = build_svg_url(info.smiles)
            return result

        if info.not_found:
            return {
                "success": False,
                "input_smiles": s,
                "error": f"PubChem 中未找到 SMILES '{s}' 对应的化合物",
            }

        return {
            "success": False,
            "input_smiles": s,
            "error": f"查询失败: {info.error or '未知错误'}",
        }
