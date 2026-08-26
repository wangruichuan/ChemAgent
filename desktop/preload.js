/**
 * ChemAgent 桌面版 preload（沙箱隔离下运行）。
 *
 * 通过 contextBridge 向渲染进程暴露最小原生能力：
 *   - pickDirectory(): 弹系统原生目录选择框（Electron dialog.showOpenDialog），
 *     返回所选绝对路径，取消返回 ""。
 *   - window.*：自定义标题栏按钮（最小化/最大化/关闭）与最大化状态同步。
 *
 * 安全基线：contextIsolation=true / nodeIntegration=false / sandbox=true。
 * 渲染进程拿不到 Node/electron 对象，只能调用这里白名单暴露的方法。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chemagentNative", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    /** 主进程推送 maximize 状态变化（订阅式；多监听时只取最后一个） */
    onMaximizedChange: (cb) => {
      const handler = (_e, v) => cb(!!v)
      ipcRenderer.on("window:maximized", handler)
      return () => ipcRenderer.removeListener("window:maximized", handler)
    },
  },
});
