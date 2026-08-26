/* 通过 electron-builder CLI 模块触发完整构建（win: nsis） */
process.argv = [process.argv[0], "cli.js", "--win"];
require("./node_modules/electron-builder/out/cli/cli.js");
