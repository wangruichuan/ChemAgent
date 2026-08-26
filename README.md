# ChemAgent Chat

类 DeepSeek / ChatGPT 的 AI 对话界面。后端 Python（FastAPI），前端 React + shadcn/ui，支持流式输出与 Markdown 渲染，可对接任意 OpenAI 兼容 API。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + uvicorn + openai SDK（异步） |
| 前端 | Vite + React 19 + TypeScript |
| UI | shadcn/ui（Radix）+ Tailwind CSS v4 + lucide-react |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| 流式 | SSE（fetch + ReadableStream 逐 token 渲染） |

## 快速启动

### 1. 后端（端口 8000）

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\pip install -r requirements.txt
# macOS / Linux
# .venv/bin/pip install -r requirements.txt

# 可选：复制 .env.example 为 .env 设置默认 API（也可全部在前端设置面板配置）
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

### 2. 前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173

### 3. 配置模型

点左下角「设置」：

- **API Base URL**：任意 OpenAI 兼容端点，如 `https://api.deepseek.com/v1`
- **API Key**：对应服务商密钥（仅存本地浏览器，经本地后端代理转发）
- **模型名称**：可手填，或点「获取列表」拉取 `/v1/models`
- 内置预设：DeepSeek / Kimi / 通义千问 / 智谱 GLM / OpenAI / Ollama / vLLM

## 功能

- 多会话管理：新建 / 重命名 / 删除 / 按时间分组，localStorage 持久化
- 流式输出：SSE 逐 token 渲染，可随时停止生成
- Markdown：GFM 表格、代码块高亮 + 复制按钮、公式内联代码
- 自定义 API：Base URL / Key / 模型 / Temperature / Max Tokens / System Prompt
- 请求失败时错误回写进对话气泡，便于排查
- 暗色主题 UI

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/chat` | SSE 流式对话代理（body 内携带 base_url/api_key/model） |
| POST | `/api/models` | 拉取上游模型列表 |
| GET | `/api/health` | 健康检查 |

## 目录结构

```
backend/
  app/
    main.py          # FastAPI 入口 + CORS
    config.py        # 配置（.env 可覆盖）
    models.py        # Pydantic schema
    routers/chat.py  # SSE 流式代理 + 模型列表
frontend/
  src/
    components/chat/ # sidebar / chat-message / chat-input / markdown / settings-dialog
    components/ui/   # shadcn 组件
    hooks/use-chat.ts # 会话状态 + 流式 SSE 解析
```
