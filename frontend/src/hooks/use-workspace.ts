import { useCallback, useEffect, useState } from "react"

export interface Workspace {
  id: string
  name: string
  root: string
}
export interface WorkspaceState {
  current: string
  workspaces: Workspace[]
}

/** 当前工作区（agent 本地工具的锚点）：列表 / 切换 / 新增，均经后端持久化。 */
export function useWorkspace() {
  const [ws, setWs] = useState<WorkspaceState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setWs((await res.json()) as WorkspaceState)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const currentWs = ws?.workspaces.find((w) => w.id === ws.current) ?? null

  const switchTo = useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/workspaces/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [refresh]
  )

  /**
   * 弹系统原生目录选择对话框，返回所选绝对路径（取消/失败返回 null）。
   *
   * 桌面版（Electron）优先走 preload 暴露的 dialog.showOpenDialog（不经后端）；
   * 浏览器版回退到后端 /api/workspaces/pick（ctypes 弹框）。
   */
  const pickDirectory = useCallback(async (): Promise<string | null> => {
    setLoading(true)
    setError(null)
    try {
      const native = window.chemagentNative
      if (native) {
        const p = await native.pickDirectory()
        return p || null
      }
      const res = await fetch("/api/workspaces/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "选择工作区目录" }),
        // 兜底：对话框异常时 120s 后自行中断，避免无限转圈
        signal: AbortSignal.timeout(120_000),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
      return j.path || null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  /** 切换到无工作区（不限定目录）。 */
  const setNone = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "" }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const addWorkspace = useCallback(
    async (name: string, root: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, root }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j?.detail ?? `HTTP ${res.status}`)
        await refresh()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setLoading(false)
      }
    },
    [refresh]
  )

  return { ws, currentWs, loading, error, refresh, switchTo, setNone, pickDirectory, addWorkspace }
}
