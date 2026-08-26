import { useEffect, useState } from "react"
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface Props {
  className?: string
}

/** 自定义窗口控制按钮（minimize / toggleMaximize / close），替代 titleBarOverlay。
 *  背景与 header 完全一致，视觉上"无标题栏"——应用顶栏即标题栏。 */
export function TitleBarButtons({ className }: Props) {
  const native = window.chemagentNative?.window
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!native) return
    let cancelled = false
    native.isMaximized().then((v) => {
      if (!cancelled) setMaximized(!!v)
    })
    return native.onMaximizedChange((v) => {
      if (!cancelled) setMaximized(v)
    })
  }, [native])

  if (!native) return null // 浏览器环境不渲染

  const btn = "flex h-9 w-11 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none"

  return (
    <div className={cn("flex items-center", className)}>
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => native.minimize()}
        className={btn}
      >
        <MinusIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => native.toggleMaximize()}
        className={btn}
      >
        {maximized ? <CopyIcon className="size-3.5" /> : <SquareIcon className="size-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => native.close()}
        className={cn(btn, "hover:bg-red-500 hover:text-white focus-visible:bg-red-500 focus-visible:text-white")}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
