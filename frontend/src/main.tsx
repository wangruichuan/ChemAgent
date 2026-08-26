import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import { I18nProvider } from "@/lib/i18n"
import "@/index.css"

// 启动时应用持久化的主题（默认浅色），与 index.html 防闪脚本保持一致
const savedTheme = localStorage.getItem("chemagent.theme")
document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
)
