# ChemAgent · 化学科研智能体

面向化学科研场景的本地 AI Agent：对话 + 工具调用 + 知识库 + 技能系统，支持 Electron 桌面版与浏览器版。

## ✨ 功能特性

| 能力 | 说明 |
|---|---|
| 💬 AI 对话 | 流式输出、可展开思考流、OpenAI 兼容 API（DeepSeek / Qwen / OpenAI 均可） |
| 🛠️ 工具调用 | 文件读写、执行命令、chemvision 化学结构可视化、技能系统（guizang 网页 PPT 等） |
| 📚 知识库 | 文档导入、LLM 清洗、RAG 检索引用（回答带来源角标） |
| 🧩 技能管理 | 技能列表 / 详情 / 翻译简介 / 自定义技能 |
| 🗂️ 工作区 | 本地目录锚定，产物预览 / 执行 / 定位 |
| ✅ 人工确认 | 敏感操作（写文件 / 执行命令）结果查看闸（Approval Card） |
| 📝 选中即问 | 拖选文本 → 解释 / 改写 / 总结 / 追问（Selection Actions） |
| 🎨 双主题 | 浅色（默认）与暗色 AI-native 高级风，一键切换持久化 |
| 🖥️ 桌面版 | Electron 壳 + PyInstaller 后端 exe，免装 Python/Node，Windows x64 |

## 🏗️ 架构

```
┌──────────────┐   HTTP/SSE    ┌──────────────────────┐
│  前端 (React) │ ────────────▶ │  后端 (FastAPI)       │
│ Vite + Tailwind│  /api/*     │  + uvicorn :8000      │
└──────────────┘              │  + 工具/知识库/技能    │
        ▲                     └──────────────────────┘
        │ Electron 壳 (desktop/): 主进程拉起后端 exe，
        │ preload 注入原生能力（目录选择等）
```

- `backend/` — FastAPI + uvicorn；PyInstaller 打包为 `chemagent-backend.exe`（内置前端 dist，同源托管）
- `frontend/` — React 19 + Vite + Tailwind CSS 4 + shadcn 系组件
- `desktop/` — Electron 壳（main.js / preload.js）+ electron-builder 打包配置

## 🚀 快速启动（开发模式）

### 1. 后端（端口 8000）

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Windows
.venv\Scripts\uvicorn app.main:app --port 8000
```

### 2. 前端（端口 5173，已代理 /api → 8000）

```bash
cd frontend
npm install
npm run dev        # 打开 http://localhost:5173
```

### 3. 使用前

右上角「模型设置」填入你自己的 LLM API Key（OpenAI 兼容，DeepSeek / Qwen / OpenAI 等）。

## 📦 桌面版（Electron）

### 启动（dev 模式）

```bash
cd desktop
npm install
npm run dev        # Electron 壳 + 加载 Vite 5173
```

### 打包安装包

```bash
cd desktop
node build.mjs                 # 全量：前端 → 后端 exe → NSIS 安装包
node build.mjs --skip-frontend --skip-backend   # 只重打 Electron 壳
```

产物：`desktop/release/ChemAgent Setup <version>.exe`（NSIS 安装包）与 `desktop/release/win-unpacked/`（便携版）。

> 注：安装包未签名，Windows 首次运行会提示 SmartScreen，点「仍要运行」即可。

## 🧰 常用脚本

| 命令 | 作用 |
|---|---|
| `cd frontend && npm run dev` | 前端热更新开发 |
| `cd frontend && npm run build` | 前端生产构建 |
| `cd desktop && node build.mjs` | 全量打包桌面版 |
| `cd backend && .venv\Scripts\python -m py_compile app/picker.py` | 快速语法检查 |

## 📄 License

[MIT](./LICENSE)
