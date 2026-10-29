import { test } from "node:test";
import assert from "node:assert/strict";
import { loginId, newPasswordError } from "./credentials";

const CURRENT = "current-pass-1";

test("a new password of 8+ characters that differs from the current and the initial one is accepted", () => {
  assert.equal(newPasswordError(CURRENT, "abcdefgh"), null);
  assert.equal(newPasswordError(CURRENT, "a much longer passphrase 2026"), null);
});

test("a new password under 8 characters is refused with the minimum length", () => {
  assert.match(newPasswordError(CURRENT, "abcdefg") ?? "", /8자/);
  assert.match(newPasswordError(CURRENT, "") ?? "", /8자/);
});

test("the current password is refused as the new one", () => {
  assert.match(newPasswordError(CURRENT, CURRENT) ?? "", /현재 비밀번호와 같/);
});

test("the initial password oooooooo is refused as the new one, whatever the current password is", () => {
  assert.match(newPasswordError(CURRENT, "oooooooo") ?? "", /임시 비밀번호/);
  assert.match(newPasswordError("oooooooo", "oooooooo") ?? "", /임시 비밀번호/);
});

test("an ID with @ is an email: trimmed and lowercased", () => {
  assert.equal(loginId("  Kim.Min@The-Prompt.ME "), "kim.min@the-prompt.me");
});

test("an ID without @ keeps its case and is only trimmed", () => {
  assert.equal(loginId(" Admin "), "Admin");
});
