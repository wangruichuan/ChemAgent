/// <reference types="vite/client" />

/** Electron preload 注入的原生能力（桌面版才有；浏览器版为 undefined） */
interface Window {
  chemagentNative?: {
    /** 弹系统原生目录选择框，返回绝对路径；取消返回空串 */
    pickDirectory: () => Promise<string>
  }
}
