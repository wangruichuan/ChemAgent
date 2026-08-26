"""PubChem REST API 客户端

提供化学名称到结构的查询、SMILES 到信息的查询、相似物搜索等功能。
API 文档: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote as url_quote

import httpx

logger = logging.getLogger(__name__)


@dataclass
class CompoundInfo:
    """化合物信息"""
    smiles: Optional[str] = None
    iupac_name: Optional[str] = None
    molecular_formula: Optional[str] = None
    molecular_weight: Optional[float] = None
    cid: Optional[int] = None
    inchi: Optional[str] = None
    inchi_key: Optional[str] = None
    error: Optional[str] = None
    not_found: bool = False


class PubChemClient:
    """PubChem PUG REST API 客户端"""

    BASE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound"
    TIMEOUT = 10.0
    MAX_RETRIES = 3

    def __init__(self, timeout: float | None = None):
        self._timeout = timeout or self.TIMEOUT

    async def query_by_name(self, name: str) -> CompoundInfo:
        """通过化学名称查询化合物信息"""
        name = name.strip()
        if not name:
            return CompoundInfo(error="empty_query")

        encoded = url_quote(name)
        url = (
            f"{self.BASE_URL}/name/{encoded}"
            f"/property/CanonicalSMILES,IsomericSMILES,"
            f"MolecularFormula,MolecularWeight,IUPACName/JSON"
        )
        return await self._query_property_table(url, fallback_smiles=None)

    async def query_by_smiles(self, smiles: str) -> CompoundInfo:
        """通过 SMILES 查询化合物信息"""
        smiles = smiles.strip()
        if not smiles:
            return CompoundInfo(error="empty_query")

        url = (
            f"{self.BASE_URL}/smiles/{url_quote(smiles)}"
            f"/property/CanonicalSMILES,IsomericSMILES,"
            f"MolecularFormula,MolecularWeight,IUPACName/JSON"
        )
        return await self._query_property_table(url, fallback_smiles=smiles)

    async def query_cids_by_name(self, name: str) -> list[int]:
        """通过名称查询 CID 列表"""
        name = name.strip()
        if not name:
            return []
        url = f"{self.BASE_URL}/name/{url_quote(name)}/cids/JSON"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    cid_table = data.get("IdentifierList", {})
                    return cid_table.get("CID", [])
        except Exception as e:
            logger.warning(f"PubChem CID 查询失败: {e}")
        return []

    async def get_safety_info(self, name_or_smiles: str) -> dict:
        """查询化学品安全信息（通过 PubChem Compound 页面摘要）"""
        # 先获取 CID
        info = await self.query_by_name(name_or_smiles)
        if info.not_found or info.cid is None:
            # 尝试 SMILES
            info = await self.query_by_smiles(name_or_smiles)

        if info.cid is None:
            return {"error": "not_found", "not_found": True}

        result: dict = {
            "cid": info.cid,
            "name": info.iupac_name,
            "formula": info.molecular_formula,
            "weight": info.molecular_weight,
            "safety": {},
        }

        # 查询安全信息（GHS 分类等）
        try:
            url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{info.cid}/JSON?heading=Safety+and+Hazards"
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    result["safety"] = self._extract_safety_summary(resp.json())
        except Exception as e:
            logger.warning(f"PubChem 安全信息查询失败: {e}")
            result["safety"]["error"] = str(e)

        return result

    async def _query_property_table(
        self, url: str, fallback_smiles: Optional[str]
    ) -> CompoundInfo:
        """查询 PubChem PropertyTable 接口"""
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.get(url)
                    status = resp.status_code

                    if status == 200:
                        return self._parse_property_response(resp.json(), fallback_smiles)

                    if 400 <= status < 500:
                        if status == 404 or "PUGREST.NotFound" in resp.text:
                            return CompoundInfo(not_found=True, error="not_found")
                        return CompoundInfo(error=f"http_{status}")

                    # 5xx: retry
                    if attempt < self.MAX_RETRIES:
                        await asyncio.sleep(0.3 * attempt)
                        continue
                    return CompoundInfo(error=f"http_{status}")

            except httpx.TimeoutException:
                if attempt < self.MAX_RETRIES:
                    await asyncio.sleep(0.3 * attempt)
                    continue
                return CompoundInfo(error="timeout")
            except Exception as e:
                return CompoundInfo(error=str(e))

        return CompoundInfo(error="max_retries_exceeded")

    def _parse_property_response(
        self, data: dict, fallback_smiles: Optional[str]
    ) -> CompoundInfo:
        """解析 PubChem PropertyTable 响应"""
        try:
            # 检查 Fault
            fault = data.get("Fault")
            if fault:
                message = fault.get("Message") or fault.get("Details", "")
                if "NotFound" in str(message):
                    return CompoundInfo(not_found=True, error="not_found")
                return CompoundInfo(error=message)

            prop_table = data.get("PropertyTable", {})
            properties_list = prop_table.get("Properties", [])
            if not properties_list:
                return CompoundInfo(not_found=True, error="no_properties")

            props = properties_list[0]
            cid = props.get("CID")
            canonical = props.get("CanonicalSMILES")
            isomeric = props.get("IsomericSMILES")
            smiles_generic = props.get("SMILES")
            connectivity = props.get("ConnectivitySMILES")
            smiles = canonical or isomeric or smiles_generic or connectivity or fallback_smiles
            formula = props.get("MolecularFormula")
            weight = props.get("MolecularWeight")
            name = props.get("IUPACName")

            return CompoundInfo(
                smiles=smiles,
                iupac_name=name,
                molecular_formula=formula,
                molecular_weight=float(weight) if weight else None,
                cid=cid,
            )
        except Exception as e:
            return CompoundInfo(error=f"parse_error: {e}")

    def _extract_safety_summary(self, data: dict) -> dict:
        """从 PubChem 安全数据中递归提取 GHS / 危险信息"""
        summary: dict = {}
        try:
            record = data.get("Record", {})
            sections = record.get("Section", [])
            self._walk_safety(sections, summary, depth=0)
        except Exception:
            pass
        return summary

    def _walk_safety(self, sections: list, summary: dict, depth: int) -> None:
        """递归遍历 PubChem Section 树，提取含 GHS/Hazard 的数据"""
        if depth > 6 or len(summary) >= 10:
            return
        for section in sections:
            heading = section.get("TOCHeading", "")
            # 提取 Information 条目
            for info in section.get("Information", []):
                name = info.get("Name", "")
                value = info.get("Value", {})
                if not isinstance(value, dict):
                    continue
                for item in value.get("StringWithMarkup", []):
                    text = item.get("String", "")
                    if text and len(text) > 2:
                        key = name or heading or f"item_{len(summary)}"
                        if key not in summary:
                            summary[key] = text
            # 递归进入子 Section
            self._walk_safety(section.get("Section", []), summary, depth + 1)
