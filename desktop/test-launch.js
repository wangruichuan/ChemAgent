/* 验证 Electron 主进程的核心逻辑：spawn 后端 exe + CHEMAGENT_DATA + health 轮询 + 静态托管。
   等价于 main.js 的 startBackend + waitHealth 路径（不含 BrowserWindow）。 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const resourcesPath = path.join(__dirname, "release", "win-unpacked", "resources");
const exe = path.join(resourcesPath, "backend", "chemagent-backend.exe");
const port = 8123;
const dataDir = path.join(__dirname, "release", "_test_data");

const child = spawn(exe, [], {
  env: {
    ...process.env,
    CHEMAGENT_HOST: "127.0.0.1",
    CHEMAGENT_PORT: String(port),
    CHEMAGENT_DATA: dataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stdout.write("[backend] " + String(d).trimEnd() + "\n"));
child.stderr.on("data", (d) => process.stdout.write("[backend-err] " + String(d).trimEnd() + "\n"));
child.on("exit", (c) => console.log("[backend] exited", c));

const url = `http://127.0.0.1:${port}/api/health`;
const start = Date.now();
function tick() {
  if (Date.now() - start > 60000) {
    console.log("TIMEOUT waiting backend");
    child.kill();
    process.exit(1);
  }
  http
    .get(url, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log("HEALTH OK ->", res.statusCode);
        http
          .get(`http://127.0.0.1:${port}/`, (res2) => {
            res2.resume();
            console.log("GET / ->", res2.statusCode, "(200 = 前端托管正常)");
            console.log("DATA DIR ->", dataDir);
            child.kill();
            process.exit(0);
          })
          .on("error", (e) => {
            console.log("GET / error", e.message);
            child.kill();
            process.exit(1);
          });
      } else {
        setTimeout(tick, 500);
      }
    })
    .on("error", () => setTimeout(tick, 500));
}
tick();
