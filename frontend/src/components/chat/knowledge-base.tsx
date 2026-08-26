import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface DocInfo {
  id: number
  filename: string
  doc_type: string
  status: string
  error: string | null
  progress: string | null
  summary: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

interface Props {
  onBack: () => void
}

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: "排队中", cls: "text-muted-foreground border-border/60", dot: "bg-muted-foreground/60" },
  parsing: { label: "解析中", cls: "text-amber-500 border-amber-500/30", dot: "bg-amber-500 animate-pulse" },
  embedding: { label: "向量化中", cls: "text-amber-500 border-amber-500/30", dot: "bg-amber-500 animate-pulse" },
  ready: { label: "就绪", cls: "text-[var(--jade)] border-[var(--jade)]/30", dot: "bg-[var(--jade)]" },
  failed: { label: "失败", cls: "text-red-400 border-red-900/40", dot: "bg-red-500" },
}

/** 从进度文本（如 "LLM 清洗 6/7"、"OCR 解析 3/10 页"）解析出百分比；无数字返回 null */
function parseProgress(text: string | null): number | null {
  if (!text) return null
  const m = text.match(/(\d+)\s*\/\s*(\d+)/)
  if (m && +m[2] > 0) return Math.min(100, Math.round((+m[1] / +m[2]) * 100))
  return null
}

export function KnowledgeBasePage({ onBack }: Props) {
  const [docs, setDocs] = useState<DocInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [renameId, setRenameId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = (id: number) => {
    // 下载原文件 → 用本机默认程序（WPS/Adobe）打开
    const a = document.createElement("a")
    a.href = `/api/kb/files/${id}?download=1`
    a.download = ""
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const rename = async () => {
    const id = renameId
    if (id === null) return
    const name = renameValue.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/kb/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      setRenameId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 打开改名对话框（预填当前文件名） */
  const startRename = (id: number, name: string) => {
    setRenameId(id)
    setRenameValue(name)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/kb/documents")
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      setDocs(json.documents ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // 轮询状态：上传/解析是异步的，3s 刷新一次
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [load])

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const MAX_MB = 50
      if (file.size > MAX_MB * 1024 * 1024) {
        throw new Error(`文件超过 ${MAX_MB}MB 限制（${(file.size / 1024 / 1024).toFixed(1)}MB）：${file.name}`)
      }
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/kb/upload", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const remove = async (id: number) => {
    try {
      const res = await fetch(`/api/kb/documents/${id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  const active = (docs ?? []).filter((d) => d.status === "ready").length

  return (
    <main className="reveal relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-md)]">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="返回对话">
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium leading-none">知识库</span>
          {active > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--jade)]/25 bg-[var(--jade-soft)] px-2 py-0.5 text-[10px] leading-none text-muted-foreground">
              <span className="inline-block size-1.5 rounded-full bg-[var(--jade)]" />
              {active} 份就绪
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={load} title="刷新" disabled={loading}>
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6">
          {/* 上传区 */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver
                ? "border-[var(--jade)] bg-[var(--jade-soft)]"
                : "border-border/70 hover:border-[var(--jade)]/40 hover:bg-muted/20"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload(f)
                e.target.value = ""
              }}
            />
            {uploading ? (
              <Loader2Icon className="size-8 animate-spin text-[var(--jade)]" />
            ) : (
              <UploadIcon className="size-8 text-muted-foreground/50" />
            )}
            <div className="text-sm font-medium">点击或拖拽上传文档</div>
            <div className="text-xs text-muted-foreground/70">
              支持 PDF / TXT / Markdown / Word · 单个文件 ≤ 50MB
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-900/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* 文档分组：正在处理 / 处理完成 */}
          <div className="mt-6 space-y-6">
            {docs === null ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground/50">
                <Loader2Icon className="size-4 animate-spin" /> 加载中…
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-xl border border-border/60 px-4 py-10 text-center text-xs text-muted-foreground/50">
                暂无文档。上传后即可在对话中引用知识库。
              </div>
            ) : (
              <>
                {/* 正在处理（含失败） */}
                {(() => {
                  const processing = docs.filter((d) => d.status !== "ready")
                  if (!processing.length) return null
                  return (
                    <section>
                      <div className="flex items-center justify-between px-1">
                        <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/70">
                          正在处理
                          <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
                        </span>
                        <span className="rounded border border-border/60 px-1 py-px font-mono text-[9px] text-muted-foreground/50">
                          {processing.length}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {processing.map((d) => (
                          <DocCard
                            key={d.id}
                            doc={d}
                            minimal={false}
                            onPreview={preview}
                            onRequestRemove={setConfirmId}
                            onRename={startRename}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })()}

                {/* 处理完成 */}
                {(() => {
                  const done = docs.filter((d) => d.status === "ready")
                  if (!done.length) return null
                  return (
                    <section>
                      <div className="flex items-center justify-between px-1">
                        <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/70">
                          处理完成
                          <span className="inline-block size-1.5 rounded-full bg-[var(--jade)]" />
                        </span>
                        <span className="rounded border border-border/60 px-1 py-px font-mono text-[9px] text-muted-foreground/50">
                          {done.length}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {done.map((d) => (
                          <DocCard
                            key={d.id}
                            doc={d}
                            minimal
                            onPreview={preview}
                            onRequestRemove={setConfirmId}
                            onRename={startRename}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })()}
              </>
            )}
          </div>

          {/* 改名对话框 */}
          <Dialog open={renameId !== null} onOpenChange={(o) => !o && setRenameId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>重命名文档</DialogTitle>
                <DialogDescription>修改后的名称会用于知识库展示，不影响原始文件。</DialogDescription>
              </DialogHeader>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) rename()
                  if (e.key === "Escape") setRenameId(null)
                }}
                placeholder="输入新名称"
                className="w-full rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-[var(--jade)]/40"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setRenameId(null)}>
                  取消
                </Button>
                <Button onClick={rename} disabled={!renameValue.trim()} className="bg-[var(--jade)] text-white hover:opacity-90">
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 删除确认对话框 */}
          <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>删除文档？</DialogTitle>
                <DialogDescription>
                  {(() => {
                    const d = docs?.find((x) => x.id === confirmId)
                    return d
                      ? `将删除「${d.filename}」及其 ${d.chunk_count > 0 ? `${d.chunk_count} 个检索片段` : "全部数据"}，此操作不可撤销。`
                      : "此操作不可撤销。"
                  })()}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmId(null)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirmId !== null) remove(confirmId)
                    setConfirmId(null)
                  }}
                >
                  确认删除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </main>
  )
}

/** 单张文档卡片。minimal=true 时不显示进度/片段数/时间（处理完成的干净展示） */
function DocCard({
  doc,
  minimal,
  onPreview,
  onRequestRemove,
  onRename,
}: {
  doc: DocInfo
  minimal: boolean
  onPreview: (id: number) => void
  onRequestRemove: (id: number) => void
  onRename: (id: number, name: string) => void
}) {
  const meta = STATUS_META[doc.status] ?? STATUS_META.pending
  const ready = doc.status === "ready"
  const failed = doc.status === "failed"
  const pct = parseProgress(doc.progress)
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border p-4 transition-all duration-200",
        ready
          ? "border-[var(--jade)]/25 bg-[var(--jade-soft)]/40 hover:border-[var(--jade)]/50 hover:shadow-[var(--shadow-md)]"
          : "border-border/60 hover:border-border hover:bg-muted/20"
      )}
    >
      {/* 顶部：类型图标 + 状态徽章 */}
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border",
            ready
              ? "border-[var(--jade)]/30 bg-[var(--jade-soft)] text-[var(--jade)]"
              : "border-border/70 bg-muted/40 text-muted-foreground/60"
          )}
        >
          <FileTextIcon className="size-4" />
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] leading-none",
            meta.cls
          )}
        >
          <span className={cn("inline-block size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </div>

      {/* 文件名（点击查看原文件）+ 改名 */}
      <div className="mt-3 flex items-start gap-1">
        <button
          onClick={() => onPreview(doc.id)}
          title={doc.filename}
          className={cn(
            "min-w-0 flex-1 cursor-pointer text-left line-clamp-2 text-sm leading-snug break-all transition-colors",
            ready
              ? "font-medium hover:text-[var(--jade)]"
              : "text-foreground/80 hover:text-foreground"
          )}
        >
          {doc.filename}
        </button>
        <button
          onClick={() => onRename(doc.id, doc.filename)}
          title="重命名"
          className="mt-px shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground/30 opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          <PencilIcon className="size-3.5" />
        </button>
      </div>
      <div className="mt-1 inline-block rounded bg-muted px-1.5 py-px font-mono text-[9px] text-muted-foreground/60 uppercase">
        {doc.doc_type}
      </div>

      {/* AI 摘要（就绪文档） */}
      {ready && doc.summary && (
        <p
          title={doc.summary}
          className="mt-2.5 line-clamp-3 cursor-help border-l-2 border-[var(--jade)]/30 pl-2.5 text-xs leading-relaxed text-muted-foreground/75"
        >
          {doc.summary}
        </p>
      )}
      {ready && !doc.summary && (
        <p className="mt-2.5 flex items-center gap-1.5 border-l-2 border-border/40 pl-2.5 text-[11px] text-muted-foreground/40">
          <Loader2Icon className="size-3 animate-spin" />
          摘要生成中…
        </p>
      )}

      {failed ? (
        <div className="mt-2">
          <p className="line-clamp-2 text-xs text-red-400">{doc.error}</p>
          <div className="mt-2 flex items-center justify-end border-t border-border/50 pt-2">
            <button
              onClick={() => onRequestRemove(doc.id)}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2Icon className="size-3" />
              删除
            </button>
          </div>
        </div>
      ) : minimal ? (
        <div className="mt-2 flex items-center justify-end border-t border-border/50 pt-2">
          <button
            onClick={() => onRequestRemove(doc.id)}
            className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2Icon className="size-3" />
            删除
          </button>
        </div>
      ) : (
        <div className="mt-3">
          {/* 进度条：有数字 → 定值进度；无数字（如"分块中…"）→ 动画流光 */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
            {pct !== null ? (
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-500/70" />
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/60">
            <span className="truncate text-amber-500/90">{doc.progress}</span>
            {pct !== null && (
              <span className="shrink-0 font-mono tabular-nums">{pct}%</span>
            )}
            <button
              onClick={() => onRequestRemove(doc.id)}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2Icon className="size-3" />
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
