import { useEffect, useState } from "react"

export type Theme = "light" | "dark"

/** 读取当前主题（跟随 <html data-theme>，变化时自动重渲染） */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  )

  useEffect(() => {
    const el = document.documentElement
    const update = () => setTheme(el.dataset.theme === "dark" ? "dark" : "light")
    update()
    const mo = new MutationObserver(update)
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] })
    return () => mo.disconnect()
  }, [])

  return theme
}
