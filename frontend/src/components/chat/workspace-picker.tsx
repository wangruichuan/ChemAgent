import { useEffect, useRef, useState } from "react"
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, FolderXIcon, Loader2Icon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Workspace, WorkspaceState } from "@/hooks/use-workspace"

interface Props {
  ws: WorkspaceState | null
  loading: boolean
  error: string | null
  onSwitch: (id: string) => void
  onNone: () => void
  onAdd: (name: string, root: string) => void
  /** 弹系统目录选择器，返回所选绝对路径（取消返回 null） */
  onPick: () => Promise<string | null>
}

/** 工作区切换器：显示当前工作区，下拉切换 / 新增（目录即 agent 本地工具的锚点）。 */
export function WorkspacePicker({ ws, loading, error, onSwitch, onNone, onAdd, onPick }: Props) {
  const currentWs: Workspace | null = ws?.workspaces.find((w) => w.id === ws.current) ?? null
  const isNone = !ws || ws.current === ""
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [root, setRoot] = useState("")
  const [picking, setPicking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const doAdd = () => {
    if (!root.trim()) return
    onAdd(name.trim(), root.trim())
    setName("")
    setRoot("")
  }

  const doPick = async () => {
    if (picking) return
    setPicking(true)
    try {
      const p = await onPick()
      if (p) setRoot(p)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={isNone ? "无工作区（不限定目录）" : (currentWs?.root ?? "选择工作区")}
        className="flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <FolderIcon className="size-3.5 shrink-0 text-[var(--jade)]" />
        <span className="truncate font-medium">{isNone ? "无工作区" : (currentWs?.name ?? "工作区")}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border bg-card p-2 shadow-[var(--shadow-md)]">
          <p className="px-1.5 pb-1.5 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            工作区（本地工具锚点）
          </p>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                onNone()
                setOpen(false)
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                isNone ? "bg-[var(--jade-soft)]" : "hover:bg-muted"
              )}
            >
              <FolderXIcon
                className={cn("size-3.5 shrink-0", isNone ? "text-[var(--jade)]" : "text-muted-foreground/50")}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">无工作区</span>
                <span className="block truncate text-[10px] text-muted-foreground/60">
                  不限定目录（工具基于绝对路径）
                </span>
              </span>
              {isNone && <CheckIcon className="size-3.5 shrink-0 text-[var(--jade)]" />}
            </button>
            {(ws?.workspaces ?? []).map((w) => {
              const active = w.id === currentWs?.id
              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    onSwitch(w.id)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-[var(--jade-soft)]" : "hover:bg-muted"
                  )}
                >
                  <FolderIcon
                    className={cn("size-3.5 shrink-0", active ? "text-[var(--jade)]" : "text-muted-foreground/50")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{w.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground/60">{w.root}</span>
                  </span>
                  {active && <CheckIcon className="size-3.5 shrink-0 text-[var(--jade)]" />}
                </button>
              )
            })}
          </div>

          <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
            <p className="flex items-center gap-1 px-0.5 text-[10px] font-medium text-muted-foreground/70">
              <FolderPlusIcon className="size-3" /> 新增工作区
            </p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名称（如：乙醇-丙酮催化）"
              className="h-7 text-xs"
            />
            <div className="flex items-center gap-1.5">
              <Input
                value={root}
                readOnly
                placeholder="未选择目录"
                className="h-7 flex-1 truncate text-xs"
              />
              <Button onClick={doPick} disabled={picking} variant="outline" size="sm" className="shrink-0 gap-1">
                {picking ? <Loader2Icon className="size-3.5 animate-spin" /> : <FolderOpenIcon className="size-3.5" />}
                选择目录
              </Button>
            </div>
            {error && <p className="px-0.5 text-[10px] text-destructive">{error}</p>}
            <Button onClick={doAdd} disabled={loading || !root.trim()} variant="outline" size="sm" className="w-full">
              {loading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              添加并切换
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
