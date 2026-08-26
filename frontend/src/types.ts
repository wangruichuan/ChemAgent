export type Role = "user" | "assistant" | "system"

export interface ToolCallInfo {
  name: string
  arguments: string
  /** 工具执行结果 */
  result?: string
  ok?: boolean
  status: "running" | "done"
}

/** 消息内的渲染分段：文本与工具调用按真实时序交错 */
export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "tool"; call: ToolCallInfo }

/** 知识库命中的引用片段 */
export interface KbHit {
  filename: string
  content: string
  score: number
}

/** 一次生成的统计信息（后端 stats 事件） */
export interface GenerationStats {
  model: string
  durationMs: number
  completionTokens: number
  toolCalls: number
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  error?: boolean
  /** DeepSeek-R1 等模型的思考过程 */
  reasoning?: string
  /** 工具调用记录（assistant 消息上） */
  toolCalls?: ToolCallInfo[]
  /** 渲染分段（文本与工具调用按时序交错；有则优先于 toolCalls/content 渲染） */
  segments?: MessageSegment[]
  /** 生成统计（assistant 消息上，由后端 stats 事件写入） */
  stats?: GenerationStats
  /** 本次回答引用的知识库片段（assistant 消息上，由后端 kb_hits 事件写入） */
  kbHits?: KbHit[]
}

/** 本次会话诞生的产物（agent 通过 write_file 在工作区创建/改写的文件） */
export interface Artifact {
  /** 传给后端端点的路径（write_file 的 arguments.path，相对工作区或绝对） */
  path: string
  /** 展示用文件名（basename） */
  name: string
  updatedAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  /** 置顶 */
  pinned?: boolean
  /** 所属工作区 id（"" 或 undefined = 普通任务，无工作区） */
  workspaceId?: string
  /** 本会话产物（仅有工作区任务会积累） */
  artifacts?: Artifact[]
  /** 上下文压缩：较早轮次折叠成的摘要（发送时作为 system 上下文注入） */
  summary?: string
  /** 上下文压缩：已被摘要覆盖的前置消息条数（messages 前 N 条已折叠） */
  compactedCount?: number
}

export type ReasoningEffort = "low" | "medium" | "xhigh"

export interface ApiSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  contextLength?: number
  /** 思考模式（DeepSeek V4 等） */
  thinking: boolean
  reasoningEffort: ReasoningEffort
  /** 工具调用（web_search / skills / run_command 等） */
  toolsEnabled: boolean
  /** 知识库 RAG：对话时检索本地知识库并注入上下文（嵌入模型由后端配置） */
  useKb: boolean
  /** 上下文压缩：上下文超过阈值时，自动把较早轮次压缩成摘要 */
  autoCompress: boolean
  /** 上下文压缩：触发阈值（估算 token 数，超过则压缩较早轮次） */
  compressThreshold: number
  /** 上下文压缩：压缩时保留的最近消息条数（不参与压缩，始终全量发送） */
  keepRecent: number
}

export const DEFAULT_SETTINGS: ApiSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 16384,
  systemPrompt: "",
  contextLength: undefined,
  thinking: true,
  reasoningEffort: "xhigh",
  toolsEnabled: true,
  useKb: false,
  autoCompress: true,
  compressThreshold: 12000,
  keepRecent: 8,
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
