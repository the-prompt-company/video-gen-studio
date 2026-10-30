import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCatalogs, type Problem } from "./check";
import ko from "../messages/ko.json";
import en from "../messages/en.json";
import zhCN from "../messages/zh-CN.json";

const clean = {
  ko: { auth: { title: "로그인", hint: "{min, plural, other {#자 이상}}" }, nav: { logout: "로그아웃" } },
  en: { auth: { title: "Sign in", hint: "{min, plural, one {At least # character} other {At least # characters}}" }, nav: { logout: "Log out" } },
  "zh-CN": { auth: { title: "登录", hint: "{min, plural, other {至少 # 个字符}}" }, nav: { logout: "退出登录" } },
};

function withMessage(locale: keyof typeof clean, path: string[], value: unknown) {
  const copy = structuredClone(clean) as Record<string, Record<string, Record<string, unknown>>>;
  const [ns, key] = path;
  copy[locale][ns] = { ...copy[locale][ns], [key]: value };
  return copy;
}

const rulesFor = (problems: Problem[], key: string) => problems.filter((p) => p.key === key).map((p) => `${p.locale} ${p.rule}`);

test("three matching catalogs pass", () => {
  assert.deepEqual(checkCatalogs(clean), []);
});

test("a key only in Korean fails for each locale that lacks it", () => {
  const problems = checkCatalogs(withMessage("ko", ["nav", "settings"], "설정"));
  assert.deepEqual(rulesFor(problems, "nav.settings").sort(), ["en missing", "zh-CN missing"]);
});

test("a key Korean does not have fails as extra", () => {
  const problems = checkCatalogs(withMessage("en", ["nav", "help"], "Help"));
  assert.deepEqual(rulesFor(problems, "nav.help"), ["en extra"]);
});

test("a translation that drops an argument fails with the key named", () => {
  const problems = checkCatalogs(withMessage("en", ["auth", "hint"], "At least 8 characters"));
  assert.deepEqual(rulesFor(problems, "auth.hint"), ["en arguments"]);
});

test("a translation that renames an argument or changes its kind fails", () => {
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("zh-CN", ["auth", "hint"], "至少 {max} 个字符")), "auth.hint"), ["zh-CN arguments"]);
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("zh-CN", ["auth", "hint"], "至少 {min} 个字符")), "auth.hint"), ["zh-CN arguments"]);
});

test("a rich-text tag counts as an argument", () => {
  const catalogs = withMessage("ko", ["auth", "title"], "<b>로그인</b>");
  assert.deepEqual(rulesFor(checkCatalogs(catalogs), "auth.title").sort(), ["en arguments", "zh-CN arguments"]);
});

test("a Korean particle that depends on the value's last syllable fails after an open value", () => {
  for (const message of ["{name}을 껐습니다", "{name}를 껐습니다", "{model}이 없습니다", "{team}과 함께", "{count, number}로 바꿈", "{n}은"]) {
    const problems = checkCatalogs(withMessage("ko", ["nav", "logout"], message));
    assert.ok(rulesFor(problems, "nav.logout").includes("ko particle"), message);
  }
});

test("Korean that reads right after any value passes the particle rule", () => {
  for (const message of ["{model}에는 없습니다", "모델 {model}", "{count}개", "{n}가지", "{kind, select, image {이미지를} other {영상을}} 넣으세요", "{count, plural, other {이미지 #장을}} 넣으세요"]) {
    const problems = checkCatalogs(withMessage("ko", ["nav", "logout"], message));
    assert.ok(!rulesFor(problems, "nav.logout").includes("ko particle"), message);
  }
});

test("Hangul left in English or Chinese fails", () => {
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("en", ["nav", "logout"], "로그아웃")), "nav.logout"), ["en hangul"]);
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("zh-CN", ["nav", "logout"], "退出 로그아웃")), "nav.logout"), ["zh-CN hangul"]);
});

test("a message that does not parse as ICU fails", () => {
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("en", ["auth", "title"], "Sign {in")), "auth.title"), ["en syntax"]);
});

test("a value that is not a string or a namespace fails", () => {
  assert.deepEqual(rulesFor(checkCatalogs(withMessage("en", ["auth", "title"], 3)), "auth.title"), ["en syntax"]);
});

test("the committed message files pass", () => {
  assert.deepEqual(checkCatalogs({ ko, en, "zh-CN": zhCN }), []);
});
