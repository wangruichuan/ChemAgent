import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon, SettingsIcon, SquarePenIcon } from "lucide-react"

import { Logo } from "@/components/logo"

import { ChatInput } from "@/components/chat/chat-input"
import { ChatMessageItem } from "@/components/chat/chat-message"
import { selectionPrompt, type SelectionAction } from "@/components/chat/selection-actions"
import { KnowledgeBasePage } from "@/components/chat/knowledge-base"
import { SettingsDialog } from "@/components/chat/settings-dialog"
import { Sidebar } from "@/components/chat/sidebar"
import { WorkspacePicker } from "@/components/chat/workspace-picker"
import { SkillsPage } from "@/components/chat/skills-page"
import { ArtifactPanel } from "@/components/chat/artifact-panel"
import { Button } from "@/components/ui/button"
import { useChat } from "@/hooks/use-chat"
import { useWorkspace } from "@/hooks/use-workspace"
import { useT } from "@/lib/i18n"

export default function App() {
  const t = useT()
  const workspace = useWorkspace()
  const workspaceId = workspace.ws?.current ?? ""
  const chat = useChat(workspaceId)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePage, setActivePage] = useState<string | null>(null)
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // 主题：默认浅色；切换写入 <html data-theme> 并持久化
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("chemagent.theme") === "dark" ? "dark" : "light"
  )
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark"
      localStorage.setItem("chemagent.theme", next)
      document.documentElement.dataset.theme = next
      return next
    })
  }, [])

  const messages = chat.activeConversation?.messages ?? []
  // 本会话产物（仅有工作区任务会展示面板）
  const artifacts = workspaceId !== "" ? (chat.activeConversation?.artifacts ?? []) : []
  const lastMsg = messages.length ? messages[messages.length - 1] : null
  // 内容 + 思考长度都变化时触发滚动（思考阶段 reasoning 也在增长）
  const lastLen = lastMsg
    ? lastMsg.content.length + (lastMsg.reasoning?.length ?? 0)
    : 0

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, lastLen])

  // 产生 HTML 产物时，主动展开右侧产物面板
  useEffect(() => {
    if (chat.autoOpen) setArtifactPanelOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.autoOpen?.nonce])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Selection Actions：选中助手文本 → 浮动菜单 → 把动作拼成提问发给模型
  useEffect(() => {
    const onAct = (e: Event) => {
      const d = (e as CustomEvent).detail as { action: SelectionAction; text: string }
      if (!d?.text) return
      const prompt = selectionPrompt(d.action, d.text)
      if (prompt.trim()) chat.send(prompt)
    }
    document.addEventListener("chem-selection-action", onAct)
    return () => document.removeEventListener("chem-selection-action", onAct)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  const configured = chat.settings.apiKey.trim().length > 0
  const streamingMessageId =
    chat.isStreaming && messages.length ? messages[messages.length - 1].id : null
  // 思考阶段：流式中且最后一条 assistant 消息还没有正文（只有 reasoning）
  const lastAssistant = messages.length
    ? messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1]
      : null
    : null
  const thinking =
    chat.isStreaming && lastAssistant !== null && !lastAssistant.content && !!lastAssistant.reasoning

  return (
    <div className="relative z-10 flex h-full gap-2 p-2 sm:gap-3 sm:p-3">
      {/* 侧边栏 */}
      <div
        className={
          "transition-[width] duration-200 ease-in-out overflow-hidden rounded-2xl bg-card " +
          (sidebarOpen ? "w-64" : "w-0")
        }
      >
        <Sidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          onSelect={(id) => {
            chat.setActiveId(id)
            setActivePage(null) // 切会话 → 回到对话主界面
          }}
          onNew={() => {
            chat.createConversation()
            setActivePage(null)
          }}
          onDelete={chat.deleteConversation}
          onRename={chat.renameConversation}
          onTogglePin={chat.togglePin}
          onClearAll={chat.clearAllConversations}
          onOpenSettings={() => setSettingsOpen(true)}
          onToolOpen={setActivePage}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>

      {/* 主区域 */}
      {activePage === "skills" ? (
        <SkillsPage onBack={() => setActivePage(null)} />
      ) : activePage === "knowledge" ? (
        <KnowledgeBasePage onBack={() => setActivePage(null)} />
      ) : (
      <main
        key={chat.activeId}
        className="reveal relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-md)]"
      >
        {/* 顶栏 */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? <PanelLeftCloseIcon className="size-4" /> : <PanelLeftOpenIcon className="size-4" />}
          </Button>
          <div className="h-4 w-px shrink-0 bg-border" />
          <WorkspacePicker
            ws={workspace.ws}
            loading={workspace.loading}
            error={workspace.error}
            onSwitch={workspace.switchTo}
            onNone={workspace.setNone}
            onAdd={workspace.addWorkspace}
            onPick={workspace.pickDirectory}
          />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium leading-none">
              {chat.activeConversation?.title ?? "新任务"}
            </span>
            {chat.isStreaming && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--jade)]/25 bg-[var(--jade-soft)] px-2 py-0.5 text-[10px] leading-none text-muted-foreground">
                <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--jade)]" />
                {thinking ? "思考中" : "生成中"}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {workspaceId !== "" && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setArtifactPanelOpen((v) => !v)}
                title={artifactPanelOpen ? "收起产物" : "展开产物"}
                className={artifactPanelOpen ? "text-[var(--jade)]" : undefined}
              >
                <PanelRightIcon className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={chat.createConversation} title="新任务">
              <SquarePenIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="设置">
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </header>

        {/* 消息区 */}
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 pt-28 text-center">
                <div className="reveal opacity-90" style={{ color: "var(--jade)" }}>
                  <div className="animate-float drop-shadow-[0_0_18px_oklch(0.78_0.16_155/0.45)]">
                    <Logo className="size-14" />
                  </div>
                </div>
                <div className="reveal" style={{ animationDelay: "80ms" }}>
                  <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground/95">
                    {t("app.empty.title")}
                  </h1>
                  <p className="mt-3 text-sm text-muted-foreground/70">
                    {t("app.empty.subtitle2")}
                  </p>
                </div>
                {!configured && (
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="reveal mt-2 rounded-full border border-[var(--jade)]/30 bg-[var(--jade)]/10 px-4 py-2 text-sm font-medium text-[var(--jade)] transition-colors hover:bg-[var(--jade)]/20"
                    style={{ animationDelay: "160ms" }}
                  >
                    {t("app.empty.configBtn")}
                  </button>
                )}
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-8">
                {messages.map((m) => (
                  <ChatMessageItem
                    key={m.id}
                    message={m}
                    streaming={m.id === streamingMessageId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              onSend={chat.send}
              onStop={chat.stop}
              isStreaming={chat.isStreaming}
              thinking={thinking}
              disabled={!configured}
              settings={chat.settings}
              messages={messages}
              onUpdateSettings={(patch) => chat.setSettings({ ...chat.settings, ...patch })}
              onOpenSettings={() => setSettingsOpen(true)}
              key={chat.activeId}
            />
            {/* 上下文压缩指示 */}
            {chat.compressing && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--jade)]">
                <Loader2Icon className="size-3 animate-spin" />
                正在压缩上下文…
              </div>
            )}
            {/* 状态栏：会话累计耗时 / 平均速度 / 工具调用 */}
            <div className="mt-2 flex flex-col items-center gap-1 px-1 text-[10px] text-muted-foreground/50">
              <div className="flex items-center justify-center gap-4">
                {(() => {
                  // 聚合当前会话所有 assistant 消息的 stats
                  const statsList = messages
                    .map((m) => m.stats)
                    .filter((s): s is NonNullable<typeof s> => !!s)
                  if (statsList.length === 0) {
                    return null
                  }
                  const totalMs = statsList.reduce((sum, s) => sum + s.durationMs, 0)
                  const totalTokens = statsList.reduce((sum, s) => sum + s.completionTokens, 0)
                  const totalTools = statsList.reduce((sum, s) => sum + s.toolCalls, 0)
                  const speed = totalMs > 0 && totalTokens > 0
                    ? (totalTokens / (totalMs / 1000)).toFixed(1)
                    : "—"
                  return (
                    <>
                      <span>累计 {statsList.length} 轮</span>
                      <span>总耗时 · {(totalMs / 1000).toFixed(1)}s</span>
                      <span>生成 · {totalTokens} tokens</span>
                      <span>平均速度 · {speed} tok/s</span>
                      {totalTools > 0 && <span>工具 · {totalTools} 次</span>}
                    </>
                  )
                })()}
              </div>
              {/* 版权信息 */}
              <a
                href="https://ismcs.cn"
                target="_blank"
                rel="noreferrer noopener"
                className="transition-colors hover:text-muted-foreground"
              >
                © 智能制造与复制系统研究所 · ismcs.cn
              </a>
            </div>
          </div>
        </div>
      </main>
      )}

      {activePage === null && workspaceId !== "" && artifactPanelOpen && (
        <ArtifactPanel
          artifacts={artifacts}
          autoOpen={chat.autoOpen}
          onClose={() => setArtifactPanelOpen(false)}
        />
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={chat.settings}
        onSave={chat.setSettings}
      />
    </div>
  )
}
