import { test } from "node:test";
import assert from "node:assert/strict";
import { loginId, newPasswordError } from "./credentials";

const CURRENT = "current-pass-1";

test("a new password of 8+ characters that differs from the current and the initial one is accepted", () => {
  assert.equal(newPasswordError(CURRENT, "abcdefgh"), null);
  assert.equal(newPasswordError(CURRENT, "a much longer passphrase 2026"), null);
});

test("a new password under 8 characters is refused with the minimum length", () => {
  assert.deepEqual(newPasswordError(CURRENT, "abcdefg"), { code: "passwordTooShort", params: { min: 8 } });
  assert.deepEqual(newPasswordError(CURRENT, ""), { code: "passwordTooShort", params: { min: 8 } });
});

test("the current password is refused as the new one", () => {
  assert.deepEqual(newPasswordError(CURRENT, CURRENT), { code: "passwordUnchanged" });
});

test("the initial password oooooooo is refused as the new one, whatever the current password is", () => {
  assert.deepEqual(newPasswordError(CURRENT, "oooooooo"), { code: "passwordIsInitial" });
  assert.deepEqual(newPasswordError("oooooooo", "oooooooo"), { code: "passwordIsInitial" });
});

test("an ID with @ is an email: trimmed and lowercased", () => {
  assert.equal(loginId("  Kim.Min@The-Prompt.ME "), "kim.min@the-prompt.me");
});

test("an ID without @ keeps its case and is only trimmed", () => {
  assert.equal(loginId(" Admin "), "Admin");
});
