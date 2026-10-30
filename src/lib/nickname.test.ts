import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_NICKNAME_LENGTH, parseNickname } from "./nickname";

const accepted = (raw: string) => {
  const r = parseNickname(raw);
  assert.equal(r.ok, true, `${JSON.stringify(raw)} should be accepted, got ${JSON.stringify(r)}`);
  return r.ok ? r.nickname : undefined;
};
const refused = (raw: string) => {
  const r = parseNickname(raw);
  assert.equal(r.ok, false, `${JSON.stringify(raw)} should be refused, got ${JSON.stringify(r)}`);
  return r.ok ? undefined : r.reason;
};

test("a nickname is stored trimmed and in NFC, with its inner spaces kept", () => {
  assert.equal(accepted("  김민수 "), "김민수");
  assert.equal(accepted("\u3000Min Su\u3000"), "Min Su");
  assert.equal(accepted("김 민수"), "김 민수");
  assert.equal(accepted("e\u0301"), "\u00e9");
});

test("a blank nickname is refused; a member's own edit clears it before parsing", () => {
  for (const raw of ["", "    ", "\t\n "]) assert.deepEqual(refused(raw), { code: "nameBlank", params: { kind: "nickname" } }, JSON.stringify(raw));
});

test(`a nickname of up to ${MAX_NICKNAME_LENGTH} code points is accepted and one more is refused with the limit`, () => {
  assert.equal(MAX_NICKNAME_LENGTH, 30);
  assert.equal(accepted("가".repeat(30)), "가".repeat(30));
  assert.equal(accepted(` ${"a".repeat(30)} `), "a".repeat(30));
  assert.equal(accepted("😀".repeat(30)), "😀".repeat(30), "an emoji outside the BMP is one, not two UTF-16 units");
  assert.deepEqual(refused("가".repeat(31)), { code: "nameTooLong", params: { kind: "nickname", max: 30, length: 31 } });
  assert.deepEqual(refused("😀".repeat(31)), { code: "nameTooLong", params: { kind: "nickname", max: 30, length: 31 } });
});

test("control characters inside a nickname are refused", () => {
  for (const raw of ["김\n민수", "김\r\n민수", "김\t민수", "a\u0000b", "a\u007fb", "a\u0085b"]) assert.deepEqual(refused(raw), { code: "nameControl", params: { kind: "nickname" } }, JSON.stringify(raw));
});

test("emoji, joined emoji and accents are kept as typed", () => {
  assert.equal(accepted("개발자 👩\u200d💻"), "개발자 👩\u200d💻");
  assert.equal(accepted("\u2764\ufe0f"), "\u2764\ufe0f");
});

test("direction overrides and invisible characters are refused, because they disguise or hide the name others see", () => {
  for (const raw of ["관리자\u202e", "a\u202db", "a\u2066b\u2069", "a\u200eb", "a\u200fb", "a\u061cb", "a\u200bb", "김\ufeff민수", "a\u2060b"]) {
    assert.deepEqual(refused(raw), { code: "nameInvisible", params: { kind: "nickname" } }, JSON.stringify(raw));
  }
});

test("a nickname with no visible character is refused", () => {
  for (const raw of ["\u3164", "\u3164 \u3164", "\u115f\u1160", "\uffa0", "\u200d"]) assert.deepEqual(refused(raw), { code: "nameNoVisible", params: { kind: "nickname" } }, JSON.stringify(raw));
});
