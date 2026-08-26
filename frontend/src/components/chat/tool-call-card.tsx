import { useState } from "react"
import { CheckIcon, ChevronRightIcon, GlobeIcon, Loader2Icon, TerminalIcon, WrenchIcon, XCircleIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { toolLabel } from "@/lib/tool-names"
import { useT } from "@/lib/i18n"
import type { ToolCallInfo } from "@/types"
import { ApprovalCard } from "@/components/chat/approval-card"

/** 需要人工确认闸的「敏感操作」工具：已执行但结果默认遮蔽，需用户确认才展示 */
const GATED_TOOLS = new Set(["write_file", "run_command"])

/** 工具图标：按工具名选一个合适的 */
function ToolIcon({ name }: { name: string }) {
  const Icon = name === "web_search" ? GlobeIcon : name === "run_command" ? TerminalIcon : WrenchIcon
  return <Icon className="size-3.5 shrink-0 text-[var(--jade)]" />
}

/** 工具调用卡片：单次调用展示（参数 + 结果），可折叠 */
export function ToolCallCard({ call }: { call: ToolCallInfo }) {
  const t = useT()
  const gated = GATED_TOOLS.has(call.name)
  const [open, setOpen] = useState(false)
  const [approved, setApproved] = useState(!gated)
  const [rejected, setRejected] = useState(false)
  const running = call.status === "running"
  const failed = !running && call.ok === false

  const pendingApproval = gated && !running && !approved && !rejected

  /** 解析结果 JSON，返回展示摘要 */
  const summarize = (result: string): { title: string; failed: boolean } => {
    try {
      const parsed = JSON.parse(result)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0]
        if (first && typeof first === "object" && "error" in first) {
          return { title: String(first.error), failed: true }
        }
        return { title: t("tool.nResults").replace("{count}", String(parsed.length)), failed: false }
      }
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        return { title: String(parsed.error), failed: true }
      }
      if (parsed && typeof parsed === "object" && "exit_code" in parsed) {
        return {
          title: t("tool.exitCode")
            .replace("{code}", String(parsed.exit_code))
            .replace("{out}", String(parsed.stdout ?? "").slice(0, 60) || t("tool.noOutput")),
          failed: parsed.exit_code !== 0,
        }
      }
    } catch { /* 非 JSON */ }
    return { title: result.slice(0, 80), failed: false }
  }

  // 待确认：渲染 Approval Card（human-in-the-loop 确认闸）
  if (pendingApproval) {
    return (
      <ApprovalCard
        action={toolLabel(call.name)}
        detail={call.arguments}
        onApprove={() => {
          setApproved(true)
          setOpen(true)
        }}
        onReject={() => setRejected(true)}
      />
    )
  }

  // 已拒绝：紧凑的隐藏态
  if (rejected) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground/60">
        <XIcon className="size-3.5 shrink-0 text-red-400/80" />
        {t("tool.hiddenResult").replace("{op}", toolLabel(call.name))}
      </div>
    )
  }

  let title = ""
  if (call.status === "done" && call.result) {
    const s = summarize(call.result)
    title = s.title
  }

  return (
    <div
      className={cn(
        "mb-2 overflow-hidden rounded-[4px] border bg-muted/30",
        failed ? "border-red-900/40" : "border-border/80"
      )}
    >
      <button
        onClick={() => !running && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left",
          running ? "cursor-default" : "cursor-pointer"
        )}
      >
        {running ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-[var(--jade)]" />
        ) : failed ? (
          <XCircleIcon className="size-3.5 shrink-0 text-red-400" />
        ) : (
          <ToolIcon name={call.name} />
        )}
        <span className="shrink-0 text-[11px] font-medium text-foreground/80">{toolLabel(call.name)}</span>
        {title && !running && (
          <span className={cn("truncate text-[11px]", failed ? "text-red-400/70" : "text-muted-foreground/60")}>
            {title}
          </span>
        )}
        {running && <span className="text-[11px] text-muted-foreground/50">{t("tool.running")}</span>}
        {!running && (
          <ChevronRightIcon
            className={cn(
              "ml-auto size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200",
              open && "rotate-90"
            )}
          />
        )}
      </button>

      {!running && open && (
        <div className="border-t border-border/60 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed">
          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/50">
            {t("tool.params")}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-foreground/70">
            {call.arguments || "{}"}
          </pre>
          <div className="mt-2.5 mb-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/50">
            <CheckIcon className="size-3" />
            {t("tool.result")}
          </div>
          <pre
            className={cn(
              "max-h-48 overflow-auto whitespace-pre-wrap break-words",
              failed ? "text-red-400/80" : "text-foreground/70"
            )}
          >
            {call.result || t("tool.empty")}
          </pre>
        </div>
      )}
    </div>
  )
}
