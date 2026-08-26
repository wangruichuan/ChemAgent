<div align="center">

# ⚗️ ChemAgent · 化学科研智能体

**面向化学科研场景的本地 AI Agent** —— 对话、工具调用、知识库、技能系统，一套代码跑浏览器与桌面。

[![Stars](https://img.shields.io/github/stars/wangruichuan/ChemAgent?style=for-the-badge&logo=github&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/stargazers)
[![Forks](https://img.shields.io/github/forks/wangruichuan/ChemAgent?style=for-the-badge&logo=github&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/forks)
[![License](https://img.shields.io/github/license/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/wangruichuan/ChemAgent?style=for-the-badge&logo=github&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/releases)
[![CI Build](https://img.shields.io/github/actions/workflow/status/wangruichuan/ChemAgent/release.yml?style=for-the-badge&label=CI&logo=githubactions&logoColor=white&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/actions)

[![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)

[![Last Commit](https://img.shields.io/github/last-commit/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/commits/main)
[![Issues](https://img.shields.io/github/issues/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/issues)
[![PRs](https://img.shields.io/github/issues-pr/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)](https://github.com/wangruichuan/ChemAgent/pulls)
[![Top Language](https://img.shields.io/github/languages/top/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)]()
[![Repo Size](https://img.shields.io/github/repo-size/wangruichuan/ChemAgent?style=for-the-badge&color=2e7d5b)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-2e7d5b?style=for-the-badge&logo=github)]()
[![Made with ❤️](https://img.shields.io/badge/Made%20with-%E2%9D%A4%EF%B8%8F-2e7d5b?style=for-the-badge)]()

**🌐 [English](README.md) · [简体中文](README_zh-CN.md)**

</div>

---

> 🧪 **面向化学科研场景的本地 AI Agent**：不只是聊天，而是会调用工具、检索知识库、执行命令、生成分子结构图的科研助手。

## ✨ 功能特性

| | 能力 | 说明 |
|---|---|---|
| 💬 | **AI 对话** | 流式输出、可展开思考流、OpenAI 兼容 API（DeepSeek / Qwen / OpenAI） |
| 🛠️ | **工具调用** | 文件读写、执行命令、chemvision 分子结构可视化、技能系统 |
| 📚 | **知识库** | 文档导入 → LLM 清洗 → RAG 检索引用，回答带来源角标 |
| 🧩 | **技能管理** | 技能列表 / 详情 / 翻译简介，可扩展自定义技能 |
| 🗂️ | **工作区** | 本地目录锚定，产物预览 / 执行 / 文件定位 |
| ✅ | **人工确认** | 敏感操作（写文件 / 执行命令）结果查看闸（Approval Card） |
| 📝 | **选中即问** | 拖选文本 → 解释 / 改写 / 总结 / 追问（Selection Actions） |
| 🎨 | **双主题** | 浅色（默认）+ 暗色 AI-native 高级风，一键切换持久化 |
| 🖥️ | **桌面版** | Electron 壳 + PyInstaller 后端 exe，免装 Python / Node，Windows x64 |

## 🏗️ 架构

```
┌───────────────┐   HTTP / SSE    ┌────────────────────────┐
│  前端 (React)  │ ──────────────▶ │  后端 (FastAPI)        │
│  React 19     │     /api/*      │  + uvicorn :8000       │
│  Tailwind 4   │                 │  + 工具 / 知识库 / 技能 │
└───────────────┘                 └────────────────────────┘
        ▲
        │  Electron 壳 (desktop/)：主进程拉起后端 exe，
        │  preload 注入原生能力（目录选择等）
```

| 目录 | 说明 |
|---|---|
| `backend/` | FastAPI + uvicorn；PyInstaller 打包 exe（内置前端 dist，同源托管） |
| `frontend/` | React 19 + Vite + Tailwind CSS 4 + shadcn 系组件 |
| `desktop/` | Electron 壳 + electron-builder 打包配置 |

## 🚀 快速启动

### 开发模式

```bash
# 1. 后端（端口 8000）
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt      # Windows
.venv\Scripts\uvicorn app.main:app --port 8000

# 2. 前端（端口 5173，代理 /api → 8000）
cd frontend
npm install
npm run dev        # http://localhost:5173
```

> 首次使用：右上角「模型设置」填入自己的 LLM API Key（OpenAI 兼容，DeepSeek / Qwen / OpenAI 均可）。

### 桌面版

```bash
cd desktop
npm install
npm run dev        # Electron + Vite dev

node build.mjs                                   # 全量打包：前端 → 后端 exe → NSIS 安装包
node build.mjs --skip-frontend --skip-backend    # 只重打 Electron 壳
```

产物：`desktop/release/ChemAgent Setup <ver>.exe`（NSIS 安装包）与 `win-unpacked/`（便携版）。

> 注：安装包未签名，Windows 首次运行会提示 SmartScreen，点「更多信息 → 仍要运行」即可。

## 📊 项目统计

[![Star History Chart](https://api.star-history.com/svg?repos=wangruichuan%2Fchemagent&type=Date)](https://star-history.com/#wangruichuan/ChemAgent&Date)

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/xxx`
3. 提交改动：`git commit -m "feat: ..."`
4. 推送：`git push origin feat/xxx`
5. 发起 Pull Request

## 📄 License

[MIT](./LICENSE) © 2026 [wangruichuan](https://github.com/wangruichuan)
