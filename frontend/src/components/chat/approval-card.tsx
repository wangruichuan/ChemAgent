import { CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ApprovalCardProps {
  /** 操作名（如「写入文件」「执行命令」） */
  action: string
  /** 参数预览（可折叠展示） */
  detail?: string
  /** 批准后回调：展示结果 */
  onApprove: () => void
  /** 拒绝后回调：隐藏结果 */
  onReject: () => void
}

/** beautifului.dev #04 Approval Card —— 行动前的人工确认卡（human-in-the-loop）。
 *  这里作为「敏感操作结果查看」的确认闸：批准前遮蔽结果，批准后展开。 */
export function ApprovalCard({ action, detail, onApprove, onReject }: ApprovalCardProps) {
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-[var(--jade)]/25 bg-[var(--jade)]/[0.06] shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-2.5 px-3.5 py-2.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--jade)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-foreground/85">
            需要确认：<span className="text-[var(--jade)]">{action}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
            该操作已执行，涉及工作区写入或命令运行。是否查看其结果？
          </p>
          {detail && detail.trim() && (
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-border/60 bg-background/50 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground/70">
              {detail}
            </pre>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--jade)]/15 bg-[var(--jade)]/[0.03] px-3 py-2">
        <button
          onClick={onApprove}
          className={cn(
            "flex items-center gap-1.5 rounded-lg bg-[var(--jade)] px-3 py-1.5 text-[11px] font-semibold",
            "text-[#04140c] transition-opacity hover:opacity-90"
          )}
        >
          <CheckIcon className="size-3.5" /> 查看结果
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3.5" /> 隐藏
        </button>
      </div>
    </div>
  )
}
