"""FastAPI 化学工具服务端

纯数据查询层，不依赖任何 LLM。Agent 角色由 QwenPaw 承担。

端点：
- POST /api/tools/call      调用工具
- GET  /api/tools/list       列出工具
- GET  /api/health           健康检查
- GET  /api/svg/{smiles}     分子结构图
- GET  /api/formula/{eq}     化学方程式渲染（KaTeX + mhchem）
"""

from __future__ import annotations

import re
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import SkillConfig
from .tools.registry import ToolRegistry
from .tools.name_resolver import NameToStructureTool
from .tools.smiles_inspector import SmilesInspectorTool
from .tools.safety_lookup import SafetyLookupTool
from .tools.reaction_predict import ReactionPredictTool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

config = SkillConfig()
registry = ToolRegistry()


def _register_tools() -> None:
    registry.register(NameToStructureTool())
    registry.register(SmilesInspectorTool())
    registry.register(SafetyLookupTool())
    registry.register(ReactionPredictTool())
    logger.info(f"共注册 {len(registry)} 个工具")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _register_tools()
    logger.info(f"ChemVision Skill 已启动 | 端口: {config.server_port}")
    yield
    logger.info("ChemVision Skill 已关闭")


app = FastAPI(
    title="ChemVision Agent Skill",
    description="化学工具服务 — PubChem + OPSIN 数据查询 + 分子结构渲染",
    version="3.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class ToolCallRequest(BaseModel):
    tool_name: str
    arguments: dict = Field(default_factory=dict)


class ToolCallResponse(BaseModel):
    success: bool
    result: dict


# ── API 路由 ──

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "tools_count": len(registry),
        "tools": [t["name"] for t in registry.list_tools()],
    }


@app.get("/api/tools/list")
async def list_tools():
    return {"tools": registry.list_tools()}


@app.post("/api/tools/call", response_model=ToolCallResponse)
async def call_tool(request: ToolCallRequest):
    result = await registry.call(request.tool_name, request.arguments)
    return ToolCallResponse(success="error" not in result, result=result)


@app.get("/api/svg/{smiles:path}")
async def get_svg(smiles: str):
    """SMILES -> 分子结构图（smiles-drawer）"""
    s = smiles.strip()
    if not s:
        return HTMLResponse("<p>缺少 smiles 参数</p>", status_code=400)

    safe = _js_escape(s)
    return HTMLResponse(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>structure</title>'
        '<style>body{margin:0;background:#fff;display:flex;align-items:center;justify-content:center;height:100vh}'
        'svg{max-width:100%}</style></head><body>'
        '<svg id="m" width="500" height="400"></svg>'
        '<script src="/static/smiles-drawer.js"></script>'
        f'<script>var d=new SmilesDrawer.SvgDrawer({{width:500,height:400,bondThickness:2,padding:20}});'
        f'SmilesDrawer.parse("{safe}",function(t){{d.draw(t,document.getElementById("m"),"light")}},'
        'function(e){document.body.innerHTML="<p style=color:red;padding:20px>"+e+"</p>"})</script></body></html>'
    )


@app.get("/api/formula/{equation:path}")
async def render_formula(equation: str):
    r"""化学方程式渲染（KaTeX + mhchem，全部本地加载）

    输入示例: CH3COOH+C2H5OH<=>[浓硫酸][加热]CH3COOC2H5+H2O
    自动转换为 mhchem \ce{} 语法渲染。
    """
    raw = equation.strip()
    if not raw:
        return HTMLResponse("<p>缺少 equation 参数</p>", status_code=400)

    ce_expr = _to_mhchem(raw)
    safe_expr = _js_escape(ce_expr)

    return HTMLResponse(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>equation</title>'
        '<link rel="stylesheet" href="/static/katex.min.css">'
        '<script src="/static/katex.min.js"></script>'
        '<script src="/static/mhchem.min.js"></script>'
        '<style>'
        'body{margin:0;background:#fff;display:flex;align-items:center;justify-content:center;'
        'min-height:100vh;padding:30px}'
        '#box{text-align:center;padding:20px 40px}'
        '.katex{font-size:1.8em}'
        '#label{font-size:12px;color:#999;margin-bottom:14px;font-family:sans-serif}'
        '</style></head><body><div id="box">'
        '<div id="label">ChemVision</div>'
        '<div id="render"></div></div>'
        '<script>'
        'try{katex.render("\\\\ce{' + safe_expr + '}",document.getElementById("render"),'
        '{throwOnError:false,displayMode:true})}'
        'catch(e){document.getElementById("render").innerHTML='
        '"<p style=color:red>渲染失败: "+e.message+"</p>"}'
        '</script></body></html>'
    )


def _to_mhchem(eq: str) -> str:
    r"""将用户输入格式转为 mhchem \ce{} 内容

    转换规则：
    - [条件]紧邻箭头前 → 移到箭头后（mhchem 语法: arrow[above][below]）
    - 分隔符 + 两边加空格（mhchem 中无空格的 + 会被当作电荷符号）
    """
    # 1. 重排条件到箭头后
    result = re.sub(
        r'(\[[^\]]+\])(\[[^\]]+\])?(<=>|->|<-)',
        _rearrange_conditions,
        eq,
    )
    # 2. 给分隔符 + 加空格（避免 mhchem 把 + 当作电荷符号）
    #    用临时占位符保护 ^{...} 内的 +，再处理，再还原
    #    保护: Fe^{2+} → Fe^{2§CHARGE§}
    result = re.sub(r'\^(?:\{([^}]*)\}|([0-9]+[+-]))',
                    lambda m: '^{' + (m.group(1) or m.group(2)).replace('+', '§CHARGE§').replace('-', '§NEG§') + '}',
                    result)
    # 现在安全地给所有剩余 + 加空格
    result = result.replace('+', ' + ')
    # 还原电荷符号
    result = result.replace('§CHARGE§', '+').replace('§NEG§', '-')
    # 清理多余空格
    result = re.sub(r'  +', ' ', result).strip()
    return result


def _rearrange_conditions(m: re.Match) -> str:
    """重排条件到箭头后面（mhchem 格式）"""
    cond1 = m.group(1)
    cond2 = m.group(2) or ''
    arrow = m.group(3)
    return f'{arrow}{cond1}{cond2}'


def _js_escape(s: str) -> str:
    return s.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\n', '\\n')


def main():
    uvicorn.run(
        "chemskill.server:app",
        host=config.server_host,
        port=config.server_port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
