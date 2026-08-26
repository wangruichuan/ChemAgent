import { useRef, useState } from "react"
import {
  LanguagesIcon,
  LibraryBigIcon,
  ListTodoIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
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
import { Logo } from "@/components/logo"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useI18n, useT } from "@/lib/i18n"
import type { Conversation } from "@/types"

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string) => void
  onClearAll: () => void
  onOpenSettings: () => void
  /** 工具区入口点击（如技能 → 切换主区域页面；null = 返回对话） */
  onToolOpen: (id: string | null) => void
  /** 当前主题（light | dark） */
  theme: "light" | "dark"
  /** 切换主题（已持久化到 localStorage） */
  onToggleTheme: () => void
}

/** 工具区入口（功能逐步接入，当前先提供入口与选中态） */
interface ToolEntry {
  id: string
  label: string
  icon: LucideIcon
  badge?: string
  /** 待上线：仅展示标识，不可点击 */
  comingSoon?: boolean
}

/** 相对日期：今天显示时间，昨天显示"昨天"，一周内显示周几，更早显示月日 */
function relativeDate(ts: number, t: (k: string) => string): string {
  const now = new Date()
  const d = new Date(ts)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.floor((startToday - startDay) / 86400000)
  if (days <= 0) {
    return d.toTimeString().slice(0, 5) // HH:mm
  }
  if (days === 1) return t("date.yesterday")
  if (days <= 7) {
    const chars = t("date.weekChars") // zh: 日一二三四五六；en: SunMonTueWedThuFriSat
    const w = d.getDay()
    const len = chars.length === 7 ? 1 : 3
    return chars.slice(w * len, w * len + len)
  }
  return `${d.getMonth() + 1}${t("date.month")}${d.getDate()}${t("date.day")}`
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onClearAll,
  onOpenSettings,
  onToolOpen,
  theme,
  onToggleTheme,
}: Props) {
  const { lang, toggleLang } = useI18n()
  const t = useT()
  const TOOLS: ToolEntry[] = [
    { id: "knowledge", label: t("sidebar.knowledge"), icon: LibraryBigIcon, badge: t("sidebar.knowledgeBadge") },
    { id: "automation", label: t("sidebar.automation"), icon: WorkflowIcon, badge: t("sidebar.automationBadge"), comingSoon: true },
    { id: "skills", label: t("sidebar.skills"), icon: PuzzleIcon, badge: t("sidebar.skillsBadge") },
  ]
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sorted = conversations
    .slice()
    .sort((a, b) => {
      // 置顶优先，其次按更新时间倒序
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((c) => c.title.toLowerCase().includes(q))
    : sorted

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-md)]">
      {/* 品牌区 */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div className="text-[var(--jade)]">
          <Logo className="size-8" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display text-[19px] font-semibold tracking-tight">ChemAgent</span>
          <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.22em] text-muted-foreground/60">
            Research · Lab
          </span>
        </div>
      </div>

      {/* 新建任务（置顶） */}
      <div className="shrink-0 px-3 pb-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 border-dashed"
          onClick={onNew}
        >
          <PlusIcon className="size-4 shrink-0" />
          {t("sidebar.newTask")}
        </Button>
      </div>

      {/* 工具区 */}
      <div className="shrink-0 px-3 pb-3">
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="text-[11px] font-medium text-muted-foreground/70">{t("sidebar.tools")}</span>
          <span className="rounded border border-border/60 px-1 py-px font-mono text-[9px] text-muted-foreground/50">
            TOOLS
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {TOOLS.map((t) => {
            const Icon = t.icon
            const active = activeTool === t.id
            return (
              <button
                key={t.id}
                disabled={t.comingSoon}
                onClick={() => {
                  const next = active ? null : t.id
                  setActiveTool(next)
                  onToolOpen(next)
                }}
                title={t.comingSoon ? "功能待上线" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm leading-none transition-all duration-200",
                  t.comingSoon
                    ? "cursor-not-allowed opacity-45"
                    : "cursor-pointer hover:translate-x-0.5",
                  active
                    ? "bg-accent text-accent-foreground"
                    : t.comingSoon
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-200",
                    active ? "scale-110 text-[var(--jade)]" : "opacity-60 group-hover:scale-110"
                  )}
                />
                <span className="flex-1 truncate">{t.label}</span>
                {t.badge && (
                  <span className="rounded bg-muted px-1.5 py-px font-mono text-[9px] text-muted-foreground/60">
                    {t.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 分隔 */}
      <div className="shrink-0 border-t border-border/60" />

      {/* 任务区 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pt-3 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground/70">{t("sidebar.tasks")}</span>
            <span className="rounded border border-border/60 px-1 py-px font-mono text-[9px] text-muted-foreground/50">
              {conversations.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {conversations.length > 0 && (
              <button
                onClick={() => setClearOpen(true)}
                title={t("sidebar.clearAll")}
                className="flex cursor-pointer items-center gap-1 rounded border border-border/60 px-1.5 py-px font-mono text-[9px] text-muted-foreground/50 transition-colors hover:border-red-900/40 hover:text-red-400"
              >
                <Trash2Icon className="size-2.5" />
                {t("sidebar.clearAll")}
              </button>
            )}
            <button
              onClick={() =>
                setSearchOpen((v) => {
                  const next = !v
                  if (next) requestAnimationFrame(() => searchInputRef.current?.focus())
                  return next
                })
              }
              title={t("sidebar.search")}
              className={cn(
                "flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors",
                searchOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground/50 hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <SearchIcon className="size-4" />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="px-3 pb-1.5">
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("sidebar.searchPlaceholder")}
                className="w-full rounded-lg border border-border/60 bg-muted/30 py-1.5 pr-6 pl-7 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-[var(--jade)]/40"
              />
              <button
                onClick={() => {
                  setQuery("")
                  setSearchOpen(false)
                }}
                title={t("sidebar.closeSearch")}
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground/40 transition-colors hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground/40">
              {query ? t("sidebar.noMatch") : t("sidebar.noTasks")}
            </div>
          ) : (
            filtered.map((conv, i) => {
              const next = filtered[i + 1]
              const isBoundary = conv.pinned && next && !next.pinned
              return (
                <div key={conv.id}>
                  <div
                    onClick={() => editingId !== conv.id && onSelect(conv.id)}
                    className={cn(
                      "group relative mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-sm leading-none transition-all duration-200 hover:translate-x-0.5",
                      conv.id === activeId
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                <ListTodoIcon
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                    conv.pinned ? "text-[var(--jade)]" : "opacity-60"
                  )}
                />
                {editingId === conv.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => {
                      onRename(conv.id, editValue)
                      setEditingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(conv.id, editValue)
                        setEditingId(null)
                      }
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                )}
                {editingId !== conv.id && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">
                    {relativeDate(conv.updatedAt, t)}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button
                      className={cn(
                        "shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100",
                        conv.id === activeId && "opacity-60"
                      )}
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(conv.id)
                      }}
                    >
                      {conv.pinned ? <PinOffIcon /> : <PinIcon />}
                      {conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(conv.id)
                        setEditValue(conv.title)
                      }}
                    >
                      <PencilIcon />
                      {t("sidebar.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(conv.id)
                      }}
                    >
                      <Trash2Icon />
                      {t("sidebar.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
                {isBoundary && <div className="mx-2 my-1.5 border-t border-border/60" />}
              </div>
            );
            })
          )}
        </div>
      </div>      {/* 底部：设置 + 主题 + 语言 */}
      <div className="shrink-0 rounded-b-2xl border-t bg-card p-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm leading-none text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <SettingsIcon className="size-4 shrink-0" />
            <span>{t("sidebar.settings")}</span>
          </button>
          <button
            onClick={toggleLang}
            title={lang === "zh" ? t("sidebar.langToEn") : t("sidebar.langToZh")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <LanguagesIcon className="size-4" />
          </button>
          <button
            onClick={onToggleTheme}
            title={theme === "dark" ? t("sidebar.themeToLight") : t("sidebar.themeToDark")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          </button>
        </div>
      </div>

      {/* 清空全部确认对话框 */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sidebar.clearAllTitle")}</DialogTitle>
            <DialogDescription>
              {t("sidebar.clearAllDesc").replace("{count}", String(conversations.length))}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onClearAll()
                setClearOpen(false)
              }}
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
