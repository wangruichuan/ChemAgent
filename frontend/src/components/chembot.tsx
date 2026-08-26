export function ChemBot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      {/* 天线 */}
      <line x1="16" y1="6.5" x2="16" y2="3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* 天线顶端原子节点 */}
      <circle cx="16" cy="2.6" r="1.5" fill="currentColor" />

      {/* 头部：圆角方 */}
      <rect
        x="7.5"
        y="6.5"
        width="17"
        height="17"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />

      {/* 两点眼 */}
      <circle cx="12.5" cy="13.5" r="1.5" fill="currentColor" className="bot-eye" style={{ animationDelay: "0s" }} />
      <circle cx="19.5" cy="13.5" r="1.5" fill="currentColor" className="bot-eye" style={{ animationDelay: "0.7s" }} />

      {/* 嘴：一条小弧（微笑） */}
      <path
        d="M12.5 19 Q16 21 19.5 19"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* 两侧耳柄 */}
      <line x1="7.5" y1="12" x2="5.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="24.5" y1="12" x2="26.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />

      {/* 底部颈口（接身体的暗示） */}
      <line x1="13" y1="23.5" x2="19" y2="23.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}
