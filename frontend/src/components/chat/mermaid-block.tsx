import { memo, useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  RotateCcwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { useTheme } from "@/lib/use-theme"

type MermaidModule = typeof import("mermaid").default

let mermaidPromise: Promise<MermaidModule> | null = null

const baseConfig = {
  startOnLoad: false,
  securityLevel: "strict" as const,
  theme: "base" as const,
  fontFamily: '"Noto Sans SC", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
}

/** 浅色主题变量（暖纸白 + 翡翠） */
const lightVars = {
  background: "transparent",
  primaryColor: "#e2efe7",
  primaryTextColor: "#292524",
  primaryBorderColor: "#3fb98a",
  lineColor: "#78716c",
  textColor: "#292524",
  clusterBkg: "#f3efe4",
  clusterBorder: "#d6d3d1",
  edgeLabelBackground: "#faf9f6",
  fontFamily: '"Noto Sans SC", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
}

/** 暗色主题变量（近黑冷调 + 翡翠） */
const darkVars = {
  background: "transparent",
  primaryColor: "#1c2230",
  primaryTextColor: "#e6edf3",
  primaryBorderColor: "#3fb98a",
  lineColor: "#6b7785",
  textColor: "#e6edf3",
  clusterBkg: "#1a2030",
  clusterBorder: "#2a3340",
  edgeLabelBackground: "#1c2230",
  fontFamily: '"Noto Sans SC", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
}

/** 懒加载 mermaid；按当前主题初始化（主题切换后重新应用配置） */
function loadMermaid(theme: "light" | "dark"): Promise<MermaidModule> {
  const vars = theme === "dark" ? darkVars : lightVars
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mmd = mod.default
      mmd.initialize({ ...baseConfig, themeVariables: vars })
      return mmd
    })
  }
  // mermaid.initialize 可重复调用，主题切换时覆盖配置并重渲染
  return mermaidPromise.then((mmd) => {
    mmd.initialize({ ...baseConfig, themeVariables: vars })
    return mmd
  })
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; svg: string }
  | { kind: "error"; message: string }

function SourceFallback({ code, error }: { code: string; error?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-5 overflow-hidden rounded-[4px] border border-red-900/40 bg-[var(--md-pre-bg)]">
      <div className="flex items-center justify-between px-4 pt-2 pb-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-red-400/80">
          <AlertTriangleIcon className="size-3" />
          mermaid · 解析失败
          {error && <span className="normal-case tracking-normal text-red-400/50">({error})</span>}
        </span>
        <button
          onClick={copy}
          title={copied ? "已复制" : "复制"}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-red-400/40 transition-all hover:bg-accent/70 hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3" style={{ color: "var(--jade)" }} /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre px-4 pb-3 font-mono text-[12.5px] leading-relaxed text-red-200/70">
        {code}
      </pre>
    </div>
  )
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4

function MermaidBlockBase({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: "loading" })
  const idRef = useRef(0)
  const theme = useTheme()

  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fitScale, setFitScale] = useState(1)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  // 渲染成功后：测量 svg 与视口尺寸，自动适配到完整显示
  useEffect(() => {
    if (state.kind !== "ok") return
    const vp = viewportRef.current
    const svgEl = vp?.querySelector("svg")
    if (!vp || !svgEl) return
    const vpW = vp.clientWidth
    const vpH = vp.clientHeight
    let sw = 0
    let sh = 0
    const vb = svgEl.getAttribute("viewBox")
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number)
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        sw = parts[2]
        sh = parts[3]
      }
    }
    if (sw <= 0 || sh <= 0) {
      sw = svgEl.width?.baseVal?.value || svgEl.getBoundingClientRect().width
      sh = svgEl.height?.baseVal?.value || svgEl.getBoundingClientRect().height
    }
    if (sw <= 0 || sh <= 0) return
    const fit = Math.max(0.05, Math.min(1, Math.min(vpW / sw, vpH / sh)))
    setFitScale(fit)
    setScale(fit)
    setPan({ x: 0, y: 0 })
  }, [state.kind])

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    const id = `chem-mermaid-${Date.now().toString(36)}-${idRef.current++}`
    loadMermaid(theme)
      .then((mmd) => mmd.render(id, code))
      .then(({ svg }) => {
        if (!cancelled) setState({ kind: "ok", svg })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [code, theme])

  // 滚轮缩放（scale=1 时也可用滚轮放大）
  useEffect(() => {
    const el = viewportRef.current
    if (!el || state.kind !== "ok") return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.15 : -0.15
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [state.kind])

  const zoomBy = (delta: number) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)))
  }
  const reset = () => {
    setScale(fitScale)
    setPan({ x: 0, y: 0 })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    setPan({
      x: d.originX + (e.clientX - d.startX),
      y: d.originY + (e.clientY - d.startY),
    })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
  }

  if (state.kind === "ok") {
    return (
      <div className="my-5 overflow-hidden rounded-[4px] border border-border bg-[var(--md-pre-bg)]">
        {/* 工具栏 */}
        <div className="flex items-center justify-end gap-0.5 border-b border-border/60 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => zoomBy(-0.25)}
              title="缩小"
              disabled={scale <= MIN_SCALE}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ZoomOutIcon className="size-3.5" />
            </button>
            <span className="w-11 text-center font-mono text-[11px] text-muted-foreground/70 tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => zoomBy(0.25)}
              title="放大"
              disabled={scale >= MAX_SCALE}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ZoomInIcon className="size-3.5" />
            </button>
            <button
              onClick={reset}
              title="重置视图"
              disabled={scale === fitScale && pan.x === 0 && pan.y === 0}
              className="ml-0.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <RotateCcwIcon className="size-3.5" />
            </button>
          </div>
        </div>
        {/* 视口：滚轮缩放 + 拖拽平移 */}
        <div
          ref={viewportRef}
          className="relative flex h-[520px] touch-none select-none items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="origin-center [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: dragRef.current ? "none" : "transform 120ms ease-out",
            }}
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
          {scale !== 1 && (
            <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-stone-900/60 px-2 py-0.5 font-mono text-[10px] text-stone-100 backdrop-blur-sm">
              {Math.round(scale * 100)}%
            </span>
          )}
        </div>
      </div>
    )
  }

  if (state.kind === "error") {
    return <SourceFallback code={code} error={state.message} />
  }

  return (
    <div className="my-5 flex items-center gap-2 rounded-[4px] border border-border bg-[var(--md-pre-bg)] px-4 py-5 text-[12px] text-muted-foreground/60">
      <Loader2Icon className="size-3.5 animate-spin text-[var(--jade)]" />
      正在渲染图表…
    </div>
  )
}

export const MermaidBlock = memo(MermaidBlockBase)
