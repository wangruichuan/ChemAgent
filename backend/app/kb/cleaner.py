"""Text cleaning for extracted markdown (before chunking).

Conservative, structure-aware: never touches content inside fenced code
blocks, tables or math, but strips the noise that OCR/parsers introduce:
  - control chars / zero-width chars
  - trailing spaces, collapsed blank lines
  - repeated page headers/footers (e.g. journal name, page numbers)
  - markdown link URL-only fragments

Two stages:
  1. rule-based `clean_text` — fast, zero-cost, always runs
  2. optional LLM-assisted `clean_with_llm` — semantic cleanup, opt-in,
     degrades to rule-based on failure
"""
import logging
import re
from typing import Any

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\ufeff\u00ad]")
_TRAILING_SPACE_RE = re.compile(r"[ \t]+$", re.MULTILINE)
_BLANK_LINES_RE = re.compile(r"\n{3,}")
_PAGE_FOOTER_RE = re.compile(r"^\s*(?:第?\s*\d+\s*页?|page\s*\d+|[-—–·•\s]*\d+\s*[-—–·•\s]*)\s*$", re.IGNORECASE)
_URL_ONLY_RE = re.compile(r"^\s*!?\[[^\]]*\]\(https?://[^)]+\)\s*$")

# journal-noise patterns common in extracted papers (Elsevier/ACS/RSC etc.)
_JOURNAL_NOISE_RE = re.compile(
    r"^\s*("
    r"contents lists available at sciencedirect"
    r"|journal homepage[:：].*"
    r"|journal of [\w\s]+\(\d{4}\)\s*\d+\s*[–-]\s*\d+"
    r"|available online\s+\d+\s+\w+\s+\d{4}"
    r"|https?://(?:dx\.)?doi\.org/[\w./-]+"
    r"|doi[:：]\s*[\w./-]{5,}"
    r"|©\s*\d{4}\s+[\w\s,.&]+(?:ltd|inc|llc|elsevier|wiley|acs|rsc|springer).*"
    r"|elsevier\s+(?:ltd|inc)\..*"
    r"|sciencedirect"
    r")\s*\.?$",
    re.IGNORECASE,
)

# standalone "Keywords: ..." residue from two-column extraction
_KEYWORDS_RE = re.compile(r"^\s*keywords\s*[:：].{0,300}$", re.IGNORECASE | re.DOTALL)


def clean_text(markdown: str) -> str:
    """Clean extracted markdown while preserving structure.

    Code blocks and inline content are handled line-wise so fenced blocks
    keep their exact content; structural cleanup applies to the rest.
    """
    if not markdown:
        return markdown

    text = _CONTROL_RE.sub("", markdown)
    text = _ZERO_WIDTH_RE.sub("", text)

    lines = text.splitlines()
    cleaned: list[str] = []
    in_fence = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            cleaned.append(line)
            continue
        if in_fence:
            cleaned.append(line)  # code content untouched
            continue
        if stripped.startswith("|"):
            cleaned.append(_TRAILING_SPACE_RE.sub("", line))  # table rows: keep, trim
            continue
        if (
            _PAGE_FOOTER_RE.match(line)
            or _URL_ONLY_RE.match(line)
            or _JOURNAL_NOISE_RE.match(line)
            or _KEYWORDS_RE.match(line)
        ):
            continue  # drop page numbers / standalone urls / journal noise
        cleaned.append(_TRAILING_SPACE_RE.sub("", line))

    text = "\n".join(cleaned)
    text = _BLANK_LINES_RE.sub("\n\n", text)

    # Drop repeated page headers/footers: a short line appearing >=3 times
    # (e.g. journal name on every page). Safe threshold: short + frequent.
    from collections import Counter

    counter = Counter(l.strip() for l in text.splitlines() if 2 <= len(l.strip()) <= 40)
    repeat_lines = {line for line, n in counter.items() if n >= 3}
    if repeat_lines:
        text = "\n".join(
            l for l in text.splitlines() if l.strip() not in repeat_lines
        )

    return text.strip()


# ---------- LLM-assisted cleaning ----------

_CLEAN_PROMPT = """你是化学科研论文的文档清洗引擎。对下面从 PDF/OCR 提取出的 Markdown 文本做清洗，目标产出适合 RAG 检索的**纯平文本**（去除所有 Markdown 标记）。

删除以下内容：
1. 正文中的引用标注：如 [1]、[12,15]、[2-5]、[1-3,7]（含上标形式），直接删除编号本身，保留句子
2. 整个参考文献列表：References / REFERENCES / 参考文献 / Bibliography 标题到该章结束
3. 期刊元信息：Received / Accepted / Published 日期行、DOI、期刊卷期页码、页眉页脚
4. 与正文无关的章节：作者贡献（Author Contributions / CRediT）、致谢（Acknowledgements）、利益冲突（Conflict of Interest）、资助声明（Funding）、补充材料说明、版权声明
5. 明显的 OCR 噪声：乱码行、重复残缺行、被硬拆开的词、孤立页码

去除 Markdown 结构，转为纯文本：
- 标题标记：去掉行首的 #（保留标题文字本身）
- 行内格式：去掉 **加粗**、*斜体*、`行内代码` 等标记，只留文字
- 列表：去掉行首的 -、*、1. 等符号，保留条目文字
- 链接/图片：![alt](url) 和 [text](url) 只保留 text 或 alt
- 表格：去掉管道符 | 和表头分隔行（|---|），单元格内容用空格分隔
- 数学公式：$$...$$ 与 $...$ 去掉 $ 符号，保留公式内容
- 代码块（```...```）：围栏标记去掉，代码内容原样保留

修复明显的 OCR 混淆（仅当语义明确时）：
- 化学式下标/上标被拍平：C2H5OH → C₂H₅OH、CO2 → CO₂、H2O → H₂O、Fe2O3 → Fe₂O₃、SO4(2-) → SO₄²⁻
- 希腊字母被替换：a/b/y/g 出现在化学语境 → α/β/γ（如 g-Al2O3 → γ-Al₂O₃）
- 单位符号错乱：oC → °C、h-1 → h⁻¹、mol/L、mL/min、bar、MPa、WHSV 等单位保持原样不翻译

严格保留（文字内容一个字符不改）：
- 催化剂命名：Cu-Zn-Al、Pd/C、γ-Al₂O₃、X%M/support 等
- 表格里的数据值、公式内容、代码块内容
- 化学式、反应方程式、反应箭头（→ ← ⇌）
- 正文所有描述性句子、标题文字

严格禁止：
- 不总结、不翻译、不添加任何解释、不合并或重写句子
- 不改变任何数值、单位、化学式、表格数据
- 删除引用标注时只删编号，不删括号或句子成分

输出：仅返回清洗后的完整纯文本（不含任何 Markdown 标记），不要任何前后缀说明。若无需清洗，按上述规则转纯文本后原样返回。

--- 待清洗文本 ---
{text}
"""

_CLEAN_PIECE_CHARS = 6000   # per-request text size (fits most contexts)
_CLEAN_OVERLAP_CHARS = 200  # overlap between pieces to keep boundaries safe


async def clean_with_llm(
    markdown: str,
    base_url: str,
    api_key: str,
    model: str,
    timeout: float = 90.0,
    progress_cb=None,
) -> str:
    """Clean markdown via an LLM, piece by piece. Falls back to original text
    on any failure so ingestion never blocks on cleaning.
    progress_cb: optional async callable(text) for piece-level progress."""
    if not markdown.strip():
        return markdown
    if not model:
        return clean_text(markdown)  # no model configured → rule-based only

    pieces = _slice_pieces(markdown, _CLEAN_PIECE_CHARS, _CLEAN_OVERLAP_CHARS)
    cleaned: list[str] = []
    try:
        total = len(pieces)
        for i, piece in enumerate(pieces, 1):
            if progress_cb:
                try:
                    await progress_cb(f"LLM 清洗 {i}/{total}")
                except Exception:  # noqa: BLE001
                    pass
            out = await _call_llm(piece, base_url, api_key, model, timeout)
            # keep only real content, never empty the piece entirely
            out = (out or "").strip()
            if out and len(out) >= 20:
                cleaned.append(out)
            else:
                cleaned.append(piece)  # suspiciously short output → keep original
    except Exception as e:  # noqa: BLE001 — degradation, never block ingestion
        logger = logging.getLogger(__name__)
        logger.warning("LLM cleaning failed, fallback to rule-based: %s", e)
        return clean_text(markdown)

    result = "\n\n".join(cleaned)
    return clean_text(result)


async def _call_llm(text: str, base_url: str, api_key: str, model: str, timeout: float) -> str:
    import httpx
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        timeout=timeout,
        http_client=httpx.AsyncClient(trust_env=False, timeout=timeout),
    )
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _CLEAN_PROMPT.format(text=text)},
        ],
        temperature=0.0,
        max_tokens=min(8192, len(text) * 2 + 1024),
    )
    return resp.choices[0].message.content or ""


# ---------- pluggable cleaner registry ----------
# 训练好的专用清洗小模型在这里注册，upload 时传 cleaner 名字即可切换。
# 契约：async def fn(text: str) -> str  —— 输入 Markdown，返回清洗后 Markdown。
# 示例（本地推理服务 / ONNX / HF pipeline 均可）：
#   from . import cleaner
#   async def my_model_clean(text: str) -> str:
#       result = await my_engine.predict(text)   # 你的推理代码
#       return result or text                    # 失败返回原文，不阻塞入库
#   cleaner.register_cleaner("my_cleaner", my_model_clean)
# 上传时传 form 字段 cleaner="my_cleaner" 即生效（优先于 LLM 清洗）。

_CLEANERS: dict[str, Any] = {}


def register_cleaner(name: str, fn: Any) -> None:
    """Register a custom cleaner. fn must be `async def fn(text: str) -> str`."""
    _CLEANERS[name] = fn


async def clean_pipeline(
    markdown: str,
    base_url: str = "",
    api_key: str = "",
    clean_model: str = "",
    custom_cleaner: str = "",
    progress_cb=None,
) -> str:
    """Three-stage cleaning entry:
      1. rule-based clean_text — always, as a safety net
      2. registered custom cleaner (trained small model) — if name given
      3. LLM semantic cleaning — if clean_model given and no custom cleaner
    progress_cb: optional async callable(text) forwarded to LLM cleaning.
    """
    md = clean_text(markdown)  # stage 1, always
    if custom_cleaner and custom_cleaner in _CLEANERS:
        try:
            out = await _CLEANERS[custom_cleaner](md)
            return out if (out or "").strip() else md
        except Exception as e:  # noqa: BLE001 — degrade, never block ingestion
            logging.getLogger(__name__).warning(
                "Custom cleaner %s failed, fallback to rule-based: %s", custom_cleaner, e
            )
            return md
    if clean_model:
        return await clean_with_llm(md, base_url, api_key, clean_model, progress_cb=progress_cb)
    return md


def _slice_pieces(text: str, size: int, overlap: int) -> list[str]:
    if len(text) <= size:
        return [text]
    pieces: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        pieces.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return pieces
