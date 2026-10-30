#!/usr/bin/env node
// What one signed-in page costs the browser on first load: the scripts its HTML names (raw and gzip) and the React
// Flight payload inlined in self.__next_f.push(...) (raw UTF-8). Byte counts of a `next start` build are deterministic,
// so one round per build is enough.
// Usage, from web/ with .env.local naming ADMIN_USERNAME and ADMIN_PASSWORD:
//   node docs/plans/i18n/page-bytes.mjs <base url> <accept-language> <page> [page...]   (pages with or without the leading /)
// e.g. node docs/plans/i18n/page-bytes.mjs http://localhost:3500 ko-KR gallery dashboard playground
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [base, language, ...names] = process.argv.slice(2);
if (!base || !language || names.length === 0) throw new Error("usage: page-bytes.mjs <base url> <accept-language> <page> [page...]");
const pages = names.map((n) => `/${n.replace(/^\/+/, "")}`);
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "accept-language": language },
  body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
});
if (!login.ok) throw new Error(`login answered ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const kb = (n) => (n / 1024).toFixed(1).padStart(7);
const scriptCache = new Map();
async function scriptBytes(src) {
  if (!scriptCache.has(src)) {
    const body = Buffer.from(await (await fetch(new URL(src, base))).arrayBuffer());
    scriptCache.set(src, { raw: body.length, gzip: gzipSync(body).length });
  }
  return scriptCache.get(src);
}

console.log(`${base} · Accept-Language ${language} · KB = 1024 bytes`);
// `mock` counts "[목업]" in the flight, so a run on a database without the mock rows shows up as 0.
console.log(`${"page".padEnd(14)} ${"scripts".padStart(7)} ${"raw".padStart(7)} ${"gzip".padStart(7)} ${"flight".padStart(7)} ${"mock".padStart(5)}  lang`);
for (const page of pages) {
  const res = await fetch(`${base}${page}`, { headers: { cookie, "accept-language": language }, redirect: "manual" });
  if (res.status !== 200) throw new Error(`${page} answered ${res.status}`);
  const html = await res.text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
  let raw = 0;
  let gzip = 0;
  for (const src of srcs) {
    const b = await scriptBytes(src);
    raw += b.raw;
    gzip += b.gzip;
  }
  let flight = 0;
  let mock = 0;
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    const [kind, payload] = JSON.parse(m[1]);
    if (kind !== 1 || typeof payload !== "string") continue;
    flight += Buffer.byteLength(payload, "utf8");
    mock += payload.split("[목업]").length - 1;
  }
  const lang = /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1] ?? "?";
  console.log(`${page.padEnd(14)} ${String(srcs.length).padStart(7)} ${kb(raw)} ${kb(gzip)} ${kb(flight)} ${String(mock).padStart(5)}  ${lang}`);
}
