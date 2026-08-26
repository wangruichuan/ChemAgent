#!/usr/bin/env node
/**
 * build.mjs — ChemAgent 一键构建：复制模板 → 注入 slide 片段 → shader 括号自检 → Swiss 校验。
 *
 * 用法:
 *   node build.mjs --style swiss --out ppt/index.html --slides ppt/_slides.html --title "PPT 标题"
 *
 * 参数:
 *   --style a|magazine|b|swiss   风格（默认 swiss；a/magazine = 电子杂志风, b/swiss = 瑞士国际主义风）
 *   --out  <输出路径>           最终文件（默认 ppt/index.html，相对当前 cwd）
 *   --slides <片段路径>         模型生成的 <section> 片段文件（必填）
 *   --title <标题>              PPT 标题（替换 <title>）
 *   --template <模板绝对路径>    显式指定模板（覆盖 --style）
 *
 * 步骤: [1/4] 复制模板 → [2/4] 注入片段 → [3/4] shader 括号自检 → [4/4] Swiss 校验(仅 b/swiss)
 * 任一环节失败会给出明确错误并退出非 0，避免交付带病文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function opt(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const style = (opt("--style") || "swiss").toLowerCase();
const out = opt("--out") || "ppt/index.html";
const slides = opt("--slides");
const title = opt("--title");
const template = opt("--template");

if (!slides) {
  console.error('用法: node build.mjs --style swiss --out ppt/index.html --slides ppt/_slides.html --title "标题" [--template 模板绝对路径]');
  process.exit(2);
}
if (!fs.existsSync(slides)) {
  console.error(`slides 片段不存在: ${slides}`);
  process.exit(2);
}

const TPL = {
  a: path.join(skillRoot, "assets", "template.html"),
  magazine: path.join(skillRoot, "assets", "template.html"),
  b: path.join(skillRoot, "assets", "template-swiss.html"),
  swiss: path.join(skillRoot, "assets", "template-swiss.html"),
};
const tplPath = template || TPL[style];
if (!tplPath || !fs.existsSync(tplPath)) {
  console.error(`找不到模板: ${tplPath}（检查 --style 或 --template）`);
  process.exit(2);
}

// [1/4] 复制模板 + 建 images 目录
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.mkdirSync(path.join(path.dirname(path.resolve(out)), "images"), { recursive: true });
fs.copyFileSync(tplPath, out);
console.log(`[1/4] 模板已复制 → ${out}（images/ 目录已就绪）`);

// [2/4] 注入 slide 片段
const html = fs.readFileSync(out, "utf-8");
const slidesContent = fs.readFileSync(slides, "utf-8").trim();
if (!html.includes("SLIDES_HERE")) {
  console.error("模板中未找到 SLIDES_HERE 占位符，拒绝注入");
  process.exit(3);
}
const fullRe = /<!--\s*SLIDES_HERE[\s\S]*?\n<\/div>\n/;
const injected = fullRe.test(html)
  ? html.replace(fullRe, () => `${slidesContent}\n</div>\n`)
  : html.replace(/<!--\s*SLIDES_HERE[^\n]*\n?/, () => `${slidesContent}\n`);
const finalHtml = title
  ? injected.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title.replace(/</g, "&lt;")}</title>`)
  : injected;
fs.writeFileSync(out, finalHtml, "utf-8");
console.log("[2/4] slide 片段已注入");

// [3/4] shader 括号自检（GLSL：剥离注释后 ( 与 ) 必须等量）
const shaderErrs = [];
const shaderRe = /const\s+(VS|FS|FS_DARK|FS_LIGHT)\s*=\s*`([^`]*)`/g;
let m;
while ((m = shaderRe.exec(finalHtml))) {
  const src = m[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const o = (src.match(/\(/g) || []).length;
  const c = (src.match(/\)/g) || []).length;
  if (o !== c) shaderErrs.push(`${m[1]}: 开括号 ${o} 个 / 闭括号 ${c} 个`);
}
if (shaderErrs.length) {
  console.error(`[3/4] Shader 检查失败（括号不匹配）:\n${shaderErrs.map((e) => `  - ${e}`).join("\n")}`);
  console.error("提示: 请勿在 slide 片段里写 <script>/WebGL 代码，结构图用 S17 system-diagram 版式。");
  process.exit(4);
}
console.log("[3/4] shader 括号检查通过");

// [4/4] Swiss 校验（仅 b/swiss 风格）
if (style === "b" || style === "swiss") {
  const res = spawnSync(
    process.execPath,
    [path.join(__dirname, "validate-swiss-deck.mjs"), path.resolve(out)],
    { encoding: "utf-8" }
  );
  if (res.status === 0) {
    console.log("[4/4] Swiss 版式校验通过");
  } else {
    process.stdout.write(res.stdout || "");
    process.stderr.write(res.stderr || "");
    console.error("[4/4] Swiss 版式校验失败，请修正 slide 片段后重跑");
    process.exit(5);
  }
}

console.log(`完成: ${out}`);
