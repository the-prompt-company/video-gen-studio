#!/usr/bin/env node
// Sums the script bytes /login loads on http://localhost:3210 for a ko-KR and an en-US browser, and counts console errors.
// Usage: node page-js.mjs <label> [path to the playwright package]
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const playwrightDir = process.argv[3] ?? join(process.cwd(), ".claude/skills/verify-video-gen-studio/node_modules/playwright");
const { chromium } = createRequire(join(playwrightDir, "package.json"))("playwright");
const label = process.argv[2] ?? "";
const browser = await chromium.launch({ headless: true });
for (const locale of ["ko-KR", "en-US"]) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const scripts = [];
  page.on("response", async (r) => {
    if (r.request().resourceType() === "script") scripts.push(r.body().then((b) => b).catch(() => Buffer.alloc(0)));
  });
  await page.goto("http://localhost:3210/login", { waitUntil: "networkidle" });
  const bodies = await Promise.all(scripts);
  const raw = bodies.reduce((a, b) => a + b.length, 0);
  const gz = bodies.reduce((a, b) => a + gzipSync(b).length, 0);
  const h1 = await page.locator("h1").textContent();
  const flight = await page.evaluate(() => [...document.scripts].filter((s) => s.textContent.includes("self.__next_f")).reduce((a, s) => a + s.textContent.length, 0));
  console.log(`${label.padEnd(22)} ${locale} h1="${h1}" scripts ${bodies.length} · ${(raw / 1024).toFixed(1)} KB raw · ${(gz / 1024).toFixed(1)} KB gzip · inline flight ${(flight / 1024).toFixed(1)} KB · console errors ${errors.length}${errors.length ? " " + errors[0].slice(0, 120) : ""}`);
  await context.close();
}
await browser.close();
