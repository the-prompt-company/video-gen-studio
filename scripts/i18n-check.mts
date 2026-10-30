// Checks that src/messages/{ko,en,zh-CN}.json agree: same keys, same arguments, parseable ICU, no Hangul outside
// ko.json, and no Korean particle that depends on an open value. Usage, from web/: npm run i18n:check
import { readFileSync } from "node:fs";
import { checkCatalogs } from "../src/i18n/check";
import { LOCALES, type Locale } from "../src/i18n/locale";

const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [locale, JSON.parse(readFileSync(new URL(`../src/messages/${locale}.json`, import.meta.url), "utf8"))]),
) as Record<Locale, unknown>;
const problems = checkCatalogs(catalogs);
for (const p of problems) console.error(`${p.locale}.json  ${p.key}  ${p.rule}: ${p.detail}`);
const keys = (tree: unknown): number =>
  tree !== null && typeof tree === "object" ? Object.values(tree).reduce<number>((n, v) => n + keys(v), 0) : 1;
console.log(problems.length ? `i18n:check failed with ${problems.length} problem(s)` : `i18n:check passed: ${keys(catalogs.ko)} keys in ${LOCALES.join(", ")}`);
process.exitCode = problems.length ? 1 : 0;
