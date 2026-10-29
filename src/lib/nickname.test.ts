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
  return r.ok ? "" : r.reason;
};

test("a nickname is stored trimmed and in NFC, with its inner spaces kept", () => {
  assert.equal(accepted("  김민수 "), "김민수");
  assert.equal(accepted("\u3000Min Su\u3000"), "Min Su");
  assert.equal(accepted("김 민수"), "김 민수");
  assert.equal(accepted("e\u0301"), "\u00e9");
});

test("a blank nickname is refused; a member's own edit clears it before parsing", () => {
  for (const raw of ["", "    ", "\t\n "]) assert.match(refused(raw), /닉네임이 비어/, JSON.stringify(raw));
});

test(`a nickname of up to ${MAX_NICKNAME_LENGTH} code points is accepted and one more is refused with the limit`, () => {
  assert.equal(MAX_NICKNAME_LENGTH, 30);
  assert.equal(accepted("가".repeat(30)), "가".repeat(30));
  assert.equal(accepted(` ${"a".repeat(30)} `), "a".repeat(30));
  assert.equal(accepted("😀".repeat(30)), "😀".repeat(30), "an emoji outside the BMP is one, not two UTF-16 units");
  assert.match(refused("가".repeat(31)), /30자/);
  assert.match(refused("😀".repeat(31)), /30자/);
});

test("control characters inside a nickname are refused", () => {
  for (const raw of ["김\n민수", "김\r\n민수", "김\t민수", "a\u0000b", "a\u007fb", "a\u0085b"]) assert.match(refused(raw), /제어 문자/, JSON.stringify(raw));
});

test("emoji, joined emoji and accents are kept as typed", () => {
  assert.equal(accepted("개발자 👩\u200d💻"), "개발자 👩\u200d💻");
  assert.equal(accepted("\u2764\ufe0f"), "\u2764\ufe0f");
});
