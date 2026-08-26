import { FileTextIcon, ListOrderedIcon, RefreshCwIcon, SendIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

export type SelectionAction = "explain" | "rewrite" | "summarize" | "send"

/** 把选中文本 + 动作拼成发给模型的完整提问 */
export function selectionPrompt(action: SelectionAction, text: string): string {
  const t = text.trim()
  switch (action) {
    case "explain":
      return `请解释以下内容：\n\n${t}`
    case "rewrite":
      return `请改写下面这段内容，使其更清晰、准确、专业，保持原意：\n\n${t}`
    case "summarize":
      return `请提炼以下内容的要点，用简洁的列表呈现：\n\n${t}`
    case "send":
    default:
      return t
  }
}

interface Props {
  x: number
  y: number
  text: string
  onPick: (action: SelectionAction, text: string) => void
}

/** beautifului.dev #15 Selection Actions —— 选中文本后浮现的浮动操作条 */
export function SelectionActionsPopover({ x, y, text, onPick }: Props) {
  const t = useT()
  const ACTIONS: { key: SelectionAction; label: string; icon: typeof FileTextIcon }[] = [
    { key: "explain", label: t("sel.explain"), icon: FileTextIcon },
    { key: "rewrite", label: t("sel.rewrite"), icon: RefreshCwIcon },
    { key: "summarize", label: t("sel.summarize"), icon: ListOrderedIcon },
    { key: "send", label: t("sel.sendToAgent"), icon: SendIcon },
  ]
  return (
    <div
      data-sel-actions
      className="fixed z-50 flex items-center gap-0.5 rounded-xl border border-border/70 bg-popover/90 p-1 shadow-[var(--shadow-md)] backdrop-blur-xl"
      style={{ left: x, top: y, transform: "translate(-50%, -100%)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ACTIONS.map((a) => (
        <button
          key={a.key}
          title={a.label}
          onClick={() => onPick(a.key, text)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-foreground"
          )}
        >
          <a.icon className="size-3.5" />
          {a.label}
        </button>
      ))}
    </div>
  )
}
