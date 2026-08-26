import { useId } from "react"

export function Logo({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "")
  const clip = `flask-clip-${uid}`
  const grad = `flask-grad-${uid}`

  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d="M13.5 5.5 L13.5 11 L7 26 Q6.4 27.6 8 27.6 L24 27.6 Q25.6 27.6 25 26 L18.5 11 L18.5 5.5 Z" />
        </clipPath>
        <linearGradient
          id={grad}
          x1="0"
          y1="16"
          x2="0"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* 瓶内液体 + 气泡 */}
      <g clipPath={`url(#${clip})`}>
        <rect x="4" y="16.5" width="24" height="14" fill={`url(#${grad})`} />
        <circle className="bubble" cx="14.5" cy="20.5" r="1.5" fill="#fff" fillOpacity="0.9" style={{ animationDelay: "0s" }} />
        <circle className="bubble" cx="18.6" cy="22.8" r="1" fill="#fff" fillOpacity="0.75" style={{ animationDelay: "0.9s" }} />
        <circle className="bubble" cx="16.4" cy="24.7" r="0.7" fill="#fff" fillOpacity="0.6" style={{ animationDelay: "1.8s" }} />
      </g>

      {/* 烧瓶轮廓 */}
      <path
        d="M13.5 5.5 L13.5 11 L7 26 Q6.4 27.6 8 27.6 L24 27.6 Q25.6 27.6 25 26 L18.5 11 L18.5 5.5 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* 瓶口唇 */}
      <line
        x1="12.5"
        y1="5.5"
        x2="19.5"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
