import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, CpuIcon, Loader2Icon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import type { ApiSettings, ChatMessage } from "@/types"

function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) cjk++
    else if (!/\s/.test(ch)) other++
  }
  return Math.ceil(cjk * 1.6 + other * 0.3)
}

interface Props {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  /** 思考阶段（已发送但正文未开始输出） */
  thinking?: boolean
  disabled?: boolean
  settings: ApiSettings
  messages: ChatMessage[]
  /** 更新设置（思考模式/强度） */
  onUpdateSettings: (patch: Partial<ApiSettings>) => void
  /** 打开模型设置（模型芯片点击） */
  onOpenSettings?: () => void
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  thinking,
  disabled,
  settings,
  messages,
  onUpdateSettings,
  onOpenSettings,
}: Props) {
  const [value, setValue] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)
  const t = useT()

  const ctx = settings.contextLength
  const used =
    estimateTokens(settings.systemPrompt) +
    messages.reduce(
      (sum, m) => sum + estimateTokens(m.content) + estimateTokens(m.reasoning ?? ""),
      0
    )
  const pct = ctx ? Math.min(100, (used / ctx) * 100) : 0
  const over = ctx ? used > ctx : false
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n))
  const ctxLabel = ctx ? ` / ${fmtK(ctx)}` : ""
  const ringTitle = ctx
    ? over
      ? `已超出 ${fmtK(used - ctx)} tokens`
      : `${fmtK(used)}${ctxLabel} tokens`
    : `${fmtK(used)} tokens`

  // 自动伸缩
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 240) + "px"
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || isStreaming || disabled) return
    onSend(text)
    setValue("")
    // 发送后立即聚焦，方便连续提问
    requestAnimationFrame(() => ref.current?.focus())
  }

  // 发送按钮左边的小指示：有上下文上限时显示占用百分比，否则显示 token 数
  const ring = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums transition-colors",
        over
          ? "border-red-900/40 bg-red-950/30 text-red-400"
          : ctx
            ? "border-border/70 text-muted-foreground/70"
            : "border-border/70 text-muted-foreground/50"
      )}
      title={ringTitle}
    >
      {ctx ? `${Math.round(pct)}%` : fmtK(used)}
    </span>
  )

  return (
    <div className="rounded-2xl border border-border/80 bg-card/60 shadow-[var(--shadow-md)] backdrop-blur-sm transition-all duration-300 focus-within:border-[var(--jade)]/50 focus-within:bg-card focus-within:shadow-[var(--shadow-lg)] hover:shadow-[var(--shadow-lg)]">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={disabled ? t("input.needKey") : t("input.placeholder")}
        disabled={disabled}
        rows={1}
        className="max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <div className="flex min-w-0 items-center gap-2 pl-1 text-xs">
          {/* 模型芯片：点击打开模型设置（Prompt Bar 模块） */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              disabled={isStreaming}
              title={t("settings.title")}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium leading-none text-muted-foreground transition-colors hover:border-[var(--jade)]/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CpuIcon className="size-3 shrink-0" />
              <span className="max-w-[140px] truncate">{settings.model || t("input.noModel")}</span>
            </button>
          )}
          {/* 知识库检索开关：主动开启时对话才检索知识库 */}
          <button
            onClick={() => onUpdateSettings({ useKb: !settings.useKb })}
            disabled={isStreaming}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              settings.useKb
                ? "border-[var(--jade)]/40 bg-[var(--jade-soft)] text-[var(--jade)]"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            title={t("input.kbTitle")}
          >
            <span
              className={cn(
                "inline-block size-1.5 shrink-0 rounded-full",
                settings.useKb ? "bg-[var(--jade)]" : "bg-muted-foreground/40"
              )}
            />
            {t("input.kbRetrieve")}
          </button>

          <span className="truncate text-muted-foreground/70">
            {isStreaming ? (thinking ? t("msg.thinking") : t("input.generating")) : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {ring}
          {isStreaming ? (
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={onStop}
              title={thinking ? t("input.stopThinking") : t("input.stopGenerating")}
              className="rounded-full"
            >
              {thinking ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <SquareIcon className="size-3.5 fill-current" />
              )}
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!value.trim() || disabled}
              title={t("input.send")}
              className="rounded-full bg-[var(--jade)] text-white transition-all duration-200 hover:scale-110 hover:opacity-90 active:scale-90 active:transition-transform active:duration-75 disabled:scale-100 disabled:opacity-30"
            >
              {disabled ? <Loader2Icon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
