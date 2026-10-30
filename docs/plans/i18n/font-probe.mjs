#!/usr/bin/env node
// Reports which installed fonts Chromium uses for sample ko, en, and zh-CN UI text under the current and proposed font stacks.
// Usage: node docs/plans/i18n/font-probe.mjs [path to the playwright package]
import { createRequire } from "node:module";
import { join } from "node:path";

const playwrightDir = process.argv[2] ?? join(process.cwd(), ".claude/skills/verify-video-gen-studio/node_modules/playwright");
const { chromium } = createRequire(join(playwrightDir, "package.json"))("playwright");

const CURRENT = `Inter, ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;
const PROPOSED_ZH = `Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", ui-sans-serif, system-ui, sans-serif`;
const SAMPLES = {
  ko: "생성 설정 · 레퍼런스 추가 · 임시 비밀번호 · 갤러리",
  en: "Generation settings · Add reference · Temporary password · Gallery",
  "zh-CN": "生成设置 · 添加参考图 · 临时密码 · 图库 · 这个模型需要提示词 · 未分配团队",
};
const CASES = [
  ["ko", CURRENT],
  ["en", CURRENT],
  ["zh-CN", CURRENT],
  ["zh-CN", PROPOSED_ZH],
];

const html = `<!doctype html><meta charset="utf-8"><body>${CASES.map(([lang, stack], i) => `<p id="c${i}" lang="${lang}" style='font-family:${stack}'>${SAMPLES[lang]}</p>`).join("")}</body>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html);
const cdp = await page.context().newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
const { root } = await cdp.send("DOM.getDocument");
for (const [i, [lang, stack]] of CASES.entries()) {
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `#c${i}` });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  const label = stack === CURRENT ? "current stack" : "proposed zh-CN stack";
  console.log(`${lang.padEnd(5)} ${label.padEnd(21)} ${fonts.map((f) => `${f.familyName} ${f.glyphCount}`).join(", ")}`);
}
const ZH = {
  "with punctuation": "管理员设置的临时密码已登录。如需继续，请设置只有您自己知道的新密码。其他设备上的登录将全部结束。",
  "no punctuation": "上传的第一张图片决定视频的画面比例如果需要横向视频请上传横向图片并重新生成",
};
for (const [label, text] of Object.entries(ZH)) {
  for (const wordBreak of ["keep-all", "normal"]) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><p lang="zh-CN" style="width:384px;font-size:14px;line-height:20px;word-break:${wordBreak};font-family:${PROPOSED_ZH}">${text}</p>`);
    const { scrollWidth, height } = await page.$eval("p", (p) => ({ scrollWidth: p.scrollWidth, height: p.getBoundingClientRect().height }));
    console.log(`zh-CN ${label.padEnd(16)} in a 384px box, word-break ${wordBreak.padEnd(8)} ${height / 20} lines, scrollWidth ${scrollWidth} ${scrollWidth > 384 ? "OVERFLOWS" : "fits"}`);
  }
}
console.log(`platform ${process.platform} · chromium ${browser.version()}`);
await browser.close();
