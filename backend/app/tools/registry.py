"""Tool registry: declare tools, expose OpenAI function-calling schemas, execute by name.

Tools are Python functions registered via @tool(...). Each tool declares its
JSON Schema so the model can decide when/how to call it. The chat router uses
this registry to build the `tools` parameter and to run the tool-call loop.
"""
import inspect
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema (type=object)
    func: Callable[..., Any]
    is_async: bool = False

    def schema(self) -> Dict[str, Any]:
        """OpenAI function schema."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_REGISTRY: Dict[str, Tool] = {}


def tool(
    name: Optional[str] = None,
    description: str = "",
    parameters: Optional[Dict[str, Any]] = None,
):
    """Decorator: register a callable as a tool.

    >>> @tool(description="Add two numbers")
    >>> def add(a: int, b: int) -> int: ...
    """

    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        tname = name or fn.__name__
        if tname in _REGISTRY:
            raise ValueError(f"Tool already registered: {tname}")

        # 未显式提供 schema 时，从类型注解/默认值自动生成（简化版）
        params = parameters or _infer_parameters(fn)
        doc = (inspect.getdoc(fn) or "").strip()
        desc = description or (doc.splitlines()[0] if doc else tname)
        _REGISTRY[tname] = Tool(
            name=tname,
            description=desc,
            parameters=params,
            func=fn,
            is_async=inspect.iscoroutinefunction(fn),
        )
        return fn

    return deco


def _infer_parameters(fn: Callable[..., Any]) -> Dict[str, Any]:
    """Minimal schema inference from signature: maps python types to JSON Schema."""
    type_map = {int: "integer", float: "number", str: "string", bool: "boolean"}
    sig = inspect.signature(fn)
    properties: Dict[str, Any] = {}
    required: List[str] = []
    for pname, p in sig.parameters.items():
        if pname in ("self", "cls") or p.kind == inspect.Parameter.VAR_KEYWORD:
            continue
        ann = p.annotation
        js_type = type_map.get(ann, "string")
        prop: Dict[str, Any] = {"type": js_type}
        if p.default is not inspect.Parameter.empty:
            prop["default"] = p.default
        else:
            required.append(pname)
        properties[pname] = prop
    return {"type": "object", "properties": properties, "required": required}


def list_tools() -> List[Tool]:
    return list(_REGISTRY.values())


def tools_schema(exclude: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    exclude = set(exclude or [])
    return [t.schema() for t in _REGISTRY.values() if t.name not in exclude]


async def execute_tool(name: str, arguments: Dict[str, Any]) -> str:
    """Run a registered tool; always returns a string result for the model."""
    t = _REGISTRY.get(name)
    if not t:
        raise KeyError(f"Unknown tool: {name}")
    try:
        if t.is_async:
            result = await t.func(**arguments)
        else:
            result = t.func(**arguments)
        return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        logger.exception("Tool %s failed", name)
        return json.dumps({"error": str(e)}, ensure_ascii=False)
