"""Chat routes: SSE streaming proxy with tool-calling loop for OpenAI-compatible APIs."""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    OpenAIError,
    RateLimitError,
)

from ..config import settings
from ..kb import embedder, retriever
from ..models import (
    ChatRequest,
    ModelInfo,
    ModelsRequest,
    ModelsResponse,
    SummarizeRequest,
)
from ..tools import execute_tool, tools_schema
from ..tools.skills import match_skills_for_query, render_skill_instructions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])

MAX_TOOL_ROUNDS = 12  # 工具循环上限（防死循环；真实 agent 任务允许更多轮）
# 开启深度思考时，reasoning tokens 与正文共用 max_tokens 预算；
# 预算太小会导致思考一长就耗尽、正文还没生成就 finish_reason=length 停掉。
# 因此思考模式下把 max_tokens 抬到该下限，保证思考 + 正文都有空间。
THINKING_MAX_TOKENS_FLOOR = 32768


def _make_client(base_url: str, api_key: str, timeout: float) -> AsyncOpenAI:
    """构造上游客户端：显式禁用环境代理（trust_env=False），避免系统代理劫持 localhost 请求。"""
    import httpx

    return AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
        timeout=timeout,
        http_client=httpx.AsyncClient(trust_env=False, timeout=timeout),
    )


# 可重试的上游错误：连接失败 / 超时 / 限流 / 服务端 5xx。
# 参数错误（400）等客户端错误不重试，避免对必失败请求空转。
_RETRYABLE_STATUS = {408, 409, 429}


def _retryable(e: Exception) -> bool:
    if isinstance(e, (APIConnectionError, APITimeoutError, RateLimitError)):
        return True
    if isinstance(e, APIStatusError):
        return e.status_code in _RETRYABLE_STATUS or e.status_code >= 500
    return False


async def _open_stream_with_retry(create_fn, attempts: int = 3, base_delay: float = 0.5):
    """发起流式请求；在拿到第一个 chunk 之前自动重试可重试错误（指数退避）。

    只在尚未向用户产出任何 token 时重试，避免重复内容。
    返回 (stream, iterator, first_chunk)：first_chunk 是已读出的首个元素（可能为 None），
    调用方用 _chain 把 first 与迭代器剩余部分串成完整流再消费。
    """
    last: Exception | None = None
    for a in range(attempts):
        stream = None
        it = None
        try:
            stream = await create_fn()
            it = stream.__aiter__()
            first = await it.__anext__()
            return stream, it, first
        except StopAsyncIteration:
            return stream, it, None
        except Exception as e:  # noqa: BLE001
            if _retryable(e) and a < attempts - 1:
                last = e
                logger.warning("upstream retryable error (attempt %d/%d): %s", a + 1, attempts, e)
                await asyncio.sleep(base_delay * (2 ** a))
                continue
            raise
    assert last is not None
    raise last


async def _chain(it, first):
    """把已读出的首个 chunk 与迭代器剩余部分串成完整流，供 async for 消费。"""
    if first is not None:
        yield first
    async for c in it:
        yield c


def _resolve(req: ChatRequest | ModelsRequest) -> tuple[str, str]:
    base_url = (req.base_url or settings.openai_base_url).rstrip("/")
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 API Key，请在设置中填写")
    return base_url, api_key


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _inject_kb_context(messages: list[dict], req: ChatRequest) -> list[dict]:
    """Retrieve top-k chunks for the last user message and inject as system context.
    Returns the raw hits so the frontend can display what was referenced."""
    embed_model = (req.embed_model or settings.embed_model).strip()
    if not embed_model or not settings.embed_api_key:
        raise HTTPException(status_code=400, detail="服务端未配置 Embedding 模型或 API Key")
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    if not last_user.strip():
        return []
    try:
        vec = (await embedder.embed_texts([last_user], settings.embed_base_url, settings.embed_api_key, embed_model))[0]
    except embedder.EmbedError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    hits = retriever.retrieve(vec, top_k=5)
    if not hits:
        return []
    # 给每条片段编号（来源 n），供模型在正文里用 〔n〕 就地引用，前端据此渲染行内引用
    parts = []
    for i, h in enumerate(hits, 1):
        head = (
            f"[来源 {i}] {h['filename']} ({h['source']})"
            if h.get("source")
            else f"[来源 {i}] {h['filename']}"
        )
        parts.append(f"{head}\n{h['content']}")
    context = "\n\n".join(parts)
    kb_system = (
        "以下是知识库检索到的参考资料（已按「来源 n」编号）。请优先基于这些资料回答用户问题；"
        "在正文中引用某条资料时，请就地用〔n〕标注其编号（例如：……该反应条件最优〔2〕），"
        "只在确有依据处标注，不要给整段话堆引用；如果资料不足以回答，请明确说明。"
        "不要编造资料中没有的内容。\n\n"
        f"{context}"
    )
    messages.insert(0, {"role": "system", "content": kb_system})
    return hits


AGENT_SYSTEM_PROMPT = (
    "你是 ChemAgent，一个化学领域 AI 助手，可通过工具调用外部技能与本地命令。\n\n"
    "当工具可用（本次对话已开启「工具调用」）且用户的问题可能由某个技能处理时，你必须按以下流程使用工具：\n"
    "1. 若下方已提供【技能指令：xxx】块，直接依据该指令用 run_command 执行，无需再调用 list_skills / read_skill；\n"
    "2. 若未提供技能指令块，先调用 list_skills 查看有哪些技能，再调用 read_skill 加载指令；\n"
    "3. 严格按照技能指令逐步执行，通常用 run_command（支持 cwd 参数指定工作目录，无需 cd）；\n"
    "4. 拿到工具返回的真实数据后，再结合结果回答用户。\n\n"
    "当存在相关技能时，优先使用技能/工具获取真实数据，而不是凭记忆直接回答。\n\n"
    "知识库检索工具 knowledge_base_search：当对话未开启「强制知识库检索」但该工具可用时，"
    "若你判断用户问题可能由本地知识库（已上传的论文 / 实验记录 / 文档）回答，应自行调用此工具检索，"
    "再基于返回的真实片段作答；若与知识库无关则直接回答，不要盲目检索。\n\n"
    "知识库引用：无论是强制检索还是你调用 knowledge_base_search，凡基于知识库片段作答，"
    "请在正文相应处用〔n〕就地标注引用编号（n 为该片段在「来源 n」或检索结果列表中的序号，从 1 开始），"
    "让用户能直接看到每条结论出自哪条资料；没有依据的地方不要标，更不要编造编号。"
)


def _consolidate_system(messages: list[dict]) -> None:
    """把所有 system 消息按原顺序合并为一条、置于 index 0。

    Qwen3.5+ 的 chat template 要求 system 只能出现在第一条，
    出现第二条即抛 'System message must be at the beginning.'。
    """
    texts: list[str] = []
    rest: list[dict] = []
    for m in messages:
        if m.get("role") == "system":
            c = (m.get("content") or "").strip()
            if c:
                texts.append(c)
        else:
            rest.append(m)
    del messages[:]
    if texts:
        messages.append({"role": "system", "content": "\n\n".join(texts)})
    messages.extend(rest)


def _append_system_text(messages: list[dict], text: str) -> None:
    """把一段文本追加到已有 system 消息；若无 system 消息则在最前新建一条。"""
    for m in messages:
        if m.get("role") == "system":
            m["content"] = ((m.get("content") or "").strip() + "\n\n" + text).strip()
            return
    messages.insert(0, {"role": "system", "content": text})


def _ensure_agent_system_prompt(messages: list[dict], req: ChatRequest) -> None:
    """当开启工具调用时，确保模型收到一段 agent 指令，引导其发现并使用技能。

    策略：复用已有的第一条 system 消息（追加指令），若无则新建一条插到最前。
    这样即使前端 systemPrompt 为空，技能链路也能稳定触发。
    """
    if not req.tools:
        return
    for m in messages:
        if m.get("role") == "system":
            m["content"] = (m.get("content") or "").strip()
            if m["content"]:
                m["content"] += "\n\n" + AGENT_SYSTEM_PROMPT
            else:
                m["content"] = AGENT_SYSTEM_PROMPT
            return
    # 没有任何 system 消息时，插到最前
    messages.insert(0, {"role": "system", "content": AGENT_SYSTEM_PROMPT})


def _merge_tool_calls(acc: dict[int, dict], chunk_delta) -> dict[int, dict]:
    """把流式 delta.tool_calls 增量合并进 acc（arguments 分片需按 index 拼接）。"""
    for tc in chunk_delta:
        idx = tc.index
        entry = acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
        if tc.id:
            entry["id"] = tc.id
        if tc.function:
            if tc.function.name:
                entry["name"] += tc.function.name
            if tc.function.arguments:
                entry["arguments"] += tc.function.arguments
    return acc


@router.post("/chat")
async def chat(req: ChatRequest):
    base_url, api_key = _resolve(req)
    model = req.model or settings.openai_model
    client = _make_client(base_url, api_key, 300.0)

    async def event_stream():
        try:
            messages = [m.model_dump() for m in req.messages]
            # Knowledge base retrieval: inject top-k chunks into a system message
            kb_hits: list[dict] = []
            if req.use_kb:
                try:
                    kb_hits = await _inject_kb_context(messages, req)
                except Exception as e:  # noqa: BLE001 — KB failure should not kill chat
                    logger.warning("KB injection failed: %s", e)
            # 开启工具调用时，注入 agent 指令，引导模型发现并使用技能
            _ensure_agent_system_prompt(messages, req)
            # 技能自动路由：命中相关技能则把其指令直接注入 system，并强制首轮触发工具调用
            force_tool = False
            if req.tools:
                last_user = next(
                    (m["content"] for m in reversed(messages) if m.get("role") == "user"),
                    "",
                )
                for sname in match_skills_for_query(last_user):
                    instr = render_skill_instructions(sname)
                    if instr:
                        _append_system_text(
                            messages,
                            f"【技能指令：{sname}】\n{instr}\n\n"
                            "注意：用户的问题应由上述技能处理。你必须调用工具（run_command 等）"
                            "执行该技能获取真实数据，不要仅凭记忆直接回答。",
                        )
                        force_tool = True
            # notify the frontend which KB snippets were referenced (before the reply)
            if kb_hits:
                yield _sse({
                    "type": "kb_hits",
                    "hits": [
                        {
                            "filename": h["filename"],
                            "content": (h["content"] or "")[:400],
                            "score": round(h.get("score", 0), 3),
                        }
                        for h in kb_hits
                    ],
                })
            # 排查用日志：记录实际发给模型的 system 消息与消息角色序列
            sys_msgs = [m for m in messages if m.get("role") == "system"]
            logger.warning(
                "CHAT-DEBUG model=%s system_msgs=%s roles=%s",
                model,
                [s.get("content", "")[:200] for s in sys_msgs],
                [m.get("role") for m in messages],
            )
            # 发送前合并所有 system 消息为一条（Qwen3.5+ 模板要求 system 仅在第一条）
            _consolidate_system(messages)
            extra_body: dict = {}
            # 显式开关思考：开启传 enabled，关闭传 disabled（部分模型默认开启，不传会跟随默认）
            if req.thinking:
                extra_body["thinking"] = {"type": "enabled"}
            else:
                extra_body["thinking"] = {"type": "disabled"}

            # 思考模式抬高 max_tokens 下限（reasoning 与正文共用 completion 预算）
            eff_max_tokens = req.max_tokens or settings.max_tokens
            if req.thinking and eff_max_tokens < THINKING_MAX_TOKENS_FLOOR:
                eff_max_tokens = THINKING_MAX_TOKENS_FLOOR

            started = time.monotonic()
            total_completion = 0
            total_tool_calls = 0
            # 服务端熔断状态：统计同一 (工具名, 参数) 签名被重复调用的次数，超限即强制收尾
            _max_same_call = 3  # 同一工具调用重复上限（防死循环）
            _seen_calls: dict[str, int] = {}
            breaker_tripped = False

            for i in range(MAX_TOOL_ROUNDS + 1):
                # 命中技能时，首轮强制 tool_choice=required，确保模型先调工具而非直接作答；
                # 后续轮恢复正常（让模型能基于工具结果给出最终回答）。
                # 注意：部分模型的思考模式不支持 tool_choice 参数（会抛
                # "Thinking mode does not support this tool_choice" 400），
                # 因此思考模式下不强制 tool_choice，改由已注入的【技能指令】system 块引导模型先调工具。
                tool_choice = "required" if (force_tool and i == 0 and not req.thinking) else None
                def _create_stream():
                    return client.chat.completions.create(
                        model=model,
                        messages=messages,
                        temperature=req.temperature if req.temperature is not None else settings.temperature,
                        max_tokens=eff_max_tokens,
                        stream=True,
                        stream_options={"include_usage": True},
                        # 强制知识库检索(use_kb)时不把 KB 检索工具放进列表（上下文已自动注入，
                        # 避免重复检索）；否则在 agentic 模式下把 KB 检索工具交给模型自行决定调用。
                        tools=(
                            tools_schema(exclude=["knowledge_base_search"])
                            if req.use_kb
                            else tools_schema()
                        )
                        if req.tools
                        else None,
                        tool_choice=tool_choice,
                        extra_body=extra_body,
                    )

                _stream, _iter, _first = await _open_stream_with_retry(_create_stream)

                content_parts: list[str] = []
                tool_calls: dict[int, dict] = {}
                usage_payload = None
                async for chunk in _chain(_iter, _first):
                    if chunk.choices:
                        delta = chunk.choices[0].delta
                        if not delta:
                            continue
                        extra = getattr(delta, "model_extra", None) or {}
                        reasoning = (
                            extra.get("reasoning_content")
                            or extra.get("reasoning")
                            or getattr(delta, "reasoning_content", None)
                            or getattr(delta, "reasoning", None)
                        )
                        if reasoning:
                            yield _sse({"type": "reasoning", "content": reasoning})
                        if delta.content:
                            content_parts.append(delta.content)
                            yield _sse({"type": "delta", "content": delta.content})
                        if delta.tool_calls:
                            _merge_tool_calls(tool_calls, delta.tool_calls)
                    if getattr(chunk, "usage", None):
                        usage_payload = {
                            "prompt_tokens": chunk.usage.prompt_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                            "total_tokens": chunk.usage.total_tokens,
                        }
                        total_completion = chunk.usage.completion_tokens
                        yield _sse({"type": "usage", "usage": usage_payload})

                # 本轮没有工具调用 → 结束
                if not tool_calls:
                    elapsed = time.monotonic() - started
                    yield _sse({
                        "type": "stats",
                        "model": model,
                        "duration_ms": int(elapsed * 1000),
                        "completion_tokens": total_completion,
                        "tool_calls": total_tool_calls,
                    })
                    yield _sse({"type": "done"})
                    return

                # 有工具调用 → 回填 assistant 消息，逐个执行，再进入下一轮
                content = "".join(content_parts)
                sorted_calls = [tool_calls[i] for i in sorted(tool_calls)]
                # 服务端熔断：统计本轮工具调用签名，若同一签名累计重复过多则强制收尾，避免无限循环
                _round_sigs = []
                for c in sorted_calls:
                    try:
                        a = json.loads(c["arguments"] or "{}")
                    except json.JSONDecodeError:
                        a = {}
                    _round_sigs.append(
                        f"{c['name']}:{json.dumps(a, sort_keys=True, ensure_ascii=False)}"
                    )
                for sig in set(_round_sigs):
                    _seen_calls[sig] = _seen_calls.get(sig, 0) + _round_sigs.count(sig)
                if any(v >= _max_same_call for v in _seen_calls.values()):
                    logger.warning("CHAT-BREAKER tripped: seen=%s", _seen_calls)
                    messages.append({
                        "role": "user",
                        "content": (
                            "[system] 检测到同一工具被反复调用且未取得进展，已触发熔断保护。"
                            "请立即基于目前已获得的信息直接给出最终回答，不要再调用任何工具。"
                        ),
                    })
                    breaker_tripped = True
                    break
                assistant_msg = {
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"]},
                        }
                        for c in sorted_calls
                    ],
                }
                messages.append(assistant_msg)

                for c in sorted_calls:
                    call_id = c["id"]
                    name = c["name"]
                    total_tool_calls += 1
                    try:
                        args = json.loads(c["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield _sse({"type": "tool_call", "name": name, "arguments": args})
                    try:
                        result = await execute_tool(name, args)
                        ok = True
                    except Exception as e:  # noqa: BLE001
                        logger.exception("Tool execution failed: %s", name)
                        result = json.dumps({"error": str(e)}, ensure_ascii=False)
                        ok = False
                    yield _sse({"type": "tool_result", "name": name, "content": result, "ok": ok})
                    # agentic RAG：模型调用知识库检索工具时，把命中片段推给前端展示
                    if name == "knowledge_base_search":
                        try:
                            _kb = json.loads(result)
                        except json.JSONDecodeError:
                            _kb = {}
                        _hits = _kb.get("results") or []
                        if _hits:
                            yield _sse({
                                "type": "kb_hits",
                                "hits": [
                                    {
                                        "filename": h.get("filename", ""),
                                        "content": (h.get("content") or "")[:400],
                                        "score": round(h.get("score", 0), 3),
                                    }
                                    for h in _hits
                                ],
                            })
                    messages.append(
                        {"role": "tool", "tool_call_id": call_id, "content": result}
                    )

            # 超出轮数上限：不再直接报错，让模型基于已有信息收尾
            if not breaker_tripped:
                messages.append({
                    "role": "user",
                    "content": (
                        f"[system] 工具调用已进行 {MAX_TOOL_ROUNDS} 轮仍未结束，"
                        "请立即基于目前已获得的信息直接给出最终回答，不要再调用任何工具。"
                    ),
                })
            def _create_final():
                return client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=req.temperature if req.temperature is not None else settings.temperature,
                    max_tokens=eff_max_tokens,
                    stream=True,
                    stream_options={"include_usage": True},
                    tools=None,  # 禁止再调用工具
                    extra_body=extra_body,
                )

            _fstream, _fiter, _ffirst = await _open_stream_with_retry(_create_final)
            async for chunk in _chain(_fiter, _ffirst):
                if chunk.choices and chunk.choices[0].delta:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield _sse({"type": "delta", "content": delta.content})
            elapsed = time.monotonic() - started
            yield _sse({
                "type": "stats",
                "model": model,
                "duration_ms": int(elapsed * 1000),
                "completion_tokens": total_completion,
                "tool_calls": total_tool_calls,
            })
            yield _sse({"type": "done"})
        except OpenAIError as e:
            message = str(e)
            logger.warning("Upstream error: %s", message)
            yield _sse({"type": "error", "message": message})
        except Exception as e:  # noqa: BLE001
            logger.exception("Unexpected error during streaming")
            yield _sse({"type": "error", "message": f"服务端异常: {e}"})
        finally:
            # 每个请求独立创建上游 client，消费完即关，防止连接池随请求累积
            try:
                await client.close()
            except Exception:  # noqa: BLE001
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


SUMMARIZE_SYSTEM_PROMPT = (
    "你是对话压缩助手。请把用户提供的一段多轮对话压缩成简洁但信息完整的中文摘要，"
    "必须保留：① 关键事实与数据；② 已达成的结论；③ 用户明确表达的偏好、约束或要求；"
    "④ 尚未解决的问题或待办；⑤ 后续对话继续所需的最小上下文。"
    "用客观陈述，不超过 400 字，不要编造对话中未出现的信息，不要用列表，直接输出摘要正文。"
)


@router.post("/chat/summarize")
async def summarize(req: SummarizeRequest):
    """把较早的多轮对话压缩成摘要，用于长对话上下文管理。"""
    base_url, api_key = _resolve(req)
    model = req.model or settings.openai_model
    client = _make_client(base_url, api_key, 120.0)
    try:
        transcript = "\n".join(
            f"{m.role}: {m.content}" for m in req.messages if (m.content or "").strip()
        )
        if not transcript.strip():
            return {"summary": (req.prior_summary or "").strip()}
        sys_prompt = SUMMARIZE_SYSTEM_PROMPT
        if req.prior_summary and req.prior_summary.strip():
            sys_prompt += (
                "\n\n以下是此前已生成的摘要，请与新对话合并更新（去重、保留仍然有效的信息）：\n"
                + req.prior_summary.strip()
            )
        res = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": transcript},
            ],
            temperature=0.2,
            max_tokens=req.max_tokens or 800,
        )
        summary = (res.choices[0].message.content or "").strip()
        return {"summary": summary}
    except OpenAIError as e:
        logger.warning("Summarize upstream error: %s", e)
        raise HTTPException(status_code=502, detail=f"压缩上下文失败: {e}") from e
    except Exception as e:  # noqa: BLE001
        logger.exception("Summarize unexpected error")
        raise HTTPException(status_code=500, detail=f"压缩上下文失败: {e}") from e
    finally:
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass


@router.post("/models", response_model=ModelsResponse)
async def list_models(req: ModelsRequest):
    base_url, api_key = _resolve(req)
    client = _make_client(base_url, api_key, 30.0)
    try:
        res = await client.models.list()
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=f"获取模型列表失败: {e}") from e
    models = [
        ModelInfo(id=m.id, owned_by=getattr(m, "owned_by", None))
        for m in res.data
    ]
    models.sort(key=lambda m: m.id)
    return ModelsResponse(models=models)
