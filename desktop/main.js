/**
 * ChemAgent 桌面版主进程（Electron 壳）。
 *
 * 职责：
 *  1. 选择空闲端口，以子进程拉起本地后端（prod: 打包的 chemagent-backend.exe；
 *     dev: backend/.venv 的 python 跑 run_server.py）
 *  2. 等待后端 /api/health 就绪后，打开窗口加载 http://127.0.0.1:<port>
 *     （打包版后端直接托管前端 dist，同源无 CORS 问题；dev 模式加载 Vite 5173）
 *  3. 应用退出时清理后端子进程，单实例锁防重复启动
 *
 * 安全基线：contextIsolation=true / nodeIntegration=false / sandbox=true，
 * 渲染进程与 Node 完全隔离，仅通过 HTTP 与本地后端交互（与浏览器版同模型）。
 */
const { app, BrowserWindow, dialog, ipcMain, session, Menu } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const DEV = process.argv.includes("--dev");
const BACKEND_PORT_START = 8000;

let backendProc = null;
let mainWindow = null;

// ---------- 端口 ----------
async function getFreePort(start, attempts = 50) {
  for (let p = start; p < start + attempts; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error("找不到空闲端口");
}

// ---------- 后端 ----------
function backendCommand() {
  if (app.isPackaged) {
    return {
      cmd: path.join(process.resourcesPath, "backend", "chemagent-backend.exe"),
      args: [],
      env: { CHEMAGENT_DATA: path.join(app.getPath("userData"), "data") },
    };
  }
  return {
    cmd: path.join(__dirname, "..", "backend", ".venv", "Scripts", "python.exe"),
    args: [path.join(__dirname, "..", "backend", "run_server.py")],
    env: {},
  };
}

function waitHealth(port, timeoutMs = 60000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else schedule();
      });
      req.on("error", schedule);
    };
    const schedule = () => {
      if (Date.now() - start > timeoutMs) reject(new Error("后端启动超时"));
      else setTimeout(tryOnce, 500);
    };
    tryOnce();
  });
}

function startBackend(port) {
  const { cmd, args, env } = backendCommand();
  backendProc = spawn(cmd, args, {
    env: { ...process.env, ...env, CHEMAGENT_HOST: "127.0.0.1", CHEMAGENT_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProc.stdout.on("data", (d) => console.log("[backend]", String(d).trimEnd()));
  backendProc.stderr.on("data", (d) => console.log("[backend-err]", String(d).trimEnd()));
  backendProc.on("exit", (code, sig) => {
    console.log(`[backend] 已退出 code=${code} sig=${sig}`);
    backendProc = null;
  });
  return waitHealth(port);
}

// ---------- 原生对话框（IPC） ----------
ipcMain.handle("dialog:pickDirectory", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "选择工作区目录",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? "" : r.filePaths[0] ?? "";
});

// ---------- 窗口 ----------
function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "ChemAgent",
    backgroundColor: "#faf9f6", // 默认浅色主题的窗口底色（加载后由前端 data-theme 接管）
    autoHideMenuBar: true,
    // 精致标题栏：隐藏系统标题栏，用自定义渲染（前端顶栏承担拖拽区），原生窗口按钮着主题色
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#faf9f6",
      symbolColor: "#374151",
      height: 48,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // 移除 Electron 默认菜单（File/Edit/View…），UI 更干净
      Menu.setApplicationMenu(null);
      // 清 HTTP 磁盘缓存：本地后端每次发版 hash 都会变，缓存旧页面会导致永远看不到新版 UI
      await session.defaultSession.clearCache();
      const port = await getFreePort(BACKEND_PORT_START);
      await startBackend(port);
      const url = DEV ? "http://localhost:5173" : `http://127.0.0.1:${port}`;
      createWindow(url);
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
      });
    } catch (e) {
      console.error("[main] 启动失败:", e);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (backendProc) {
      try {
        backendProc.kill();
      } catch {
        /* ignore */
      }
    }
  });
}
