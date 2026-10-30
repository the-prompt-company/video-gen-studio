#!/usr/bin/env node
// Measures the client JS that next-intl adds, with and without message precompilation, against a minimal in-house t().
// Setup, in an empty folder outside the repo:
//   npm init -y && npm install --ignore-scripts next-intl@4.14.9 react@19.3.0 react-dom@19.3.0 next@16.4.3
// Usage, from web/: node docs/plans/i18n/bundle-measure.mjs <that folder>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const pkgRoot = process.argv[2];
const nm = join(pkgRoot, "node_modules");
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"))("esbuild");
const manifest = (name) => JSON.parse(readFileSync(join(nm, name, "package.json"), "utf8"));

const du = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((a, n) => a + du(join(p, n)), 0) : statSync(p).size);
const closure = new Set();
const visit = (name) => {
  if (closure.has(name) || ["next", "react", "react-dom"].includes(name)) return;
  let m;
  try {
    m = manifest(name);
  } catch {
    return;
  }
  closure.add(name);
  for (const d of Object.keys({ ...m.dependencies, ...m.optionalDependencies })) visit(d);
};
visit("next-intl");
const footprint = [...closure].map((n) => [n, du(join(nm, n))]).sort((a, b) => b[1] - a[1]);
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
console.log(`next-intl ${manifest("next-intl").version} · use-intl ${manifest("use-intl").version} · intl-messageformat ${manifest("intl-messageformat").version}`);
console.log(`install footprint of next-intl and its dependencies: ${mb(footprint.reduce((a, [, b]) => a + b, 0))} in ${footprint.length} packages; largest ${footprint.slice(0, 4).map(([n, b]) => `${n} ${mb(b)}`).join(", ")}`);

const entries = join(pkgRoot, "entries");
mkdirSync(entries, { recursive: true });
writeFileSync(join(entries, "next-intl.js"), `export { NextIntlClientProvider, useTranslations, useFormatter } from "next-intl";\n`);
writeFileSync(
  join(entries, "in-house.js"),
  `import { createContext, useContext } from "react";
const Ctx = createContext(null);
export const I18nProvider = Ctx.Provider;
const get = (o, k) => k.split(".").reduce((a, p) => a?.[p], o);
export function useT(ns) {
  const { locale, messages } = useContext(Ctx);
  const plural = new Intl.PluralRules(locale);
  return (key, params = {}) => {
    let m = get(messages, ns ? ns + "." + key : key);
    if (m && typeof m === "object") m = m[plural.select(Number(params.count))] ?? m.other;
    return String(m ?? key).replace(/\\{(\\w+)\\}/g, (_, p) => (p in params ? String(params[p]) : "{" + p + "}"));
  };
}
`,
);

const cases = [
  ["next-intl, runtime ICU parser", "next-intl.js"],
  ["next-intl, precompile: true", "next-intl.js", { "use-intl/format-message": "use-intl/format-message/format-only" }],
  ["in-house t() with Intl.PluralRules", "in-house.js"],
];
for (const [label, entry, alias] of cases) {
  const r = await esbuild.build({
    entryPoints: [join(entries, entry)],
    ...(alias ? { alias } : {}),
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    write: false,
    external: ["react", "react-dom", "react/jsx-runtime", "next", "next/*"],
    nodePaths: [nm],
    absWorkingDir: pkgRoot,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const code = r.outputFiles[0].contents;
  console.log(`${label.padEnd(36)} ${(code.length / 1024).toFixed(1).padStart(5)} KB minified ${(gzipSync(code).length / 1024).toFixed(1).padStart(5)} KB gzip`);
}
