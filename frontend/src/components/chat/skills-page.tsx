import { useEffect, useState } from "react"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  LanguagesIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DEFAULT_SETTINGS, type ApiSettings } from "@/types"

/** 读取前端保存的 API 设置（与 use-chat 同款 localStorage key），用于把翻译请求指向用户配置的模型。 */
function readSettings(): ApiSettings {
  try {
    const raw = localStorage.getItem("chat.settings.v1")
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ApiSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

interface SkillInfo {
  name: string
  description: string
  description_zh: string
  display_name: string
  path: string
}

interface SkillDetail extends SkillInfo {
  version: string
  instructions: string
}

interface Props {
  onBack: () => void
}

/** 技能管理页：独立全页界面，卡片网格 + 详情面板 */
export function SkillsPage({ onBack }: Props) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [translating, setTranslating] = useState<string | null>(null)
  const [translateError, setTranslateError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/skills")
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      setSkills(json.skills ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openDetail = async (name: string) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      setDetail(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDelete = (name: string) => {
    if (confirmDelete !== name) {
      setConfirmDelete(name)
      setTimeout(() => setConfirmDelete((c) => (c === name ? null : c)), 3000)
      return
    }
    setConfirmDelete(null)
    void doDelete(name)
  }

  const doDelete = async (name: string) => {
    setDeleting(name)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      setSkills((prev) => prev?.filter((s) => s.name !== name) ?? [])
      setDetail(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(null)
    }
  }

  const translateSkill = async (name: string) => {
    setTranslating(name)
    setTranslateError(null)
    // 20s 超时中断：上游抖动/挂起时保证转圈一定会停下来
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const s = readSettings()
      const res = await fetch("/api/skills/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          base_url: s.baseUrl,
          api_key: s.apiKey,
          model: s.model,
        }),
        signal: controller.signal,
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
      const zh = (j?.description_zh ?? "") as string
      if (!zh) throw new Error("翻译结果为空")
      setSkills((prev) => prev?.map((it) => (it.name === name ? { ...it, description_zh: zh } : it)) ?? [])
      setDetail((prev) => (prev && prev.name === name ? { ...prev, description_zh: zh } : prev))
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "翻译超时，请重试"
          : e instanceof Error
            ? e.message
            : String(e)
      setTranslateError(msg)
    } finally {
      clearTimeout(timer)
      setTranslating(null)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = skills?.filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.description_zh ?? "").toLowerCase().includes(q) ||
      (s.display_name ?? "").toLowerCase().includes(q)
  )

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-md)]">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="返回任务">
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <WrenchIcon className="size-4 shrink-0 text-[var(--jade)]" />
          <span className="truncate text-sm font-medium">技能管理</span>
          {skills && (
            <span className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
              {skills.length} 个已添加
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-56">
            <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能…"
              className="w-full rounded-lg border border-border/60 bg-muted/30 py-1.5 pr-3 pl-7 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-[var(--jade)]/40"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={load}
            title="刷新"
            disabled={loading}
          >
            <RefreshCwIcon className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      </header>

      {/* 翻译失败提示条（从卡片或详情触发均可见） */}
      {translateError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/15 px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-red-400/90">{translateError}</span>
          <button
            onClick={() => setTranslateError(null)}
            title="关闭"
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-red-400/60 transition-colors hover:bg-red-950/40 hover:text-red-400"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      )}

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && !skills ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground/60">
              <Loader2Icon className="size-3.5 animate-spin" />
              正在加载…
            </div>
          ) : error ? (
            <div className="py-10 text-center text-xs text-red-400/80">{error}</div>
          ) : !skills || skills.length === 0 ? (
            /* 空库状态 */
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-border/70 text-muted-foreground/40">
                <BookOpenIcon className="size-6" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground/80">技能库为空</div>
                <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-5 text-muted-foreground/60">
                  将技能目录（含 SKILL.md 的文件夹）放入
                  <br />
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground/80">
                    backend/app/tools/skills_store/
                  </code>
                  <br />
                  后点击刷新即可加载。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
                <RefreshCwIcon className="size-3.5" />
                刷新
              </Button>
            </div>
          ) : filtered && filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((s) => (
                <div
                  key={s.name}
                  className={cn(
                    "group flex cursor-pointer flex-col rounded-xl border p-3.5 transition-all hover:shadow-[var(--shadow-md)]",
                    detail?.name === s.name
                      ? "border-[var(--jade)]/40 bg-muted/40"
                      : "border-border/70 bg-card hover:border-[var(--jade)]/35"
                  )}
                  onClick={() => openDetail(s.name)}
                >
                  <div className="flex items-center gap-2">
                    <BookOpenIcon className="size-4 shrink-0 text-[var(--jade)]/80" />
                    <span className="truncate font-mono text-[12px] font-medium text-foreground/90">
                      {s.display_name || s.name}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 min-h-[3.5em] flex-1 text-[11.5px] leading-4.5 text-muted-foreground/70">
                    {s.description_zh || s.description || "暂无描述"}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-px font-mono text-[9px] text-muted-foreground/60">
                      {s.name}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          translateSkill(s.name)
                        }}
                        disabled={translating === s.name}
                        title="翻译简介"
                        className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-[var(--jade)]/10 hover:text-[var(--jade)] disabled:opacity-50"
                      >
                        {translating === s.name ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <LanguagesIcon className="size-3" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(s.name)
                        }}
                        disabled={deleting === s.name}
                        title={confirmDelete === s.name ? "再次点击确认删除" : "删除技能"}
                        className={cn(
                          "flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-50",
                          confirmDelete === s.name
                            ? "bg-red-950/40 text-red-400"
                            : "text-muted-foreground/40 hover:bg-red-950/40 hover:text-red-400"
                        )}
                      >
                        {deleting === s.name ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-muted-foreground/40">
              {q ? "未找到匹配的技能" : "暂无已添加技能"}
            </div>
          )}
        </div>

        {/* 详情面板 */}
        <div className="hidden w-80 shrink-0 flex-col border-l border-border/60 lg:flex">
          <div className="border-b px-5 py-3">
            <span className="text-[11px] font-medium text-muted-foreground/70">技能详情</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {detailLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground/60">
                <Loader2Icon className="size-3.5 animate-spin" />
                加载中…
              </div>
            ) : detail ? (
              <div>
                <div className="font-mono text-[14px] font-medium text-foreground/90">
                  {detail.display_name || detail.name}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/50">
                  {detail.name}
                  {detail.version && ` · v${detail.version}`}
                </div>
                <p className="mt-2.5 text-[12px] leading-5 text-muted-foreground/80">
                  {detail.description_zh || detail.description}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => translateSkill(detail.name)}
                  disabled={translating === detail.name}
                  className="mt-3 gap-1.5"
                >
                  {translating === detail.name ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <LanguagesIcon className="size-3.5" />
                  )}
                  翻译简介
                </Button>
                <p className="mt-3 text-[10px] leading-4 text-muted-foreground/40">
                  技能仅展示简介，详细指令在对话中被模型调用时按需加载。
                </p>
              </div>
            ) : (
              <div className="py-8 text-center text-[11px] text-muted-foreground/40">
                点击左侧卡片查看技能详情
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
