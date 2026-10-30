#!/usr/bin/env node
// Counts the Korean strings in a checkout of this app by file, kind, and tag.
// Usage: node docs/plans/i18n/inventory.mjs [root] [--files | --list <kind, tag, or area> | --json <out.json>]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const listWhat = flag("--list");
const listFiles = args.includes("--files");
if (listFiles) args.splice(args.indexOf("--files"), 1);
const jsonOut = flag("--json");
const root = args[0] ?? process.cwd();

function loadTypeScript() {
  for (const from of [join(root, "package.json"), import.meta.url]) {
    try {
      return createRequire(from)("typescript");
    } catch {}
  }
  throw new Error("typescript not found next to the root or this script");
}
const ts = loadTypeScript();

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-verify", ".verify", ".git", "worktrees"]);
const CODE_EXT = /\.(ts|tsx|mts|mjs|js)$/;
const HARNESS = ".claude/skills/verify-video-gen-studio/";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root)
  .map((p) => relative(root, p).split(sep).join("/"))
  .filter((f) => (f.startsWith("src/") || f.startsWith("scripts/") || f.startsWith(HARNESS)) && (CODE_EXT.test(f) || (f.startsWith(HARNESS) && f.endsWith(".md"))))
  .filter((f) => !f.startsWith("src/messages/"));

function areaOf(file, text) {
  if (file.startsWith(HARNESS)) return file.endsWith(".md") ? "harness-doc" : "harness";
  if (file.startsWith("scripts/")) return "script";
  if (/\.test\.[mc]?tsx?$/.test(file)) return "test";
  if (file.startsWith("src/app/api/")) return "api-route";
  if (/^\s*["']use client["']/.test(text)) return "client-component";
  if (file.endsWith(".tsx")) return "server-component";
  return "lib";
}

const USER_VISIBLE_AREAS = new Set(["client-component", "server-component", "api-route", "lib"]);
const SURFACES = [
  ["auth", /^src\/(components\/(LoginForm|PasswordChangeForm)|app\/(login\/|page\.tsx|layout\.tsx)|lib\/credentials)/],
  ["shell", /^src\/(components\/(Nav|Avatar|Modal|ui|StatusBadge)|app\/\(app\)\/layout|lib\/(format|generation-status)\.ts)/],
  ["playground", /^src\/(components\/Playground|app\/\(app\)\/playground|lib\/catalog)/],
  ["gallery", /^src\/(components\/Gallery|app\/\(app\)\/gallery)/],
  ["dashboard", /^src\/(components\/Usage|app\/\(app\)\/dashboard|lib\/stats)/],
  ["settings", /^src\/(components\/ProfileEditor|app\/\(app\)\/settings|lib\/(nickname|display-name))/],
  ["admin", /^src\/(components\/admin\/|app\/\(app\)\/admin|lib\/(member-|model-settings|teams|team-store))/],
  ["server", /^src\/(app\/api\/|lib\/)/],
];
const surfaceOf = (file) => SURFACES.find(([, re]) => re.test(file))?.[0] ?? "other";
const NAMED_ATTRS = new Set(["aria-label", "placeholder", "title", "alt"]);
const SELECTOR_CALLS = /^(getByLabel|getByRole|getByText|getByPlaceholder|getByTitle|getByAltText|locator|filter|waitForSelector|hasText|toHaveText|toContainText)$/;
const COUNTER = /^(개|장|건|명|초|회|행|자|일|분|시간|번|주|개월|년|원|달러)/;
const PARTICLE = /^(은|는|이|가|을|를|과|와|으로|로|이나|나|이라|라|이랑|랑)(?=[\s.,!?)\]'"·:]|$)/;
const FALLBACK_PARTICLE = /[가-힣a-zA-Z0-9}]\((은|는|이|가|을|를|과|와|으로|이)\)/;
const RELATIVE_TIME = /(초|분|시간|일|주|개월|년)\s*(전|후|남음|뒤)/;
const FORMAT_FNS = new Set(["usd", "fmtDate", "fmtRelative", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "toFixed", "DateTimeFormat", "NumberFormat", "RelativeTimeFormat", "PluralRules"]);

const calleeName = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
};
const calleeObject = (call) => {
  const e = call.expression;
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) ? e.expression.text : "";
};

function contextKind(node, area) {
  if (area === "test") return "test";
  if (area === "script") return "script";
  for (let p = node.parent, child = node; p; child = p, p = p.parent) {
    if (ts.isLiteralTypeNode(p)) return "type-literal";
    if (ts.isJsxAttribute(p)) {
      const name = p.name.getText();
      return NAMED_ATTRS.has(name) ? `attr:${name}` : "attr:other-prop";
    }
    if (ts.isNewExpression(p) && ts.isIdentifier(p.expression)) {
      if (p.expression.text === "HttpError") return "http-error";
      if (p.expression.text === "Error") return area.startsWith("harness") ? "harness-other" : "thrown-error";
    }
    if (ts.isCallExpression(p) && child !== p.expression) {
      const name = calleeName(p);
      const obj = calleeObject(p);
      if (obj === "console") return "log";
      if (area.startsWith("harness")) {
        if (SELECTOR_CALLS.test(name)) return "harness-selector";
        continue;
      }
      if (name === "json" && (obj === "Response" || obj === "NextResponse")) return "api-response";
      if (/^set[A-Z]/.test(name) || name === "alert" || name === "confirm") return "ui-message";
    }
    if (ts.isJsxExpression(p) && p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) return "jsx-expression";
    if (ts.isVariableDeclaration(p) && p.name.getText() === "metadata") return "metadata";
    if (ts.isFunctionDeclaration(p) && p.name?.text === "generateMetadata") return "metadata";
  }
  if (area.startsWith("harness")) return "harness-other";
  return "code-string";
}

function literalParts(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, after: [] };
  const after = node.templateSpans.map((s) => s.literal.text);
  return { text: [node.head.text, ...after].join("{…}"), after };
}

const insideParticleHelper = (node) => {
  for (let p = node.parent; p && !ts.isBlock(p); p = p.parent) if (ts.isCallExpression(p) && /particle|josa/i.test(calleeName(p))) return true;
  return false;
};

function tagsOf(text, after, node) {
  const tags = [];
  if (after.length) tags.push("interpolated");
  if (after.some((a) => COUNTER.test(a.trimStart()))) tags.push("count");
  if (after.some((a) => PARTICLE.test(a)) || FALLBACK_PARTICLE.test(text) || insideParticleHelper(node)) tags.push("particle");
  if (RELATIVE_TIME.test(text)) tags.push("relative-time");
  return tags;
}

const items = [];
const formatCalls = [];
const harnessDocLines = {};

for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  const area = areaOf(file, text);
  if (area === "harness-doc") {
    harnessDocLines[file] = text.split("\n").filter((l) => HANGUL.test(l)).length;
    continue;
  }
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".mjs") || file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = ts.isCallExpression(node) ? calleeName(node) : ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      if (FORMAT_FNS.has(name) && USER_VISIBLE_AREAS.has(area)) formatCalls.push({ file, line: line(node), fn: name });
    }
    if (ts.isJsxText(node) && HANGUL.test(node.text)) {
      const parent = node.parent;
      const rich = (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) && parent.children.some((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      const interp = (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) && parent.children.some((c) => ts.isJsxExpression(c) && c.expression);
      const tags = [...(interp ? ["interpolated"] : []), ...(rich ? ["rich"] : [])];
      const t = node.text.replace(/\s+/g, " ").trim();
      if (RELATIVE_TIME.test(t)) tags.push("relative-time");
      if (COUNTER.test(t)) tags.push("count");
      if (PARTICLE.test(t)) tags.push("particle");
      items.push({ file, line: line(node), area, kind: "jsx-text", tags, text: t });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const { text: t, after } = literalParts(node);
      if (HANGUL.test(t)) {
        if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return;
        items.push({ file, line: line(node), area, kind: contextKind(node, area), tags: tagsOf(t, after, node), text: t });
      }
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const userVisible = items.filter((i) => USER_VISIBLE_AREAS.has(i.area) && i.kind !== "log");
for (const it of items.filter((i) => i.area === "harness" || i.area === "script")) {
  const needle = it.text.split("{…}").reduce((a, b) => (b.length > a.length ? b : a), "").trim();
  if (needle.length >= 2 && userVisible.some((u) => u.text.includes(needle))) it.tags.push("copy-dependent");
}

const count = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) for (const k of [keyFn(r)].flat()) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};
const table = (rows, head) => [head, ...rows.map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`)].join("\n");
const uniq = (rows) => new Set(rows.map((r) => r.text)).size;
const hangulChars = (rows) => [...new Set(rows.map((r) => r.text))].join("").match(/[가-힣]/g)?.length ?? 0;

if (listWhat) {
  for (const it of items.filter((i) => i.kind === listWhat || i.tags.includes(listWhat) || i.area === listWhat)) {
    console.log(`${it.file}:${it.line}  [${it.kind}${it.tags.length ? " " + it.tags.join(",") : ""}]  ${it.text}`);
  }
  process.exit(0);
}

const fileTotals = count(userVisible, (r) => r.file);
if (listFiles) {
  for (const [file, n] of [...fileTotals].sort((a, b) => surfaceOf(a[0]).localeCompare(surfaceOf(b[0])) || b[1] - a[1])) console.log(`${surfaceOf(file).padEnd(11)} ${String(n).padStart(4)}  ${file}`);
  process.exit(0);
}
const out = [
  `${files.length} files scanned · ${items.length} Korean strings`,
  "",
  `User-visible strings (src/, not tests, not console): ${userVisible.length} occurrences, ${uniq(userVisible)} unique texts, ${hangulChars(userVisible)} Hangul syllables in the unique texts, across ${fileTotals.length} files.`,
  "",
  table(count(userVisible, (r) => r.kind), "By kind (user-visible):"),
  "",
  table(count(userVisible, (r) => r.area), "By area (user-visible):"),
  "",
  table(
    count(userVisible, (r) => surfaceOf(r.file)).map(([s, n]) => [`${s.padEnd(11)} ${String(uniq(userVisible.filter((r) => surfaceOf(r.file) === s))).padStart(4)} unique  ${new Set(userVisible.filter((r) => surfaceOf(r.file) === s).map((r) => r.file)).size} files`, n]),
    "By surface (user-visible occurrences, unique texts, files):",
  ),
  "",
  table(count(userVisible.filter((r) => r.tags.length), (r) => r.tags), "Tags (user-visible, a string can carry several):"),
  "",
  table(fileTotals.slice(0, 20), "Top 20 files (user-visible occurrences):"),
  "",
  table(count(formatCalls, (r) => r.fn), "Format calls in src/ outside tests (dates, numbers, currency):"),
  "",
  table(count(items.filter((r) => !USER_VISIBLE_AREAS.has(r.area) || r.kind === "log"), (r) => `${r.area} / ${r.kind}`), "Not user-visible:"),
  "",
  table(count(items.filter((r) => r.area === "harness"), (r) => r.file), "Harness journeys (all Korean strings):"),
  "",
  `Harness selectors that name Korean UI text: ${items.filter((r) => r.kind === "harness-selector").length}. Harness and script strings that match src/ copy: ${items.filter((r) => r.tags.includes("copy-dependent")).length}.`,
  "",
  table(Object.entries(harnessDocLines).sort((a, b) => b[1] - a[1]), "Harness docs (lines with Hangul):"),
];
console.log(out.join("\n"));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ items, formatCalls }, null, 1));
