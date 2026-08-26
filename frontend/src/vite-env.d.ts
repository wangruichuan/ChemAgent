/// <reference types="vite/client" />

/** Electron preload 注入的原生能力（桌面版才有；浏览器版为 undefined） */
interface Window {
  chemagentNative?: {
    /** 弹系统原生目录选择框，返回绝对路径；取消返回空串 */
    pickDirectory: () => Promise<string>
    /** 自定义标题栏窗口控制（桌面版才有） */
    window?: {
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<boolean>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
    }
  }
}
