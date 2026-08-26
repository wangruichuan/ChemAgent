import { useEffect, useRef, useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon, FileSearchIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"

import { ChemBot } from "@/components/chembot"
import { ToolCallCard } from "@/components/chat/tool-call-card"
import { SelectionActionsPopover, type SelectionAction } from "@/components/chat/selection-actions"
import { RichContent } from "@/components/chat/chemvision-embed"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

interface Props {
  message: ChatMessage
  streaming?: boolean
  onRetry?: () => void
}

/** 知识库引用卡片：编号"参考来源"列表；监听行内引用 chip 派发的 kb-cite 事件，
 *  被点击的对应来源会展开并高亮、滚动到可视区。 */
function KbHitsCard({
  hits,
  msgId,
}: {
  hits: NonNullable<import("@/types").ChatMessage["kbHits"]>
  msgId: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 行内引用 chip 点击 → 展开本卡片、高亮并定位到对应编号来源（用 msgId 作作用域，避免串到别的消息）
  useEffect(() => {
    const onCite = (e: Event) => {
      const d = (e as CustomEvent).detail as { n: number; msgId: string } | undefined
      if (!d || d.msgId !== msgId) return
      const idx = d.n - 1
      if (idx < 0 || idx >= hits.length) return
      setOpen(true)
      setActive(d.n)
      requestAnimationFrame(() => {
        listRef.current?.querySelector(`[data-src="${d.n}"]`)?.scrollIntoView({ block: "nearest" })
      })
    }
    document.addEventListener("kb-cite", onCite)
    return () => document.removeEventListener("kb-cite", onCite)
  }, [msgId, hits.length])

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[var(--jade)]/25 bg-[var(--jade-soft)]/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
      >
        <FileSearchIcon className="size-3.5 shrink-0 text-[var(--jade)]" />
        <span className="text-xs font-medium text-foreground/80">参考来源 {hits.length} 条</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
          {open ? "收起" : "点击展开"}
        </span>
      </button>
      {open && (
        <div ref={listRef} className="max-h-64 divide-y divide-border/50 overflow-y-auto border-t border-border/50">
          {hits.map((h, i) => {
            const n = i + 1
            const on = active === n
            return (
              <div
                key={n}
                data-src={n}
                className={cn("px-3 py-2.5 transition-colors", on && "bg-[var(--jade-soft)]/50")}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-[var(--jade)]/40 bg-[var(--jade-soft)]/60 font-mono text-[9px] text-[var(--jade)]">
                    {n}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/80">
                    {h.filename}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px font-mono text-[9px] text-muted-foreground/60">
                    相似度 {(h.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground/70">
                  {h.content}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


/** 深度思考过程（AI-native Thinking 模块）：默认折叠为状态条，可展开查看完整推理轨迹 */
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming?: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  const [open, setOpen] = useState(false)
  const startRef = useRef<number | null>(null)

  // 流式计时：记录开始时刻，结束用真实耗时
  useEffect(() => {
    if (streaming) {
      startRef.current = startRef.current ?? Date.now()
      setElapsed(Math.round((Date.now() - startRef.current) / 1000))
      const t = setInterval(
        () => setElapsed(Math.round((Date.now() - (startRef.current ?? Date.now())) / 1000)),
        1000
      )
      return () => clearInterval(t)
    }
    // 结束时：用真实耗时兜底（若计时器已停）
    setElapsed((s) => (startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : s))
  }, [streaming])

  const thinking = streaming && !reasoning.trim()
  const seconds = elapsed || Math.max(1, Math.round(reasoning.length / 200))
  const canExpand = !thinking && reasoning.trim().length > 0

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[var(--jade)]/20 bg-[var(--jade)]/[0.05]">
      <button
        onClick={() => canExpand && setOpen((v) => !v)}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors " +
          (canExpand ? "cursor-pointer hover:bg-[var(--jade)]/10" : "cursor-default")
        }
      >
        <SparklesIcon className="size-3.5 shrink-0 text-[var(--jade)]" />
        {thinking ? (
          <>
            <span className="text-xs font-medium text-muted-foreground">正在思考…</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
              <span className="size-1.5 animate-pulse rounded-full bg-[var(--jade)]" />
              已 {seconds.toFixed(0)}s
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-medium text-foreground/80">深度思考</span>
            <span className="text-[11px] text-muted-foreground/50">耗时 {seconds.toFixed(1)}s</span>
            {canExpand && (
              <ChevronRightIcon
                className={
                  "ml-auto size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 " +
                  (open ? "rotate-90" : "")
                }
              />
            )}
          </>
        )}
      </button>
      {open && canExpand && (
        <div className="trace-in border-t border-[var(--jade)]/15 px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-muted-foreground/85">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  )
}

export function ChatMessageItem({ message, streaming, onRetry }: Props) {
  const [copied, setCopied] = useState(false)
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  const isUser = message.role === "user"

  // 选中文本 → 浮现 Selection Actions 浮动菜单
  const handleMouseUp = () => {
    const s = window.getSelection()
    if (!s || s.isCollapsed) { setSel(null); return }
    const text = s.toString().trim()
    if (text.length < 4) { setSel(null); return }
    const range = s.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { setSel(null); return }
    setSel({ text, x: rect.left + rect.width / 2, y: rect.top - 8 })
  }

  const handlePick = (action: SelectionAction, text: string) => {
    document.dispatchEvent(new CustomEvent("chem-selection-action", { detail: { action, text } }))
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }

  // 滚动时收起浮动菜单（避免错位）
  useEffect(() => {
    if (!sel) return
    const clear = () => setSel(null)
    window.addEventListener("scroll", clear, true)
    return () => window.removeEventListener("scroll", clear, true)
  }, [sel])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isUser) {
    return (
      <div className="group flex flex-col items-end msg-in" onMouseUp={handleMouseUp}>
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[var(--jade)]/20 bg-[var(--jade)]/[0.10] px-4 py-2.5 text-left text-[15px] leading-7 text-foreground shadow-[var(--shadow-sm)]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {sel && (
          <SelectionActionsPopover x={sel.x} y={sel.y} text={sel.text} onPick={handlePick} />
        )}
      </div>
    )
  }

  return (
    <div className="group flex gap-3.5 msg-in" data-kb-msg={message.id} onMouseUp={handleMouseUp}>
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-[var(--jade)]/20 bg-[var(--jade)]/[0.08] text-[var(--jade)]">
        <ChemBot className="size-7" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="font-display text-[13px] font-semibold tracking-tight text-foreground/90">ChemAgent</span>
          <span className="rounded-full border border-border/60 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/45">
            agent
          </span>
        </div>
        {/* 知识库引用：明确展示本次回答引用了哪些片段（编号，可点行内 〔n〕 联动展开） */}
        {message.kbHits && message.kbHits.length > 0 && (
          <KbHitsCard hits={message.kbHits} msgId={message.id} />
        )}
        {message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} streaming={streaming} />
        )}
        {message.segments && message.segments.length > 0 ? (
          <div className="space-y-2">
            {message.segments.map((seg, i) =>
              seg.type === "text" ? (
                <div key={i} className="md-body text-[15px] leading-7 text-foreground/90">
                  <RichContent content={seg.content} />
                </div>
              ) : (
                <ToolCallCard key={i} call={seg.call} />
              )
            )}
          </div>
        ) : (
        <div className="md-body text-[15px] leading-7 text-foreground/90">
          {message.content ? (
            <RichContent content={message.content} />
          ) : streaming || !message.toolCalls?.length ? (
            <div className="flex items-center gap-1.5 py-2">
              <span className="size-1.5 animate-pulse rounded-full" style={{ background: "var(--jade)" }} />
              <span className="size-1.5 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: "var(--jade)" }} />
              <span className="size-1.5 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: "var(--jade)" }} />
            </div>
          ) : null}
        </div>
        )}
        {!streaming && message.content && (
          <div className="mt-2 flex items-center gap-0.5">
            <button
              onClick={copy}
              title={copied ? "已复制" : "复制"}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            >
              {copied ? <CheckIcon className="size-3" style={{ color: "var(--jade)" }} /> : <CopyIcon className="size-3" />}
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                title="重新生成"
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCwIcon className="size-3" />
              </button>
            )}
          </div>
        )}
        {!streaming && message.stats && (
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/40">
            {(() => {
              const s = message.stats!
              const speed = s.durationMs > 0 && s.completionTokens > 0
                ? (s.completionTokens / (s.durationMs / 1000)).toFixed(1)
                : "—"
              return (
                <>
                  <span>耗时 {(s.durationMs / 1000).toFixed(1)}s</span>
                  <span>生成 {s.completionTokens} tokens</span>
                  <span>速度 {speed} tok/s</span>
                  {s.toolCalls > 0 && <span>工具 {s.toolCalls} 次</span>}
                </>
              )
            })()}
          </div>
        )}
      </div>
      {sel && (
        <SelectionActionsPopover x={sel.x} y={sel.y} text={sel.text} onPick={handlePick} />
      )}
    </div>
  )
}
