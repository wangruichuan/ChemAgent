/* 桌面版打包（electron-builder JS API 封装，输出到文件避免 stdout 缓冲丢失） */
const { build } = require("electron-builder");

async function main() {
  console.log("开始构建…");
  await build({ win: ["nsis"] });
  console.log("BUILD DONE");
}

main().catch((e) => {
  console.error("BUILD FAILED:", e);
  process.exit(1);
});
