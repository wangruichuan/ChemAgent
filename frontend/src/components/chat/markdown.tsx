import { memo, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { CheckIcon, CopyIcon } from "lucide-react"
import { MermaidBlock } from "./mermaid-block"
import { useTheme } from "@/lib/use-theme"

/** 浅色代码主题（GitHub Light 调） */
const lightTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': {
    color: "#24292f",
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: "12.5px",
    lineHeight: 1.65,
    whiteSpace: "pre",
    tabSize: 2,
    hyphens: "none",
  },
  comment: { color: "#6e7781", fontStyle: "italic" },
  prolog: { color: "#6e7781" },
  doctype: { color: "#6e7781" },
  cdata: { color: "#6e7781" },
  punctuation: { color: "#6e7781" },
  property: { color: "#0550ae" },
  tag: { color: "#cf222e" },
  boolean: { color: "#0550ae" },
  number: { color: "#0550ae" },
  constant: { color: "#0550ae" },
  symbol: { color: "#0550ae" },
  deleted: { color: "#cf222e" },
  selector: { color: "#8250df" },
  "attr-name": { color: "#953800" },
  string: { color: "#0a3069" },
  char: { color: "#0a3069" },
  builtin: { color: "#953800" },
  inserted: { color: "#0a3069" },
  operator: { color: "#6e7781" },
  entity: { color: "#cf222e" },
  url: { color: "#0a3069" },
  atrule: { color: "#8250df" },
  "attr-value": { color: "#0a3069" },
  keyword: { color: "#cf222e" },
  function: { color: "#8250df" },
  "class-name": { color: "#953800" },
  regex: { color: "#0a3069" },
  important: { color: "#cf222e", fontWeight: "600" },
  variable: { color: "#24292f" },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic" },
}

/** 暗色代码主题（GitHub Dark 调，呼应翡翠/紫强调色） */
const darkTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': {
    color: "#c9d1d9",
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: "12.5px",
    lineHeight: 1.65,
    whiteSpace: "pre",
    tabSize: 2,
    hyphens: "none",
  },
  comment: { color: "#8b949e", fontStyle: "italic" },
  prolog: { color: "#8b949e" },
  doctype: { color: "#8b949e" },
  cdata: { color: "#8b949e" },
  punctuation: { color: "#8b949e" },
  property: { color: "#79c0ff" },
  tag: { color: "#ff7b72" },
  boolean: { color: "#79c0ff" },
  number: { color: "#79c0ff" },
  constant: { color: "#79c0ff" },
  symbol: { color: "#79c0ff" },
  deleted: { color: "#ff7b72" },
  selector: { color: "#d2a8ff" },
  "attr-name": { color: "#ffa657" },
  string: { color: "#a5d6ff" },
  char: { color: "#a5d6ff" },
  builtin: { color: "#ffa657" },
  inserted: { color: "#a5d6ff" },
  operator: { color: "#8b949e" },
  entity: { color: "#ff7b72" },
  url: { color: "#a5d6ff" },
  atrule: { color: "#d2a8ff" },
  "attr-value": { color: "#a5d6ff" },
  keyword: { color: "#ff7b72" },
  function: { color: "#d2a8ff" },
  "class-name": { color: "#ffa657" },
  regex: { color: "#a5d6ff" },
  important: { color: "#ff7b72", fontWeight: "600" },
  variable: { color: "#c9d1d9" },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic" },
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const isDark = useTheme() === "dark"

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
    <div className="group/code relative my-5 overflow-hidden rounded-[4px] border border-border bg-[var(--md-pre-bg)]">
      <div className="flex items-center justify-between px-4 pt-2 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          {language || "text"}
        </span>
        <button
          onClick={copy}
          title={copied ? "已复制" : "复制"}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/40 transition-all hover:bg-accent/70 hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3" style={{ color: "var(--jade)" }} /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={isDark ? darkTheme : lightTheme}
        customStyle={{
          margin: 0,
          padding: "2px 16px 14px",
          background: "transparent",
          fontSize: "12.5px",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function MarkdownBase({ content }: { content: string }) {
  // 预处理：把 ```lang\n...\n``` 代码块替换为占位，渲染时再组装
  const parts: Array<{ kind: "code"; lang: string; code: string } | { kind: "text"; content: string }> = []
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: "text", content: content.slice(last, m.index) })
    parts.push({ kind: "code", lang: m[1] || "text", code: m[2].replace(/\n$/, "") })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ kind: "text", content: content.slice(last) })

  return (
    <div className="md-body">
      {parts.map((p, i) =>
        p.kind === "code" ? (
          p.lang === "mermaid" ? (
            <MermaidBlock key={i} code={p.code} />
          ) : (
            <CodeBlock key={i} language={p.lang} code={p.code} />
          )
        ) : (
          <MarkdownText key={i} content={p.content} />
        )
      )}
    </div>
  )
}

function MarkdownText({ content }: { content: string }) {
  return (
    <InlineMarkdown content={content} />
  )
}

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * 行内引用归一化：把模型在正文里打的引用标记 〔1〕 / [1] / 〔1,2〕 / [1,2]
 * 统一转成 markdown 链接 `[n](#cite-n)`，由 ReactMarkdown 渲染成 <a>，
 * 再由 a 组件识别 `#cite-n` 渲染成可点的上标引用 chip（点击展开对应来源）。
 * 用 〔〕（全角括号）作主标记，几乎不会与正文正常文本冲突；半角 [n] 用
 * 负向 lookahead `(?!\()` 排除已是 markdown 链接 `[文字](url)` 的情况。
 */
function normalizeCitations(text: string): string {
  let t = text
  // 1) 全角 〔1,2〕 → 拆成 〔1〕〔2〕
  t = t.replace(/〔\s*(\d+(?:\s*[,，\-]\s*\d+)*)\s*〕/g, (_m, nums: string) =>
    nums.split(/[,，\-]/).map((n) => n.trim()).filter(Boolean).map((n) => `〔${n}〕`).join("")
  )
  // 2) 半角 [1,2]（排除 [x](url) 链接）→ 〔1〕〔2〕
  t = t.replace(/\[(\d+(?:\s*[,，\-]\s*\d+)*)\](?!\()/g, (_m, nums: string) =>
    nums.split(/[,，\-]/).map((n) => n.trim()).filter(Boolean).map((n) => `〔${n}〕`).join("")
  )
  // 3) 〔n〕 → [n](#cite-n)
  t = t.replace(/〔(\d+)〕/g, "[$1](#cite-$1)")
  return t
}

function InlineMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children }) {
          // 行内引用：#cite-N → 上标 chip，点击派发 kb-cite 事件（携带所属消息 id 作作用域）
          const cite = href?.match(/^#cite-(\d+)$/)
          if (cite) {
            const n = Number(cite[1])
            return (
              <sup
                className="kb-cite mx-px cursor-pointer select-none rounded-[3px] border border-[var(--jade)]/40 bg-[var(--jade-soft)]/50 px-1 font-mono text-[10px] leading-none text-[var(--jade)] transition-colors hover:bg-[var(--jade)]/25"
                style={{ position: "relative", top: "-0.4em" }}
                title={`查看来源 ${n}`}
                onClick={(e) => {
                  const host = (e.currentTarget as HTMLElement).closest("[data-kb-msg]")
                  document.dispatchEvent(
                    new CustomEvent("kb-cite", {
                      detail: { n, msgId: host?.getAttribute("data-kb-msg") ?? "" },
                    })
                  )
                }}
              >
                {n}
              </sup>
            )
          }
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          )
        },
      }}
    >
      {normalizeCitations(content)}
    </ReactMarkdown>
  )
}

export const Markdown = memo(MarkdownBase)
