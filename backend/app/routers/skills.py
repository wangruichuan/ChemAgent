"""Skills API: list / view / delete / translate skills in ChemAgent's own skill library."""
import logging

import httpx
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI, OpenAIError

from ..config import settings
from ..models import TranslateRequest
from ..tools.skills import _discover_skills, get_skill_detail, set_skill_description_zh, trash_skill

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["skills"])

TRANSLATE_SYSTEM_PROMPT = (
    "你是一个专业的科技文档翻译助手。请将用户给出的技能简介翻译成简洁、准确、"
    "符合中文阅读习惯的中文，只输出翻译结果本身，不要解释、不要加引号、不要加任何前缀或后缀。"
)


def _make_client(base_url: str, api_key: str, timeout: float) -> AsyncOpenAI:
    """构造上游客户端：显式禁用环境代理（trust_env=False），避免系统代理劫持 localhost 请求。

    max_retries=1：翻译是短任务，上游抖动时只重试一次即报错，
    避免 SDK 默认多次重试 + 退避导致前端长时间转圈。
    """
    return AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
        timeout=timeout,
        max_retries=1,
        http_client=httpx.AsyncClient(trust_env=False, timeout=timeout),
    )


def _strip_quotes(text: str) -> str:
    """去掉模型可能额外加上的引号（中英文引号、反引号）。"""
    t = text.strip()
    for q in ('"', "'", "“", "”", "`"):
        if t.startswith(q) and t.endswith(q) and len(t) > 1:
            t = t[1:-1].strip()
    return t.strip()


@router.get("/skills")
async def list_skills():
    return {"skills": _discover_skills()}


@router.post("/skills/translate")
async def translate_skill(req: TranslateRequest):
    # 注意：必须定义在 GET /skills/{name} 之前，否则 /skills/translate 会被 {name} 抢先匹配
    """把技能英文简介翻译成中文并持久化到 SKILL.md 的 description_zh 字段。"""
    try:
        detail = get_skill_detail(req.name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"技能不存在: {req.name}") from None
    src = (detail.get("description") or "").strip()
    if not src:
        raise HTTPException(status_code=400, detail="该技能没有可翻译的英文简介（description 为空）")

    base_url = (req.base_url or settings.openai_base_url).rstrip("/")
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 API Key，无法翻译（请在设置或 .env 中配置）")
    model = req.model or settings.openai_model
    client = _make_client(base_url, api_key, 30.0)
    try:
        res = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
                {"role": "user", "content": src},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        translated = _strip_quotes(res.choices[0].message.content or "")
        if not translated:
            raise HTTPException(status_code=502, detail="翻译结果为空，请重试")
        set_skill_description_zh(req.name, translated)
        return {"name": req.name, "description_zh": translated}
    except OpenAIError as e:
        logger.warning("Translate upstream error: %s", e)
        raise HTTPException(status_code=502, detail=f"翻译失败: {e}") from e
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("Translate unexpected error")
        raise HTTPException(status_code=500, detail=f"翻译失败: {e}") from e
    finally:
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass


@router.get("/skills/{name}")
async def skill_detail(name: str):
    try:
        return get_skill_detail(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"技能不存在: {name}") from None


@router.delete("/skills/{name}")
async def delete_skill(name: str):
    try:
        return trash_skill(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"技能不存在: {name}") from None
