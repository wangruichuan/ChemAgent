import { useState } from "react"
import { ChevronDownIcon, Loader2Icon, RefreshCwIcon, TerminalSquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { DEFAULT_SETTINGS, type ApiSettings } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: ApiSettings
  onSave: (s: ApiSettings) => void
}

export function SettingsDialog({ open, onOpenChange, settings, onSave }: Props) {
  const [draft, setDraft] = useState<ApiSettings>(settings)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [devOpen, setDevOpen] = useState(false)

  const set = <K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const fetchModels = async () => {
    setFetchingModels(true)
    setFetchError(null)
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: draft.baseUrl, api_key: draft.apiKey }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
      const ids: string[] = (json.models ?? []).map((m: { id: string }) => m.id)
      setModels(ids)
      if (ids.length && !ids.includes(draft.model)) {
        setDraft((d) => ({ ...d, model: ids[0] }))
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetchingModels(false)
    }
  }

  const save = () => {
    onSave({ ...draft, baseUrl: draft.baseUrl.replace(/\/+$/, "") })
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setDraft(settings)
          setModels([])
          setFetchError(null)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              value={draft.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder="https://your-endpoint/v1"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={draft.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model">模型名称</Label>
            <div className="flex items-center gap-2">
              <Input
                id="model"
                value={draft.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="模型名称"
                list="model-list"
              />
              <datalist id="model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Button variant="outline" onClick={fetchModels} disabled={fetchingModels} className="shrink-0">
                {fetchingModels ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
                获取列表
              </Button>
            </div>
            {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}
            {models.length > 0 && <p className="text-xs text-muted-foreground">共 {models.length} 个模型，输入框可下拉选择</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ctx">上下文长度（可选）</Label>
            <Input
              id="ctx"
              type="number"
              min={0}
              value={draft.contextLength ?? ""}
              onChange={(e) => set("contextLength", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="例如 128000"
            />
            <p className="text-xs text-muted-foreground">留空则不显示，仅用于界面信息展示</p>
          </div>

          {/* 开发者选项 */}
          <div className="overflow-hidden rounded-xl border border-border/70">
            <button
              type="button"
              onClick={() => setDevOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between bg-muted/40 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-foreground/80">
                <TerminalSquareIcon className="size-3.5 text-muted-foreground/60" />
                开发者选项
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 text-muted-foreground/50 transition-transform duration-200",
                  devOpen && "rotate-180"
                )}
              />
            </button>
            {devOpen && (
              <div className="grid gap-3 border-t border-border/60 px-4 py-3">
                {/* 上下文压缩 */}
                <div className="grid gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label>自动压缩上下文</Label>
                      <p className="text-xs text-muted-foreground">
                        上下文超过阈值时，把较早轮次压成摘要，避免长对话撑爆上下文
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.autoCompress}
                      onClick={() => set("autoCompress", !draft.autoCompress)}
                      className={cn(
                        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
                        draft.autoCompress ? "bg-[var(--jade)]" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform",
                          draft.autoCompress && "translate-x-4"
                        )}
                      />
                    </button>
                  </div>
                  {draft.autoCompress && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="compress-threshold">压缩触发阈值（估算 token）</Label>
                      <Input
                        id="compress-threshold"
                        type="number"
                        min={1000}
                        step={1000}
                        value={draft.compressThreshold}
                        onChange={(e) => set("compressThreshold", Number(e.target.value) || 12000)}
                        placeholder="例如 12000"
                      />
                      <p className="text-xs text-muted-foreground">
                        最近 {draft.keepRecent} 条消息始终保留不压缩；阈值越小压缩越早。
                      </p>
                    </div>
                  )}
                </div>

                {/* 系统提示词 */}
                <div className="grid gap-2">
                  <Label htmlFor="sys-prompt">系统提示词（System Prompt）</Label>
                  <Textarea
                    id="sys-prompt"
                    value={draft.systemPrompt}
                    onChange={(e) => set("systemPrompt", e.target.value)}
                    placeholder="例如：你是 ChemAgent，一个专注化学科研的 AI 助手…"
                    rows={4}
                    className="resize-y font-mono text-xs leading-5"
                  />
                  <p className="text-xs text-muted-foreground">
                    每轮请求作为 system 消息发给模型；留空则不发送。可用来设定角色、行为规则。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS })}>
            重置
          </Button>
          <Button onClick={save} className="bg-[var(--jade)] text-white transition-all hover:opacity-90">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
