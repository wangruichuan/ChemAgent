<div align="center">

# ⚗️ ChemAgent

**AI Agent for Chemistry Research**

A local-first AI assistant for chemistry research — chat, tool calling, knowledge base, and a skill system. One codebase, runs in browser and desktop.

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

> 🧪 **A local-first AI Agent built for chemistry research**: not just a chatbot — it calls tools, searches a knowledge base, executes commands, and renders molecular structures.

## ✨ Features

| | Capability | Description |
|---|---|---|
| 💬 | **AI Chat** | Streaming output, expandable reasoning traces, OpenAI-compatible APIs (DeepSeek / Qwen / OpenAI) |
| 🛠️ | **Tool Calling** | File I/O, command execution, chemvision molecular visualization, skill system |
| 📚 | **Knowledge Base** | Document ingestion → LLM cleaning → RAG retrieval with cited sources |
| 🧩 | **Skill Management** | List / detail / translate skill descriptions, extensible custom skills |
| 🗂️ | **Workspaces** | Local directory anchoring, artifact preview / execution / file reveal |
| ✅ | **Human Approval** | Result gate for sensitive actions (write_file / run_command) — Approval Card |
| 📝 | **Selection Actions** | Select text → explain / rewrite / summarize / follow-up |
| 🎨 | **Dual Themes** | Light (default) + dark AI-native mode, one-click toggle with persistence |
| 🖥️ | **Desktop App** | Electron shell + PyInstaller backend exe — no Python / Node required, Windows x64 |

## 🏗️ Architecture

```
┌───────────────┐   HTTP / SSE    ┌────────────────────────┐
│  Frontend     │ ──────────────▶ │  Backend (FastAPI)     │
│  React 19     │     /api/*      │  + uvicorn :8000       │
│  Tailwind 4   │                 │  + tools / KB / skills │
└───────────────┘                 └────────────────────────┘
        ▲
        │  Electron shell (desktop/): spawns backend exe,
        │  preload exposes native capabilities (folder picker, etc.)
```

| Directory | Description |
|---|---|
| `backend/` | FastAPI + uvicorn; PyInstaller builds `chemagent-backend.exe` (bundles frontend dist, same-origin hosting) |
| `frontend/` | React 19 + Vite + Tailwind CSS 4 + shadcn-style components |
| `desktop/` | Electron shell + electron-builder packaging config |

## 🚀 Quick Start

### Development

```bash
# 1. Backend (port 8000)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt      # Windows
.venv\Scripts\uvicorn app.main:app --port 8000

# 2. Frontend (port 5173, proxies /api → 8000)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

> First run: open **Model Settings** (top-right) and enter your own LLM API Key (OpenAI-compatible — DeepSeek / Qwen / OpenAI).

### Desktop App

```bash
cd desktop
npm install
npm run dev        # Electron + Vite dev

node build.mjs                                   # Full build: frontend → backend exe → NSIS installer
node build.mjs --skip-frontend --skip-backend    # Rebuild Electron shell only
```

Output: `desktop/release/ChemAgent Setup <ver>.exe` (NSIS installer) and `win-unpacked/` (portable).

> Note: installer is unsigned — Windows SmartScreen may warn on first run; click **More info → Run anyway**.

## 📊 Project Stats

[![Stars](https://img.shields.io/github/stars/wangruichuan/chemagent?style=for-the-badge&logo=github&color=2e7d5b&labelColor=2e7d5b)](https://github.com/wangruichuan/ChemAgent/stargazers)
[![Forks](https://img.shields.io/github/forks/wangruichuan/chemagent?style=for-the-badge&logo=github&color=2e7d5b&labelColor=2e7d5b)](https://github.com/wangruichuan/ChemAgent/forks)
[![Watchers](https://img.shields.io/github/watchers/wangruichuan/chemagent?style=for-the-badge&logo=github&color=2e7d5b&labelColor=2e7d5b)](https://github.com/wangruichuan/ChemAgent/watchers)
[![Contributors](https://img.shields.io/github/contributors/wangruichuan/chemagent?style=for-the-badge&logo=github&color=2e7d5b&labelColor=2e7d5b)](https://github.com/wangruichuan/ChemAgent/graphs/contributors)

Visit **[wangruichuan/ChemAgent](https://github.com/wangruichuan/ChemAgent)** for the latest stats.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/xxx`
3. Commit your changes: `git commit -m "feat: ..."`
4. Push: `git push origin feat/xxx`
5. Open a Pull Request

## 📄 License

[MIT](./LICENSE) © 2026 [wangruichuan](https://github.com/wangruichuan)
