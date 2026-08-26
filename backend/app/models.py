"""Pydantic request/response schemas."""
from typing import List, Optional

from pydantic import BaseModel, Field


class Message(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    # OpenAI-compatible endpoint config (per-request, overrides server defaults)
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    # Generation params
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = True
    # Thinking mode (DeepSeek V4 etc.)
    thinking: bool = False
    reasoning_effort: Optional[str] = None  # low | medium | high
    # Tool calling (web search etc.)
    tools: bool = False
    # Knowledge base RAG
    use_kb: bool = False
    embed_model: Optional[str] = None  # embedding model for KB retrieval


class SummarizeRequest(BaseModel):
    """上下文压缩：把较早的多轮对话压缩成一段摘要。"""
    messages: List[Message]
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    prior_summary: Optional[str] = None  # 既有摘要，与新对话合并更新
    max_tokens: Optional[int] = None  # 摘要输出上限（默认 800）


class TranslateRequest(BaseModel):
    """技能简介翻译：把技能英文 description 翻译成中文，写入 description_zh。"""
    name: str  # 技能名（SKILL.md 所在目录名）
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class ModelsRequest(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class ModelInfo(BaseModel):
    id: str
    owned_by: Optional[str] = None


class ModelsResponse(BaseModel):
    models: List[ModelInfo]
