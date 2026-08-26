/**
 * ChemAgent 桌面版 preload（沙箱隔离下运行）。
 *
 * 通过 contextBridge 向渲染进程暴露最小原生能力：
 *   - pickDirectory(): 弹系统原生目录选择框（Electron dialog.showOpenDialog），
 *     返回所选绝对路径，取消返回 ""。
 *
 * 安全基线：contextIsolation=true / nodeIntegration=false / sandbox=true。
 * 渲染进程拿不到 Node/electron 对象，只能调用这里白名单暴露的方法。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chemagentNative", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
});
