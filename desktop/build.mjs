/**
 * build.mjs — ChemAgent 桌面版一键构建：前端 → 后端 exe → Electron 安装包。
 * 用法: node build.mjs [--skip-frontend] [--skip-backend]
 * 说明: 需要 backend/.venv 已装 PyInstaller、frontend 依赖已装、desktop 依赖已装。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE = process.env.CHEMAGENT_NODE || process.execPath;

const skipFrontend = process.argv.includes("--skip-frontend");
const skipBackend = process.argv.includes("--skip-backend");

function run(desc, cmd, args, cwd) {
  console.log(`\n===== ${desc} =====`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  if (r.status !== 0) {
    console.error(`构建失败: ${desc} (exit=${r.status})`);
    process.exit(r.status || 1);
  }
}

const NPM = path.join(ROOT, "frontend", "node_modules", "vite", "bin", "vite.js");

if (!skipFrontend) {
  console.log("\n[1/3] 构建前端 dist");
  const r = spawnSync(NODE, [NPM, "build"], { cwd: path.join(ROOT, "frontend"), stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

if (!skipBackend) {
  console.log("\n[2/3] PyInstaller 打包后端 exe");
  const py = path.join(ROOT, "backend", ".venv", "Scripts", "python.exe");
  const r = spawnSync(py, [
    "-m", "PyInstaller", "--noconfirm", "--clean", "--name", "chemagent-backend",
    "--collect-all", "uvicorn",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan.on",
    "--add-data", path.join("app", "tools", "skills_store") + ";skills_store",
    "--add-data", path.join("..", "frontend", "dist") + ";frontend_dist",
    "--noconsole",
    "run_server.py",
  ], { cwd: path.join(ROOT, "backend"), stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log("\n[3/3] electron-builder 打包安装包");
const builder = path.join(__dirname, "node_modules", "electron-builder", "out", "cli", "cli.js");
const r = spawnSync(NODE, [builder, "--win"], { cwd: __dirname, stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
if (r.status !== 0) process.exit(r.status || 1);

console.log("\n构建完成！安装包位于 desktop/release/");
