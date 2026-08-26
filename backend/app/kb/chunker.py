"""Structure-aware text chunking for Markdown / plain text.

Rules:
  - Split on heading levels (# .. ######): a new chunk starts at each heading
  - Preserve fenced code blocks and tables as atomic units (never cut mid-block)
  - Within a section, further split by paragraphs if over target size
  - Optional LLM-suggested boundaries force splits at semantic section starts
"""
import json
import logging
import re

logger = logging.getLogger(__name__)

TARGET_CHARS = 600
MAX_CHARS = 1000
OVERLAP_CHARS = 100

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
_FENCE_RE = re.compile(r"^```", re.MULTILINE)
_TABLE_ROW_RE = re.compile(r"^\s*\|")


def chunk_text(
    text: str,
    target: int = TARGET_CHARS,
    max_chars: int = MAX_CHARS,
    boundaries: set[str] | None = None,
) -> list[str]:
    """Chunk markdown/plain text into semantic pieces (content only).
    boundaries: heading texts (e.g. '## 实验方法') that force a new chunk."""
    text = text.strip()
    if not text:
        return []
    return _chunk_blocks(_split_blocks(text), target, max_chars, boundaries or set())


# ---------- block splitting ----------

def _split_blocks(text: str) -> list[str]:
    """Split text into atomic blocks: headings, fenced blocks, tables, paragraphs."""
    lines = text.splitlines()
    blocks: list[str] = []
    cur: list[str] = []
    in_fence = False
    fence_marker: str | None = None

    def flush():
        if cur:
            blocks.append("\n".join(cur).strip())
            cur.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not in_fence and _FENCE_RE.match(line):
            flush()
            in_fence = True
            fence_marker = line
            cur.append(line)
        elif in_fence:
            cur.append(line)
            if stripped.startswith("```") and fence_marker and stripped == fence_marker:
                flush()
                in_fence = False
                fence_marker = None
        elif not in_fence and _HEADING_RE.match(line):
            flush()
            blocks.append(line.strip())
        elif not in_fence and _is_table_start(lines, i):
            table = [line]
            j = i + 1
            while j < len(lines) and lines[j].strip() and (lines[j].strip().startswith("|") or lines[j].strip().startswith(":") or "|" in lines[j]):
                table.append(lines[j])
                j += 1
            blocks.append("\n".join(table).strip())
            i = j - 1
        else:
            cur.append(line)
        i += 1
    flush()
    return [b for b in blocks if b]


def _is_table_start(lines: list[str], i: int) -> bool:
    line = lines[i].strip()
    if not line.startswith("|"):
        return False
    if i + 1 >= len(lines):
        return True
    nxt = lines[i + 1].strip()
    # separator row: "| --- | :---: |" → only | - : space chars remain
    stripped = nxt.replace("|", "").replace(":", "").replace("-", "").replace(" ", "")
    return not stripped


# ---------- assembling chunks ----------

def _chunk_blocks(blocks: list[str], target: int, max_chars: int, boundaries: set[str]) -> list[str]:
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0

    def flush_buf():
        nonlocal buf, buf_len
        if buf:
            chunks.append("\n\n".join(buf))
        buf, buf_len = [], 0

    for block in blocks:
        block_len = len(block)
        # LLM-suggested boundary: force a new chunk at this heading
        if block in boundaries:
            flush_buf()
            buf.append(block)
            buf_len = block_len + 2
            continue
        # Atomic blocks (tables/fences/headings) that are already too big: keep as-is
        if block_len > max_chars and "\n" in block:
            flush_buf()
            chunks.append(block[:max_chars])  # hard cut as last resort
            # keep remainder as separate chunk
            rest = block[max_chars:]
            if rest.strip():
                chunks.append(rest[:max_chars])
            continue
        # Atomic block that fits but would overflow alone
        if buf and buf_len + block_len > max_chars and block_len >= target:
            flush_buf()
            chunks.append(block)
            continue
        if buf and buf_len + block_len > target and (buf_len > target or block_len > target - OVERLAP_CHARS):
            flush_buf()
        buf.append(block)
        buf_len += block_len + 2  # "\n\n"

    flush_buf()
    return [c for c in chunks if c]


# ---------- LLM-suggested semantic boundaries ----------

_BOUNDARY_PROMPT = """你是论文结构分析器。下面是一篇文档的标题清单（每行格式：序号. 标题文本）：

{headings}

请选出应该作为「检索分块边界」的标题——从该标题开始的内容应作为独立检索块。

选择标准：
1. 顶级章节（摘要/引言/实验/结果/讨论/结论，或编号章节 1. 2. 3. 等）→ 是边界
2. 重要的二三级小节（如 催化剂制备、反应条件、表征方法）→ 是边界
3. 零散的过渡小标题、连续列表式标题、4 级以下的细节小标题 → 不是边界

输出：仅返回选中的序号 JSON 数组，如 [0, 3, 7]。不要任何其他文字或解释。
"""


# meta-noise headings that must never be treated as chunk boundaries
_META_HEADING_RE = re.compile(
    r"^(?:arXiv:|doi:|http|www\.|contents lists|journal of .+\(\d{4}\))",
    re.IGNORECASE,
)
# e.g. "# 1 2 3 4" page-number headings
_PAGE_HEADING_RE = re.compile(r"^[#\s·.\-—]*\d[\d\s·.\-—]*$")


async def suggest_boundaries(
    markdown: str,
    base_url: str,
    api_key: str,
    model: str,
    timeout: float = 90.0,
) -> set[str]:
    """Ask an LLM which headings are semantic chunk boundaries.

    Returns a set of exact heading texts (e.g. {'## 实验方法'}). The output is
    validated against real headings, so a hallucinated boundary is dropped.
    Any failure → empty set (caller falls back to rule-based chunking).
    """
    candidates = []
    for m in _HEADING_RE.finditer(markdown):
        level = len(m.group(1))
        text = m.group(0).strip()
        content = m.group(2).strip()
        if level > 3:
            continue
        # drop meta-noise / page-number headings before asking the LLM
        if _META_HEADING_RE.match(content) or _PAGE_HEADING_RE.match(content):
            continue
        candidates.append(text)
    if len(candidates) < 2:
        return set()

    listing = "\n".join(f"{i}. {t}" for i, t in enumerate(candidates))
    try:
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
            messages=[{"role": "system", "content": _BOUNDARY_PROMPT.format(headings=listing)}],
            temperature=0.0,
            max_tokens=1024,
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        logger.warning("LLM boundary suggestion failed, fallback to rule chunking: %s", e)
        return set()

    indices = _parse_index_list(raw)
    return {candidates[i] for i in indices if 0 <= i < len(candidates)}


def _parse_index_list(raw: str) -> list[int]:
    """Parse 'JSON array of ints' from LLM output, tolerant of fences/text."""
    raw = raw.strip()
    # strip ```json ... ``` fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [int(x) for x in data]
    except (json.JSONDecodeError, ValueError):
        pass
    # fallback: extract numbers like "[0, 3, 7]"
    nums = re.findall(r"\d+", raw)
    return [int(n) for n in nums]
