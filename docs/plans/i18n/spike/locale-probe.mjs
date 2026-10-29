#!/usr/bin/env node
// Fetches /login on the spike server with different Accept-Language headers and locale cookies, and prints what rendered.
// Usage: node locale-probe.mjs (after `next start -p 3210` in a copy of the app with spike.diff applied)
const base = "http://localhost:3210/login";
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const cases = [
  ["no header", {}],
  ["Accept-Language en-US", { "accept-language": "en-US,en;q=0.9" }],
  ["Accept-Language zh-TW", { "accept-language": "zh-TW,zh;q=0.9" }],
  ["Accept-Language fr then zh", { "accept-language": "fr-FR,fr;q=0.9,zh-CN;q=0.5" }],
  ["Accept-Language en, cookie ko", { "accept-language": "en-US", cookie: "vgs_locale=ko" }],
  ["cookie zh-CN", { cookie: "vgs_locale=zh-CN" }],
  ["bad cookie", { cookie: "vgs_locale=de" }],
];
for (const [label, headers] of cases) {
  const html = await (await fetch(base, { headers })).text();
  const lang = html.match(/<html lang="([^"]+)"/)?.[1];
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
  const select = html.match(/data-spike="select">([^<]+)</)?.[1];
  const plural = html.match(/data-spike="plural">(.*?)<\/p>/)?.[1]?.replace(/<!-- -->/g, "");
  console.log(`${label.padEnd(30)} lang=${lang} title="${title}" h1="${h1}" select="${select}" plural="${plural}"`);
}
