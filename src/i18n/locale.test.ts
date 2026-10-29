import { test } from "node:test";
import assert from "node:assert/strict";
import { fromAcceptLanguage, localeAfterSignIn, parseLocale, resolveLocale } from "./locale";

test("a member's stored language beats the cookie and the browser", () => {
  assert.equal(resolveLocale({ member: "en", cookie: "zh-CN", acceptLanguage: "ko-KR,ko;q=0.9" }), "en");
});

test("without a stored language, the cookie beats the browser", () => {
  assert.equal(resolveLocale({ member: null, cookie: "zh-CN", acceptLanguage: "en-US,en;q=0.9" }), "zh-CN");
});

test("without a choice, the browser language decides", () => {
  assert.equal(resolveLocale({ member: null, cookie: undefined, acceptLanguage: "en-US,en;q=0.9" }), "en");
});

test("Korean is the fallback for no header, an empty header, and only unsupported languages", () => {
  assert.equal(resolveLocale({ member: null, cookie: undefined, acceptLanguage: null }), "ko");
  assert.equal(resolveLocale({ member: null, cookie: undefined, acceptLanguage: "" }), "ko");
  assert.equal(resolveLocale({ member: null, cookie: undefined, acceptLanguage: "fr-FR,de;q=0.8,*;q=0.1" }), "ko");
});

test("an unknown cookie or stored value is ignored, not trusted", () => {
  assert.equal(resolveLocale({ member: null, cookie: "de", acceptLanguage: "en" }), "en");
  assert.equal(resolveLocale({ member: "zh-TW", cookie: "EN", acceptLanguage: null }), "ko");
});

test("every Chinese browser, Traditional included, gets Simplified Chinese", () => {
  for (const tag of ["zh", "zh-CN", "zh-TW", "zh-HK", "zh-Hant-TW", "ZH-sg"]) assert.equal(fromAcceptLanguage(tag), "zh-CN", tag);
});

test("regional English and Korean tags map to their language", () => {
  assert.equal(fromAcceptLanguage("en-GB"), "en");
  assert.equal(fromAcceptLanguage("ko"), "ko");
});

test("the highest q value wins, whatever the order in the header", () => {
  assert.equal(fromAcceptLanguage("fr;q=0.9, en;q=0.5, zh-TW;q=0.7"), "zh-CN");
  assert.equal(fromAcceptLanguage("en;q=0.4,ko"), "ko");
});

test("a language the browser refuses with q=0 is never picked", () => {
  assert.equal(fromAcceptLanguage("en;q=0, ko;q=0.1"), "ko");
  assert.equal(fromAcceptLanguage("en;q=0"), null);
});

test("ties keep the browser's order", () => {
  assert.equal(fromAcceptLanguage("en;q=0.8, ko;q=0.8"), "en");
});

test("parseLocale accepts only the three exact tags", () => {
  assert.equal(parseLocale("zh-CN"), "zh-CN");
  for (const raw of ["zh", "zh-cn", "ko-KR", "", null, undefined, 1, { locale: "ko" }]) assert.equal(parseLocale(raw), null, String(raw));
});

test("a pick on the login screen becomes the member's language and the cookie's", () => {
  assert.deepEqual(localeAfterSignIn({ picked: "en", stored: "ko" }), { store: "en", cookie: "en" });
  assert.deepEqual(localeAfterSignIn({ picked: "zh-CN", stored: null }), { store: "zh-CN", cookie: "zh-CN" });
});

test("on a shared browser, signing in without a pick keeps the member's language and resets the cookie to it", () => {
  assert.deepEqual(localeAfterSignIn({ picked: null, stored: "ko" }), { store: null, cookie: "ko" });
});

test("signing in without a pick or a stored language writes nothing", () => {
  assert.deepEqual(localeAfterSignIn({ picked: null, stored: null }), { store: null, cookie: null });
});
