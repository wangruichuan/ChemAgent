"""knowledge_base_search: agentic RAG 工具——模型自行决定是否检索本地知识库。

仅当对话「未开启强制知识库检索」(use_kb=False) 但「工具调用」开启时，本工具
才会出现在可用工具列表里，由模型判断问题是否可能由本地知识库（论文 / 实验记录 /
文档）回答并自行调用，即 agentic RAG。开启强制检索时后端已自动注入上下文，无需此工具。
"""
import json
import logging

from ..config import settings
from ..kb import embedder, retriever
from .registry import tool

logger = logging.getLogger(__name__)

KB_TOOL_NAME = "knowledge_base_search"


@tool(
    name=KB_TOOL_NAME,
    description=(
        "Search the local knowledge base (uploaded papers / documents / experiment "
        "notes) for relevant passages. Call this ONLY when you believe the user's "
        "question might be answered by internal documents — e.g. prior experiments, "
        "papers, or domain notes stored in the knowledge base. Returns up to `top_k` "
        "passages with source filename and a relevance score. If the knowledge base is "
        "empty or irrelevant, just answer from your own knowledge instead. Do NOT call "
        "this for general chemistry questions that PubChem/OPSIN or your own training "
        "can answer."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query in Chinese or English, e.g. '乙醇丙酮耦合催化 最优反应条件'",
            },
            "top_k": {
                "type": "integer",
                "description": "Number of passages to return (default 5, max 10).",
            },
        },
        "required": ["query"],
    },
)
async def knowledge_base_search(query: str, top_k: int = 5) -> str:
    embed_model = (settings.embed_model or "").strip()
    if not embed_model or not settings.embed_api_key:
        return json.dumps(
            {"error": "服务端未配置 Embedding 模型或 API Key，无法检索知识库"},
            ensure_ascii=False,
        )
    try:
        vec = (
            await embedder.embed_texts(
                [query], settings.embed_base_url, settings.embed_api_key, embed_model
            )
        )[0]
    except embedder.EmbedError as e:
        return json.dumps({"error": f"知识库检索失败（嵌入错误）: {e}"}, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        logger.exception("KB search embedding failed")
        return json.dumps({"error": f"知识库检索失败: {e}"}, ensure_ascii=False)

    top_k = max(1, min(int(top_k or 5), 10))
    hits = retriever.retrieve(vec, top_k=top_k)
    if not hits:
        return json.dumps(
            {"results": [], "message": "知识库未检索到相关内容"},
            ensure_ascii=False,
        )
    out = [
        {
            "filename": h["filename"],
            "source": h.get("source", ""),
            "score": round(h.get("score", 0), 3),
            "content": (h["content"] or "")[:1500],
        }
        for h in hits
    ]
    return json.dumps({"results": out, "count": len(out)}, ensure_ascii=False)
