import { useEffect, useRef, useState } from "react"
import {
  BoxIcon,
  ChevronLeftIcon,
  CopyIcon,
  DownloadIcon,
  FileCode2Icon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  Loader2Icon,
  PlayIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/chat/markdown"
import { cn } from "@/lib/utils"
import type { Artifact } from "@/types"

interface PreviewMeta {
  name: string
  path: string
  size: number
  mime: string
  mode: "text" | "markdown" | "image" | "html" | "binary"
  content?: string
  url?: string
}
interface ExecResult {
  exit_code: number
  stdout: string
  stderr: string
}

const _RUNNABLE = /\.(py|js|mjs|cjs|sh)$/i
const _PANEL_WIDTH_KEY = "chemagent-artifact-panel-width"

function iconFor(name: string): LucideIcon {
  const ext = (name.split(".").pop() || "").toLowerCase()
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext)) return ImageIcon
  if (["json", "csv", "xml", "yml", "yaml", "toml", "ipynb"].includes(ext)) return FileJsonIcon
  if (["md", "txt", "log", "rst", "tex", "html", "htm"].includes(ext)) return FileTextIcon
  if (["py", "js", "ts", "tsx", "jsx", "mjs", "cjs", "go", "rs", "java", "c", "cpp", "sh", "bat", "css", "sql"].includes(ext))
    return FileCode2Icon
  return FileIcon
}

export function ArtifactPanel({
  artifacts,
  autoOpen,
  onClose,
}: {
  artifacts: Artifact[]
  /** 外部触发自动打开：{path, nonce}；nonce 变化即打开/刷新对应产物详情 */
  autoOpen?: { path: string; nonce: number } | null
  onClose: () => void
}) {
  const [active, setActive] = useState<Artifact | null>(null)
  const [meta, setMeta] = useState<PreviewMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exec, setExec] = useState<ExecResult | null>(null)
  const [running, setRunning] = useState(false)

  // 拖拽调宽：width 为 null 时用默认 class 宽度，拖动后切换为内联 px
  // 宽度持久化到 localStorage，关掉面板再打开不重置
  const [width, setWidth] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(_PANEL_WIDTH_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  })
  const [dragging, setDragging] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const dragRef = useRef({ startX: 0, startWidth: 0 })

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = asideRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { startX: e.clientX, startWidth: rect.width }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    const min = 280
    const max = Math.min(window.innerWidth * 0.7, 900)
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - dragRef.current.startX
      // 手柄在左边缘：向左拖（delta<0）应加宽 → 用 startWidth - delta
      setWidth(Math.max(min, Math.min(max, dragRef.current.startWidth - delta)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [dragging])

  // 宽度变化持久化
  useEffect(() => {
    if (width != null) localStorage.setItem(_PANEL_WIDTH_KEY, String(width))
  }, [width])


  const load = async (a: Artifact) => {
    setActive(a)
    setMeta(null)
    setExec(null)
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/workspace/preview?path=${encodeURIComponent(a.path)}`)
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.detail ?? `HTTP ${res.status}`)
      }
      setMeta((await res.json()) as PreviewMeta)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // 外部触发自动打开（如 write_file 产生 HTML）：切到该产物详情
  useEffect(() => {
    if (!autoOpen) return
    const a = artifacts.find((x) => x.path === autoOpen.path)
    if (a) load(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen?.nonce])

  const run = async () => {
    if (!active) return
    setRunning(true)
    setExec(null)
    setError(null)
    try {
      const res = await fetch("/api/workspace/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: active.path }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
      setExec(j as ExecResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const reveal = async () => {
    if (!active) return
    try {
      await fetch("/api/workspace/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: active.path }),
      })
    } catch {
      /* 忽略打开失败 */
    }
  }

  const download = () => {
    if (!active) return
    window.open(`/api/workspace/raw?path=${encodeURIComponent(active.path)}&download=1`, "_blank")
  }

  const copyPath = async () => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.path)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  const canRun = !!active && _RUNNABLE.test(active.name)

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-md)]"
      style={width != null ? { width } : undefined}
    >
      {/* 拖拽调宽手柄 */}
      <div
        onMouseDown={onResizeStart}
        title="拖拽调整宽度"
        className="group absolute top-0 -left-1.5 z-20 flex h-full w-3 cursor-col-resize items-center justify-center"
      >
        <div
          className={
            "h-8 w-1 rounded-full bg-border transition-colors " +
            (dragging ? "bg-[var(--jade)]" : "group-hover:bg-[var(--jade)]/60")
          }
        />
      </div>
      {/* 拖动遮罩：盖住 iframe 防止其吞掉鼠标事件 */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      {/* 头部 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <BoxIcon className="size-4 shrink-0 text-[var(--jade)]" />
        <span className="text-xs font-medium">产物</span>
        <span className="rounded border border-border/60 px-1 font-mono text-[9px] text-muted-foreground/50">
          {artifacts.length}
        </span>
        <button
          onClick={onClose}
          title="收起产物面板"
          className="ml-auto cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* 详情子头部 */}
      {active && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          <button
            onClick={() => setActive(null)}
            title="返回产物列表"
            className="cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          {(() => {
            const Icon = iconFor(active.name)
            return <Icon className="size-3.5 shrink-0 text-[var(--jade)]" />
          })()}
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={active.path}>
            {active.name}
          </span>
          <button
            onClick={download}
            title="下载"
            className="ml-1 cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <DownloadIcon className="size-3.5" />
          </button>
          <button
            onClick={reveal}
            title="打开所在目录"
            className="cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <FolderOpenIcon className="size-3.5" />
          </button>
          <button
            onClick={copyPath}
            title="复制路径"
            className="cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <CopyIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* 正文 */}
      {!active ? (
        artifacts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-5 text-center text-[11px] leading-relaxed text-muted-foreground/50">
            本次暂无产物
            <br />
            agent 通过 write_file 生成的文件会出现在这里
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {artifacts
              .slice()
              .reverse()
              .map((a) => {
                const Icon = iconFor(a.name)
                return (
                  <button
                    key={a.path}
                    onClick={() => load(a)}
                    className="mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <Icon className="size-4 shrink-0 text-[var(--jade)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{a.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground/50">{a.path}</span>
                    </span>
                  </button>
                )
              })}
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 工具栏 */}
          {canRun && (
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
              <Button size="sm" variant="outline" onClick={run} disabled={running} className="h-7 gap-1 text-xs">
                {running ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
                运行
              </Button>
            </div>
          )}

          {/* 预览区 */}
          <div className="min-h-0 flex-1 overflow-auto bg-muted/10">
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground/50">
                <Loader2Icon className="size-4 animate-spin" />
              </div>
            ) : error ? (
              <div className="p-3 text-xs text-destructive">{error}</div>
            ) : meta ? (
              meta.mode === "text" ? (
                <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">{meta.content}</pre>
              ) : meta.mode === "markdown" ? (
                <div className="p-3 text-sm leading-relaxed">
                  <Markdown content={meta.content ?? ""} />
                </div>
              ) : meta.mode === "image" ? (
                <div className="flex items-center justify-center p-3">
                  <img src={meta.url} alt={meta.name} className="max-h-full max-w-full object-contain" />
                </div>
              ) : meta.mode === "html" ? (
                <iframe src={meta.url} title={meta.name} className="h-full min-h-[420px] w-full border-0 bg-white" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground/60">
                  <FileIcon className="size-6 opacity-50" />
                  该类型暂不支持预览
                  <span className="text-[10px]">可「下载」或「打开」在文件位置查看</span>
                </div>
              )
            ) : null}
          </div>

          {/* 执行输出 */}
          {exec && (
            <div className="max-h-56 shrink-0 overflow-auto border-t bg-[var(--md-pre-bg)] p-3 font-mono text-[11px] leading-relaxed">
              <div className="mb-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <span>执行输出</span>
                <span className={cn("rounded px-1", exec.exit_code === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}>
                  exit {exec.exit_code}
                </span>
              </div>
              {exec.stdout && <pre className="whitespace-pre-wrap break-words text-foreground/90">{exec.stdout}</pre>}
              {exec.stderr && (
                <pre className="whitespace-pre-wrap break-words text-red-400/90">{exec.stderr}</pre>
              )}
              {!exec.stdout && !exec.stderr && <span className="text-muted-foreground/50">（无输出）</span>}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
