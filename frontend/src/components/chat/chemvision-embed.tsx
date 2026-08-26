import type { ReactNode } from "react"

import { Markdown } from "@/components/chat/markdown"

// chemvision 结构图 / 方程式接口 URL（匹配 https://host/api/svg/... 或 /api/formula/...）
const CHEMVISION_URL_RE = /https?:\/\/[^)\s]+?\/api\/(?:svg|formula)\/[^)\s]+/gi

// 先把 markdown 链接壳 [文字](url) 还原成纯 url，避免正文残留 [文字]()
const MD_LINK_RE =
  /\[[^\]]*\]\((https?:\/\/[^)\s]+?\/api\/(?:svg|formula)\/[^)\s]+)\)/gi

function isSvg(url: string): boolean {
  return /\/api\/svg\//i.test(url)
}

/** 内联展示 chemvision 生成的分子结构图 / 化学方程式（接口返回独立可渲染的 HTML 页） */
function ChemVisionFrame({ url }: { url: string }) {
  const svg = isSvg(url)
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/70 bg-card/40">
      <iframe
        src={url}
        title={svg ? "分子结构图" : "化学方程式"}
        className="block w-full border-0 bg-[var(--md-pre-bg)]"
        style={{ height: svg ? 420 : 160 }}
        loading="lazy"
      />
      <div className="flex items-center justify-between border-t border-border/50 px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground/60">
          {svg ? "分子结构图" : "化学方程式"} · ChemVision
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-[var(--jade)] hover:underline"
        >
          新标签打开
        </a>
      </div>
    </div>
  )
}

/** 渲染助手消息：chemvision 的图片类 URL 内联成 iframe，其余文字照常走 Markdown */
export function RichContent({ content }: { content: string }) {
  if (!content) return null
  const cleaned = content.replace(MD_LINK_RE, "$1")
  const parts = cleaned.split(CHEMVISION_URL_RE)
  const matches = cleaned.match(CHEMVISION_URL_RE) || []
  const nodes: ReactNode[] = []
  parts.forEach((text, i) => {
    if (text.trim()) {
      nodes.push(<Markdown key={`t${i}`} content={text} />)
    }
    const url = matches[i]
    if (url) {
      nodes.push(<ChemVisionFrame key={`u${i}`} url={url} />)
    }
  })
  return <div className="space-y-1">{nodes}</div>
}
