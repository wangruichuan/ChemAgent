#!/usr/bin/env node
/**
 * inject.mjs — ChemAgent 适配脚本：把模型生成的 slide 片段注入模板占位符，生成最终 index.html。
 *
 * 用法:
 *   node inject.mjs <模板路径> <输出路径> <slides片段路径> [--title "PPT 标题"]
 *
 * 行为:
 *   1) 用 slides 片段替换从 `<!-- SLIDES_HERE` 到「独立一行的 </div>」之间的全部内容
 *      （模板自带的示例页整段会被替换掉，两个模板结构一致）；
 *   2) 若传 --title，替换 <title>...</title>（模板默认是 "[必填] 替换为 PPT 标题 · Deck Title"）。
 *
 * 纯 Node 内置 API，无第三方依赖；Windows / macOS / Linux 通用。
 */
import fs from "node:fs";

const args = process.argv.slice(2);
let title = null;
const ti = args.indexOf("--title");
if (ti !== -1) {
  title = args[ti + 1];
  args.splice(ti, 2);
}
const [tmplPath, outPath, slidesPath] = args;
if (!tmplPath || !outPath || !slidesPath) {
  console.error('用法: node inject.mjs <模板> <输出> <slides片段> [--title "标题"]');
  process.exit(2);
}
if (!fs.existsSync(tmplPath)) {
  console.error(`模板不存在: ${tmplPath}`);
  process.exit(2);
}
if (!fs.existsSync(slidesPath)) {
  console.error(`slides 片段不存在: ${slidesPath}`);
  process.exit(2);
}

const html = fs.readFileSync(tmplPath, "utf-8");
const slides = fs.readFileSync(slidesPath, "utf-8").trim();

if (!html.includes("SLIDES_HERE")) {
  console.error("模板中未找到 SLIDES_HERE 占位符，拒绝注入");
  process.exit(3);
}

let out;
const fullRe = /<!--\s*SLIDES_HERE[\s\S]*?\n<\/div>\n/;
if (fullRe.test(html)) {
  // 标准结构：SLIDES_HERE 注释 → 示例页 → 独立一行的 </div>（容器关闭）
  out = html.replace(fullRe, () => `${slides}\n</div>\n`);
} else {
  // 兜底：只替换 SLIDES_HERE 注释行本身
  out = html.replace(/<!--\s*SLIDES_HERE[^\n]*\n?/, () => `${slides}\n`);
  console.warn("未匹配到容器关闭 </div>，仅替换了占位注释行，请人工检查输出结构");
}

if (title) {
  out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title.replace(/</g, "&lt;")}</title>`);
}

// 注入后 shader 括号自检（GLSL：剥离注释后 ( 与 ) 必须等量），避免交付带病文件
const shaderErrs = [];
const shaderRe = /const\s+(VS|FS|FS_DARK|FS_LIGHT)\s*=\s*`([^`]*)`/g;
let m;
while ((m = shaderRe.exec(out))) {
  const src = m[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const o = (src.match(/\(/g) || []).length;
  const c = (src.match(/\)/g) || []).length;
  if (o !== c) shaderErrs.push(`${m[1]}: 开括号 ${o} 个 / 闭括号 ${c} 个`);
}
if (shaderErrs.length) {
  console.error(`Shader 检查失败（括号不匹配）:\n${shaderErrs.map((e) => `  - ${e}`).join("\n")}`);
  console.error("提示: 请勿在 slide 片段里写 <script>/WebGL 代码，结构图用 S17 system-diagram 版式。");
  process.exit(4);
}

fs.writeFileSync(outPath, out, "utf-8");
console.log(`OK 注入完成: ${outPath}（${Buffer.byteLength(out, "utf-8")} bytes, slide 片段 ${Buffer.byteLength(slides, "utf-8")} bytes）`);
