import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locale";

export type Rule = "missing" | "extra" | "syntax" | "arguments" | "particle" | "hangul" | "empty";
export type Problem = { locale: Locale; key: string; rule: Rule; detail: string };

const HANGUL = /[가-힣ㄱ-ㆎ]/;

/**
 * Korean particles whose form depends on whether the previous syllable ends in a consonant (을/를, 이/가, 은/는, 과/와,
 * 으로/로, 이나/나, 이랑/랑). After an open value such as a name or a number, nobody can pick the right form, so the
 * message must be rephrased or turned into a select. A particle counts only when no other syllable follows it.
 */
const PARTICLE = /^(?:을|를|이|가|은|는|과|와|으로|로|이나|나|이랑|랑)(?![가-힣])/;

const OPEN_VALUE = new Set<TYPE>([TYPE.argument, TYPE.number, TYPE.pound]);

function leaves(tree: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) return out;
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
    else out.set(key, v);
  }
  return out;
}

function walk(elements: MessageFormatElement[], visit: (el: MessageFormatElement, next: MessageFormatElement | undefined) => void) {
  elements.forEach((el, i) => {
    visit(el, elements[i + 1]);
    if (el.type === TYPE.select || el.type === TYPE.plural) for (const option of Object.values(el.options)) walk(option.value, visit);
    if (el.type === TYPE.tag) walk(el.children, visit);
  });
}

/** Every argument and rich-text tag a message takes, as `name:kind`, so a translation must take the same ones. */
function argumentsOf(elements: MessageFormatElement[]): string[] {
  const found = new Set<string>();
  walk(elements, (el) => {
    if (el.type !== TYPE.literal && el.type !== TYPE.pound) found.add(`${el.value}:${TYPE[el.type]}`);
  });
  return [...found].sort();
}

/** Precompiled messages format a message that comes out as nothing to an empty array, and next-intl then shows the key. */
function canBeEmpty(elements: MessageFormatElement[]): boolean {
  return elements.every((el) =>
    el.type === TYPE.literal ? el.value === "" : (el.type === TYPE.select || el.type === TYPE.plural) && Object.values(el.options).some((o) => canBeEmpty(o.value)),
  );
}

function particleAfterValue(elements: MessageFormatElement[]): string | null {
  let hit: string | null = null;
  walk(elements, (el, next) => {
    if (hit || !OPEN_VALUE.has(el.type) || next?.type !== TYPE.literal) return;
    const particle = PARTICLE.exec(next.value)?.[0];
    if (particle) hit = `${el.type === TYPE.pound ? "#" : `{${(el as { value: string }).value}}`}${particle}`;
  });
  return hit;
}

export function checkCatalogs(catalogs: Record<Locale, unknown>): Problem[] {
  const problems: Problem[] = [];
  const parsed = {} as Record<Locale, Map<string, MessageFormatElement[]>>;
  for (const locale of LOCALES) {
    parsed[locale] = new Map();
    for (const [key, value] of leaves(catalogs[locale])) {
      if (typeof value !== "string") {
        problems.push({ locale, key, rule: "syntax", detail: `expected a message string, found ${JSON.stringify(value)}` });
        continue;
      }
      try {
        const elements = parse(value);
        parsed[locale].set(key, elements);
        if (canBeEmpty(elements)) problems.push({ locale, key, rule: "empty", detail: "can render as nothing, which shows the key on screen; give every branch text or leave the message out" });
      } catch (e) {
        problems.push({ locale, key, rule: "syntax", detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (locale !== DEFAULT_LOCALE && HANGUL.test(value)) problems.push({ locale, key, rule: "hangul", detail: value });
    }
  }

  const source = parsed[DEFAULT_LOCALE];
  for (const [key, elements] of source) {
    const particle = particleAfterValue(elements);
    if (particle) problems.push({ locale: DEFAULT_LOCALE, key, rule: "particle", detail: `"${particle}" depends on the value's last syllable; rephrase or use select` });
  }

  const sourceKeys = new Set(leaves(catalogs[DEFAULT_LOCALE]).keys());
  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    const keys = new Set(leaves(catalogs[locale]).keys());
    for (const key of sourceKeys) if (!keys.has(key)) problems.push({ locale, key, rule: "missing", detail: `in ${DEFAULT_LOCALE}.json only` });
    for (const key of keys) if (!sourceKeys.has(key)) problems.push({ locale, key, rule: "extra", detail: `not in ${DEFAULT_LOCALE}.json` });
    for (const [key, elements] of parsed[locale]) {
      const want = source.get(key);
      if (!want) continue;
      const [expected, actual] = [argumentsOf(want).join(", "), argumentsOf(elements).join(", ")];
      if (expected !== actual) problems.push({ locale, key, rule: "arguments", detail: `${DEFAULT_LOCALE} takes [${expected}], ${locale} takes [${actual}]` });
    }
  }
  return problems;
}
