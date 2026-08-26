"""化学工具注册表

统一管理所有化学工具的定义、Schema 和调用分发。
工具定义遵循 OpenAI Function Calling 格式，兼容 Ollama。
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class ChemTool(ABC):
    """化学工具基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """工具名称（唯一标识）"""

    @property
    @abstractmethod
    def description(self) -> str:
        """工具描述（供 LLM 理解）"""

    @property
    @abstractmethod
    def parameters(self) -> dict:
        """JSON Schema 格式的参数定义"""

    @abstractmethod
    async def execute(self, **kwargs) -> dict:
        """执行工具调用，返回结构化结果"""

    def to_openai_schema(self) -> dict:
        """转换为 OpenAI Function Calling 格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    """工具注册表"""

    def __init__(self):
        self._tools: dict[str, ChemTool] = {}

    def register(self, tool: ChemTool) -> None:
        """注册一个工具"""
        if tool.name in self._tools:
            logger.warning(f"工具 '{tool.name}' 已存在，将被覆盖")
        self._tools[tool.name] = tool
        logger.info(f"已注册工具: {tool.name}")

    def get(self, name: str) -> ChemTool | None:
        """获取工具实例"""
        return self._tools.get(name)

    def list_tools(self) -> list[dict]:
        """列出所有已注册工具的信息"""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            }
            for tool in self._tools.values()
        ]

    def to_openai_tools(self) -> list[dict]:
        """导出为 OpenAI function calling 格式的工具列表"""
        return [tool.to_openai_schema() for tool in self._tools.values()]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict:
        """调用指定工具"""
        tool = self._tools.get(name)
        if tool is None:
            return {"error": f"未找到工具: {name}"}
        try:
            logger.info(f"调用工具: {name}({json.dumps(arguments, ensure_ascii=False)})")
            result = await tool.execute(**arguments)
            logger.info(f"工具结果: {name} -> {json.dumps(result, ensure_ascii=False)[:200]}")
            return result
        except Exception as e:
            logger.error(f"工具调用失败: {name} - {e}", exc_info=True)
            return {"error": f"工具调用失败: {e}"}

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools
