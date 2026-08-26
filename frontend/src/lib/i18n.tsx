import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { zh } from "@/lib/locales/zh"
import { en } from "@/lib/locales/en"

export type Lang = "zh" | "en"

const STORAGE_KEY = "chemagent.lang"

type Dict = Record<string, string>

const dicts: Record<Lang, Dict> = { zh, en }

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => void
  toggleLang: () => void
  t: (key: string) => string
}

const Ctx = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh"
  )

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN"
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLangState(l)
  }, [])

  const toggleLang = useCallback(() => {
    setLang(lang === "zh" ? "en" : "zh")
  }, [lang, setLang])

  const t = useCallback(
    (key: string) => dicts[lang][key] ?? dicts.zh[key] ?? key,
    [lang]
  )

  const value = useMemo(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useI18n 必须在 <I18nProvider> 内使用")
  return ctx
}

export function useT(): (key: string) => string {
  return useI18n().t
}
