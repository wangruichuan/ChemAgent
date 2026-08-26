"""chemvision_call: 可靠地调用 chemvision 化学服务，避免模型手搓 curl+JSON 出错。

模型只需传结构化的 tool_name 与 arguments（dict），由本工具用 httpx 发起
POST 请求，无需在命令里手写 JSON 引号/转义（Windows 下极易出错）。
"""
import json
import logging

import httpx

from .registry import tool

logger = logging.getLogger(__name__)

CHEMVISION_URL = "http://localhost:8899/api/tools/call"


@tool(
    description=(
        "Query the ChemVision chemistry service for REAL data (PubChem / OPSIN). "
        "Pass tool_name and a structured arguments object — do NOT build curl commands. "
        "Available tool_name: 'name_to_structure' (name/SMILES -> formula, weight, SMILES, "
        "svg_url), 'inspect_smiles' (SMILES -> info), 'safety_info' (query -> GHS hazards), "
        "'predict_reaction' (reactants -> related data). Returns JSON with real chemistry data."
    ),
    parameters={
        "type": "object",
        "properties": {
            "tool_name": {
                "type": "string",
                "description": "One of: name_to_structure, inspect_smiles, safety_info, predict_reaction",
            },
            "arguments": {
                "type": "object",
                "description": "Structured params object, e.g. {\"name\": \"benzoic acid\"} or {\"smiles\": \"CCO\"}",
            },
        },
        "required": ["tool_name"],
    },
)
async def chemvision_call(tool_name: str, arguments: dict | None = None) -> str:
    arguments = arguments or {}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                CHEMVISION_URL,
                json={"tool_name": tool_name, "arguments": arguments},
            )
            return resp.text
    except Exception as e:  # noqa: BLE001
        logger.exception("chemvision_call failed")
        return json.dumps({"error": f"chemvision 调用失败: {e}"}, ensure_ascii=False)
