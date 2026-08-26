"""skills 系统：管理 ChemAgent 自己的技能库（SKILL.md 格式）。

技能存放在项目内 backend/app/tools/skills_store/ 下（独立于 WorkBuddy 技能），
初始为空，用户可通过管理面板/手动放置 SKILL.md 逐步添加。
"""
import json
import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

from .registry import tool
from ..paths import data_root

logger = logging.getLogger(__name__)

# ChemAgent 自己的技能库目录（数据根下；打包后由 ensure_data_dirs 首次启动复制）
SKILLS_DIR = data_root() / "skills_store"


def _parse_frontmatter(text: str) -> Dict[str, str]:
    """提取 SKILL.md 的 YAML frontmatter（简化解析，取关键字段）。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: Dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if ":" in line and not line.startswith("#"):
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip('"').strip("'")
    return meta


def _discover_skills() -> List[Dict[str, str]]:
    """扫描技能库，返回技能元信息列表。"""
    found: List[Dict[str, str]] = []
    if not SKILLS_DIR.exists():
        return found
    seen: set = set()
    for sk in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        try:
            text = sk.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        meta = _parse_frontmatter(text)
        name = meta.get("name") or sk.parent.name
        if name in seen:
            continue
        seen.add(name)
        # 触发词（frontmatter `triggers: a, b, c`）：用于 match_skills_for_query 按 skill 精确路由。
        # 按逗号切分（保留多词触发词），去空白并转小写。
        triggers_raw = meta.get("triggers", "")
        triggers = [t.strip().lower() for t in re.split(r"[,，]+", triggers_raw) if t.strip()]
        found.append({
            "name": name,
            "description": meta.get("description", ""),
            "description_zh": meta.get("description_zh", ""),
            "display_name": meta.get("display_name", name),
            "path": str(sk.parent),
            "triggers": triggers,
        })
    return found


def _render_instructions(body: str, skill_dir: str) -> str:
    """把 SKILL.md 正文里的占位符替换成运行时真实值。

    - {{SKILL_DIR}} / <SKILL_ROOT> → 技能目录的绝对路径（供 run_command 的 cwd 使用）。
      用正斜杠：Windows 的 Python/run_command 同样认正斜杠路径，
      且正斜杠在 JSON 里无需转义，能避免模型在工具参数里把反斜杠路径弄丢。
      两个占位符并存：{{SKILL_DIR}} 是本项目原生写法，<SKILL_ROOT> 兼容 WorkBuddy
      风格 skill（如 guizang）直接导入后无需改模板路径。
    """
    safe_dir = skill_dir.replace("\\", "/")
    return body.replace("{{SKILL_DIR}}", safe_dir).replace("<SKILL_ROOT>", safe_dir)


# 领域关键词（中英文）：命中即认为该问题需要化学类技能处理
_DOMAIN_KEYWORDS = [
    "化学", "分子", "结构", "式", "反应", "方程", "物质", "化合物", "有机物", "无机",
    "官能", "催化", "谱", "危害", "安全", "毒", "溶解", "酸碱", "氧化", "还原", "试剂",
    "合成", "异构", "沸点", "熔点", "密度", "摩尔", "化学式", "分子量", "分子式",
    "chemical", "chemistry", "molecule", "molecular", "compound", "formula",
    "reaction", "react", "structure", "smiles", "pubchem", "safety", "ghs",
    "toxic", "solution", "acid", "base", "oxid", "reduc", "reagent", "synthe",
    "isomer", "boiling", "melting", "density", "molar", "cataly", "equation",
]


def match_skills_for_query(query: str) -> List[str]:
    """根据用户输入，返回可能相关的技能 name 列表（按 skill 精确匹配）。

    每个 skill 独立判定是否匹配：
    - 若该 skill 在 frontmatter 声明了 `triggers`（触发词）→ 命中任一触发词即匹配（子串匹配，兼容中英文）；
    - 若未声明 triggers → 回退到化学领域关键词启发式（_DOMAIN_KEYWORDS），保证 chemvision 等
      默认 skill 在化学问题下仍可被路由。
    返回所有命中的 skill（可能多个）；返回空列表表示无需技能（如寒暄、闲聊）。

    说明：早期实现是"任一命中即返回全部 skill"，导致非化学 skill（如 guizang）
    被化学查询误注入、或化学查询注入过多指令。现改为按 skill 触发，各 skill 互不牵连。
    """
    q = (query or "").lower().strip()
    if not q:
        return []
    skills = _discover_skills()
    if not skills:
        return []
    matched: List[str] = []
    for s in skills:
        triggers = s.get("triggers") or []
        if triggers:
            if any(t in q for t in triggers):
                matched.append(s["name"])
        else:
            if any(kw.lower() in q for kw in _DOMAIN_KEYWORDS):
                matched.append(s["name"])
    return matched


def render_skill_instructions(name: str) -> str:
    """返回技能渲染后的指令正文（{{SKILL_DIR}} 已替换）。技能不存在则返回空串。"""
    sk = SKILLS_DIR / name / "SKILL.md"
    if not sk.exists():
        return ""
    text = sk.read_text(encoding="utf-8", errors="replace")
    meta = _parse_frontmatter(text)
    body = re.sub(r"^---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.DOTALL)
    return _render_instructions(body.strip(), str(sk.parent))


@tool(
    description=(
        "List all available skills in this system's skill library. Returns each "
        "skill's name and description. Use this first to see what capabilities "
        "exist, then call read_skill to load the instructions of a skill."
    ),
    parameters={
        "type": "object",
        "properties": {},
    },
)
def list_skills() -> str:
    skills = _discover_skills()
    if not skills:
        return json.dumps({"skills": [], "note": "技能库为空，暂无可用技能"}, ensure_ascii=False)
    return json.dumps(
        [
            {
                "name": s["name"],
                "description": s["description"],
                "description_zh": s["description_zh"],
            }
            for s in skills
        ],
        ensure_ascii=False,
    )


@tool(
    description=(
        "Load the full instructions (SKILL.md) of a skill by its exact name. "
        "Use after list_skills when the model decides to use a skill: read the "
        "instructions and follow them step by step."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Exact skill name from list_skills",
            },
        },
        "required": ["name"],
    },
)
def read_skill(name: str) -> str:
    sk = SKILLS_DIR / name / "SKILL.md"
    if not sk.exists():
        return json.dumps({"error": f"未找到 skill: {name}"}, ensure_ascii=False)
    try:
        text = sk.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return json.dumps({"error": f"读取失败: {e}"}, ensure_ascii=False)
    meta = _parse_frontmatter(text)
    body = re.sub(r"^---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.DOTALL)
    instructions = _render_instructions(body.strip(), str(sk.parent))
    return json.dumps(
        {"name": name, "description": meta.get("description", ""), "instructions": instructions},
        ensure_ascii=False,
    )


def get_skill_detail(name: str) -> Dict:
    """返回技能详情（frontmatter + 完整指令正文）。供前端面板使用。"""
    sk = SKILLS_DIR / name / "SKILL.md"
    if not sk.exists():
        raise FileNotFoundError(f"skill not found: {name}")
    text = sk.read_text(encoding="utf-8", errors="replace")
    meta = _parse_frontmatter(text)
    body = re.sub(r"^---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.DOTALL)
    return {
        "name": name,
        "display_name": meta.get("display_name", name),
        "description": meta.get("description", ""),
        "description_zh": meta.get("description_zh", ""),
        "version": meta.get("version", ""),
        "path": str(sk.parent),
        "instructions": _render_instructions(body.strip(), str(sk.parent)),
    }


def trash_skill(name: str) -> Dict:
    """把技能目录移入项目内回收目录（软删除，可恢复）。"""
    import shutil

    src = SKILLS_DIR / name
    if not src.is_dir():
        raise FileNotFoundError(f"skill not found: {name}")
    trash = SKILLS_DIR.parent / ".skills_trash"
    trash.mkdir(parents=True, exist_ok=True)
    dst = trash / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.move(str(src), str(dst))
    return {"deleted": name, "trash": str(dst)}


def set_skill_description_zh(name: str, text: str) -> None:
    """把翻译结果写回 SKILL.md 的 frontmatter `description_zh` 字段（保留其余内容）。

    若 frontmatter 已含 `description_zh` 则原地更新，否则在 frontmatter 末尾追加；
    正文（指令内容）完全不动。写入值用双引号包裹并对内部双引号/反斜杠转义，
    保证 YAML frontmatter 仍可被 _parse_frontmatter 正确解析。
    """
    sk = SKILLS_DIR / name / "SKILL.md"
    if not sk.exists():
        raise FileNotFoundError(f"skill not found: {name}")
    content = sk.read_text(encoding="utf-8")
    safe = text.replace("\\", "\\\\").replace('"', '\\"')

    def repl(m: "re.Match[str]") -> str:
        fm = m.group(1)
        if re.search(r"^\s*description_zh\s*:", fm, re.MULTILINE):
            fm2 = re.sub(
                r"^\s*description_zh\s*:.*$",
                f'description_zh: "{safe}"',
                fm,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            fm2 = fm.rstrip("\n") + f'\ndescription_zh: "{safe}"'
        return "---\n" + fm2 + "\n---"

    new_content = re.sub(r"^---\s*\n(.*?)\n---", repl, content, count=1, flags=re.DOTALL)
    sk.write_text(new_content, encoding="utf-8")
