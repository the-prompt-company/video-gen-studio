import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "use-intl/core";
import type { ErrorParams } from "@/lib/errors";
import { reasonText, type ErrorTranslator } from "./errors";
import { LOCALES, TIME_ZONE, type Locale } from "./locale";

type Catalog = { errors: Record<string, string> };
const catalog = (locale: Locale) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")) as Catalog;
const CODES = Object.keys(catalog("ko").errors);

function translator(locale: Locale, problems: string[]): ErrorTranslator {
  const t = createTranslator({ locale, messages: catalog(locale), namespace: "errors", timeZone: TIME_ZONE, onError: (e) => problems.push(`${locale}: ${e.message}`) });
  return t as unknown as ErrorTranslator;
}

/** A value for every argument the Korean message takes: a branch name for a select, a count for a plural, a word otherwise. */
function sampleParams(message: string): ErrorParams {
  const params: ErrorParams = {};
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if (el.type === TYPE.select) {
        params[el.value] = Object.keys(el.options)[0];
        for (const option of Object.values(el.options)) walk(option.value);
      } else if (el.type === TYPE.plural) {
        params[el.value] = 2;
        for (const option of Object.values(el.options)) walk(option.value);
      } else if (el.type === TYPE.argument || el.type === TYPE.number) {
        params[el.value] ??= el.type === TYPE.number ? 3 : "X";
      }
    }
  };
  walk(parse(message));
  return params;
}

test("every error code has a message in all three languages that renders with the arguments the Korean one takes", () => {
  assert.ok(CODES.length > 40, `expected the errors namespace to hold the app's codes, found ${CODES.length}`);
  const ko = catalog("ko").errors;
  for (const locale of LOCALES) {
    const problems: string[] = [];
    const t = translator(locale, problems);
    for (const code of CODES) {
      const text = reasonText(t, { code: code as never, params: sampleParams(ko[code]) });
      assert.ok(text.length > 0 && !text.includes("{") && text !== `errors.${code}`, `${locale} ${code}: ${text}`);
    }
    assert.deepEqual(problems, [], `${locale} reported formatting problems`);
  }
});

test("a code the page has no message for reads as unknownCode and names the code, in every language", () => {
  for (const locale of LOCALES) {
    const problems: string[] = [];
    const text = reasonText(translator(locale, problems), { code: "fromANewerServer" as never });
    assert.match(text, /fromANewerServer/, locale);
    assert.equal(text, reasonText(translator(locale, problems), { code: "unknownCode", params: { code: "fromANewerServer" } }));
    assert.deepEqual(problems, [], locale);
  }
});

test("text is shown exactly as given, whatever the page language", () => {
  const problems: string[] = [];
  for (const text of ["Higgsfield 422: prompt is too long", "콘텐츠 정책에 걸려 생성이 거부됐습니다"]) {
    assert.equal(reasonText(translator("zh-CN", problems), { text }), text);
  }
});

test("a server error reads in the page's language with its params", () => {
  const problems: string[] = [];
  assert.equal(reasonText(translator("en", problems), { code: "wrongCredentials" }), "The ID or password is incorrect.");
  assert.match(reasonText(translator("zh-CN", problems), { code: "locked", params: { minutes: 15 } }), /15 分钟/);
  assert.equal(reasonText(translator("ko", problems), { code: "nameTooLong", params: { kind: "teamName", max: 30, length: 31 } }), "팀 이름은 30자까지입니다 (지금 31자)");
  assert.deepEqual(problems, []);
});
