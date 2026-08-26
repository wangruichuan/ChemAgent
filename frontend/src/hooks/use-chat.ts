import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { DEFAULT_SETTINGS, uid, type ApiSettings, type Artifact, type ChatMessage, type Conversation } from "@/types"

const CONV_KEY = "chat.conversations.v1"
const SETTINGS_KEY = "chat.settings.v1"

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as Conversation[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function loadSettings(): ApiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ApiSettings>) }
    // 迁移：清掉旧默认残留的 deepseek 字样
    if (parsed.model === "deepseek-chat") parsed.model = ""
    if (parsed.baseUrl === "https://api.deepseek.com/v1") parsed.baseUrl = ""
    // 迁移：强度取值集合已改为模型支持的 low/medium/xhigh，兼容旧的 high/max 残留
    const _effort = parsed.reasoningEffort as string
    if (_effort === "high") parsed.reasoningEffort = "medium"
    else if (_effort === "max") parsed.reasoningEffort = "xhigh"
    else if (_effort !== "low" && _effort !== "medium" && _effort !== "xhigh") parsed.reasoningEffort = "xhigh"
    // 迁移：webSearch 字段 → toolsEnabled（旧开关语义升级为"工具调用"）
    const legacy = parsed as ApiSettings & { webSearch?: boolean }
    if (legacy.webSearch !== undefined && parsed.toolsEnabled === undefined) {
      parsed.toolsEnabled = legacy.webSearch
    }
    delete (parsed as Partial<ApiSettings> & { webSearch?: boolean }).webSearch
    // 迁移：工具调用默认常开（用户要求默认开启、UI 不再提供开关）
    parsed.toolsEnabled = true
    // 迁移：深度思考默认常开（UI 不再提供开关）
    parsed.thinking = true
    return parsed
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function newConversation(workspaceId: string): Conversation {
  const now = Date.now()
  return { id: uid(), title: "新任务", messages: [], createdAt: now, updatedAt: now, workspaceId }
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ")
  return t.length > 24 ? t.slice(0, 24) + "…" : t || "新任务"
}

/** 粗略估算 token 数：CJK 字约 1 token/字，其它约 4 字符/token（用于上下文压缩触发判断）。 */
function estimateTokens(s: string): number {
  if (!s) return 0
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const rest = s.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/** 调后端把较早对话压缩成摘要（prior 为既有摘要，合并更新）。 */
async function fetchSummary(
  msgs: { role: string; content: string }[],
  s: ApiSettings,
  prior: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch("/api/chat/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: msgs,
      base_url: s.baseUrl,
      api_key: s.apiKey,
      model: s.model,
      prior_summary: prior ?? null,
    }),
    signal,
  })
  const j = await res.json().catch(() => null)
  if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
  return (j?.summary ?? "") as string
}

/** SSE 事件（与后端约定） */
interface SseEvent {
  type: "delta" | "reasoning" | "usage" | "done" | "error" | "tool_call" | "tool_result" | "stats" | "kb_hits"
  content?: string
  message?: string
  name?: string
  arguments?: Record<string, unknown>
  ok?: boolean
  model?: string
  duration_ms?: number
  completion_tokens?: number
  tool_calls?: number
  hits?: { filename: string; content: string; score: number }[]
}

export function useChat(workspaceId: string) {
  const [allConversations, setAllConversations] = useState<Conversation[]>(loadConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settings, setSettings] = useState<ApiSettings>(loadSettings)
  const [isStreaming, setIsStreaming] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 自动打开信号：write_file 成功产生 HTML 时置位，nonce 递增以支持同一文件重复触发 */
  const [autoOpen, setAutoOpen] = useState<{ path: string; nonce: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** 待确认的 HTML write_file 路径：tool_call 收集，tool_result 成功后触发打开 */
  const pendingHtmlRef = useRef<string[]>([])

  // 当前工作区可见的会话（按 workspaceId 隔离；"" = 普通任务/无工作区）
  const conversations = useMemo(
    () => allConversations.filter((c) => (c.workspaceId ?? "") === workspaceId),
    [allConversations, workspaceId]
  )

  // 确保当前工作区始终有激活会话；切换工作区时切到该工作区第一条，或新建
  useEffect(() => {
    if (conversations.length === 0) {
      const conv = newConversation(workspaceId)
      setAllConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
    } else if (!activeId || !conversations.some((c) => c.id === activeId)) {
      setActiveId(conversations[0].id)
    }
  }, [conversations, activeId, workspaceId])

  // 持久化（存全量，跨工作区共享存储）
  useEffect(() => {
    localStorage.setItem(CONV_KEY, JSON.stringify(allConversations))
  }, [allConversations])
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setAllConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)))
  }, [])

  /** 记录一个产物（write_file 产生）：按 path 去重，重复则刷新时间 */
  const upsertArtifact = useCallback((id: string, path: string) => {
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path
    setAllConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const arts = c.artifacts ?? []
        const idx = arts.findIndex((a) => a.path === path)
        const next: Artifact[] =
          idx >= 0
            ? arts.map((a, i) => (i === idx ? { ...a, updatedAt: Date.now() } : a))
            : [...arts, { path, name, updatedAt: Date.now() }]
        return { ...c, artifacts: next, updatedAt: Date.now() }
      })
    )
  }, [])

  const createConversation = useCallback(() => {
    const conv = newConversation(workspaceId)
    setAllConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    return conv.id
  }, [workspaceId])

  const deleteConversation = useCallback((id: string) => {
    setAllConversations((prev) => prev.filter((c) => c.id !== id))
  }, [])

  /** 一键清空当前工作区的任务（另建一条当前工作区的空会话） */
  const clearAllConversations = useCallback(() => {
    const conv = newConversation(workspaceId)
    setAllConversations((prev) => [conv, ...prev.filter((c) => (c.workspaceId ?? "") !== workspaceId)])
    setActiveId(conv.id)
  }, [workspaceId])

  const renameConversation = useCallback((id: string, title: string) => {
    updateConversation(id, (c) => ({ ...c, title: title.trim() || c.title }))
  }, [updateConversation])

  /** 置顶 / 取消置顶 */
  const togglePin = useCallback((id: string) => {
    updateConversation(id, (c) => ({ ...c, pinned: !c.pinned, updatedAt: Date.now() }))
  }, [updateConversation])

  const clearAllMessages = useCallback((id: string) => {
    updateConversation(id, (c) => ({ ...c, messages: [], title: "新任务", updatedAt: Date.now() }))
  }, [updateConversation])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || isStreaming) return
      const convId = activeId ?? createConversation()

      const userMsg: ChatMessage = { id: uid(), role: "user", content, createdAt: Date.now() }
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "", createdAt: Date.now() }

      setError(null)

      // 先落库用户消息 + 空的 assistant 占位
      setAllConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [...c.messages, userMsg, assistantMsg],
                title: c.messages.length === 0 ? titleFrom(content) : c.title,
                updatedAt: Date.now(),
              }
            : c
        )
      )

      // 组装上下文（含上下文压缩）
      const conv = conversations.find((c) => c.id === convId)
      const full = (conv?.messages ?? []).filter((m) => !m.error && m.content)
      const keep = settings.keepRecent ?? 8
      const threshold = settings.compressThreshold ?? 12000
      let compacted = conv?.compactedCount ?? 0
      let summaryText = conv?.summary

      setIsStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller

      // 上下文超长 → 把较早轮次压缩成摘要；失败不阻塞主流程，退回完整历史
      const compactEnd = full.length - keep
      if (
        settings.autoCompress &&
        estimateTokens(full.map((m) => m.content).join("\n") + "\n" + content) > threshold &&
        compactEnd - compacted >= 2
      ) {
        setCompressing(true)
        try {
          const toCompress = full.slice(compacted, compactEnd).map((m) => ({ role: m.role, content: m.content }))
          if (toCompress.length) {
            const s = await fetchSummary(toCompress, settings, summaryText, controller.signal)
            if (s) {
              summaryText = s
              compacted = compactEnd
              updateConversation(convId, (c) => ({
                ...c,
                summary: s,
                compactedCount: compacted,
                updatedAt: Date.now(),
              }))
            }
          }
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError")) {
            console.warn("上下文压缩失败，改用完整历史：", e)
          }
        } finally {
          setCompressing(false)
        }
      }

      const recent = full.slice(compacted).map((m) => ({ role: m.role, content: m.content }))
      const payloadMessages = [
        ...(settings.systemPrompt.trim() ? [{ role: "system", content: settings.systemPrompt.trim() }] : []),
        ...(summaryText
          ? [{ role: "system", content: `以下是此前对话的压缩摘要，仅供你理解上下文，不要向用户复述本摘要：\n${summaryText}` }]
          : []),
        ...recent,
        { role: "user", content },
      ]

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payloadMessages,
            base_url: settings.baseUrl,
            api_key: settings.apiKey,
            model: settings.model,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            thinking: settings.thinking,
            tools: settings.toolsEnabled,
            use_kb: settings.useKb,
          }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          let detail = `HTTP ${res.status}`
          try {
            const j = await res.json()
            if (j?.detail) detail = j.detail
          } catch { /* ignore */ }
          throw new Error(detail)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        // 流式追加到 assistant 消息（按时序写入分段）
        const appendDelta = (delta: string) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) => {
                      if (m.id !== assistantMsg.id) return m
                      const segs = m.segments ?? []
                      const last = segs[segs.length - 1]
                      const next: ChatMessage["segments"] = last?.type === "text"
                        ? [...segs.slice(0, -1), { type: "text", content: last.content + delta }]
                        : [...segs, { type: "text", content: delta }]
                      return { ...m, content: m.content + delta, segments: next }
                    }),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }
        const appendReasoning = (delta: string) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, reasoning: (m.reasoning ?? "") + delta }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }
        const appendToolCall = (name: string, args: Record<string, unknown>) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id
                        ? {
                            ...m,
                            toolCalls: [
                              ...(m.toolCalls ?? []),
                              { name, arguments: JSON.stringify(args, null, 2), status: "running" as const },
                            ],
                            segments: [
                              ...(m.segments ?? []),
                              { type: "tool" as const, call: { name, arguments: JSON.stringify(args, null, 2), status: "running" as const } },
                            ],
                          }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }
        const finishToolCall = (name: string, result: string, ok: boolean) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id
                        ? {
                            ...m,
                            toolCalls: (m.toolCalls ?? []).map((tc) =>
                              tc.name === name && tc.status === "running"
                                ? { ...tc, result, ok, status: "done" as const }
                                : tc
                            ),
                            segments: (m.segments ?? []).map((seg) =>
                              seg.type === "tool" && seg.call.name === name && seg.call.status === "running"
                                ? { ...seg, call: { ...seg.call, result, ok, status: "done" as const } }
                                : seg
                            ),
                          }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }
        const appendKbHits = (hits: NonNullable<ChatMessage["kbHits"]>) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id ? { ...m, kbHits: hits } : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }

        const appendStats = (stats: NonNullable<ChatMessage["stats"]>) => {
          setAllConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsg.id ? { ...m, stats } : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          )
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split("\n\n")
          buffer = parts.pop() ?? ""
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith("data:")) continue
            let event: SseEvent
            try {
              event = JSON.parse(line.slice(5).trim()) as SseEvent
            } catch {
              continue
            }
            if (event.type === "delta" && event.content) {
              appendDelta(event.content)
            } else if (event.type === "reasoning" && event.content) {
              appendReasoning(event.content)
            } else if (event.type === "tool_call" && event.name) {
              appendToolCall(event.name, event.arguments ?? {})
              if (event.name === "write_file" && workspaceId !== "") {
                const p = (event.arguments?.path as string) || ""
                if (p) {
                  upsertArtifact(convId, p)
                  // 记录 HTML 产物，待 tool_result 确认写入成功后再主动打开
                  if (/\.html?$/i.test(p)) pendingHtmlRef.current.push(p)
                }
              }
            } else if (event.type === "tool_result" && event.name && event.content) {
              finishToolCall(event.name, event.content, event.ok ?? true)
              // write_file 成功后，若刚写入的是 HTML → 主动在右侧产物区打开
              if (event.name === "write_file") {
                const pending = pendingHtmlRef.current
                pendingHtmlRef.current = []
                if ((event.ok ?? true) && pending.length) {
                  const p = pending[pending.length - 1]
                  setAutoOpen((prev) => ({ path: p, nonce: (prev?.nonce ?? 0) + 1 }))
                }
              }
            } else if (event.type === "kb_hits" && event.hits?.length) {
              appendKbHits(event.hits)
            } else if (event.type === "stats") {
              appendStats({
                model: event.model ?? "",
                durationMs: event.duration_ms ?? 0,
                completionTokens: event.completion_tokens ?? 0,
                toolCalls: event.tool_calls ?? 0,
              })
            } else if (event.type === "error") {
              throw new Error(event.message || "上游返回错误")
            }
          }
        }
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError"
        const msg = aborted ? "（已停止生成）" : e instanceof Error ? e.message : String(e)
        if (!aborted) setError(msg)
        // 把错误写进 assistant 占位消息
        setAllConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id
                      ? m.content
                        ? { ...m, content: m.content + `\n\n> ⚠️ ${msg}`, error: !aborted }
                        : { ...m, content: `> ⚠️ ${msg}`, error: !aborted }
                      : m
                  ),
                }
              : c
          )
        )
      } finally {
        abortRef.current = null
        setIsStreaming(false)
      }
    },
    [activeId, conversations, createConversation, isStreaming, settings, upsertArtifact, workspaceId]
  )

  return {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    settings,
    setSettings,
    isStreaming,
    compressing,
    error,
    autoOpen,
    send,
    stop,
    createConversation,
    deleteConversation,
    clearAllConversations,
    renameConversation,
    togglePin,
    clearAllMessages,
  }
}
