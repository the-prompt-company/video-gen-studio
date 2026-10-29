import { test } from "node:test";
import assert from "node:assert/strict";
import { NICKNAME_MAX, parseNickname } from "./nickname";

const accepted = (typed: string) => {
  const r = parseNickname(typed);
  assert.equal(r.ok, true, `${JSON.stringify(typed)} should be accepted, got ${JSON.stringify(r)}`);
  return r.ok ? r.nickname : undefined;
};
const refused = (typed: string) => {
  const r = parseNickname(typed);
  assert.equal(r.ok, false, `${JSON.stringify(typed)} should be refused, got ${JSON.stringify(r)}`);
  return r.ok ? "" : r.error;
};

test("a nickname is stored trimmed, with its inner spaces kept", () => {
  assert.equal(accepted("  김민수 "), "김민수");
  assert.equal(accepted("　Min Su　"), "Min Su");
  assert.equal(accepted("김 민수"), "김 민수");
});

test("an empty or blank nickname clears it, so the ID shows", () => {
  assert.equal(accepted(""), null);
  assert.equal(accepted("    "), null);
  assert.equal(accepted("\t\n "), null);
});

test(`a nickname of up to ${NICKNAME_MAX} characters is accepted and one more is refused with the limit`, () => {
  assert.equal(NICKNAME_MAX, 30);
  assert.equal(accepted("가".repeat(30)), "가".repeat(30));
  assert.equal(accepted(` ${"a".repeat(30)} `), "a".repeat(30));
  assert.match(refused("가".repeat(31)), /30자/);
  assert.match(refused("a".repeat(31)), /30자/);
});

test("characters are counted as the member sees them, so 30 emoji outside the BMP fit", () => {
  assert.equal(accepted("😀".repeat(30)), "😀".repeat(30));
  assert.match(refused("😀".repeat(31)), /30자/);
});

test("control, line-breaking and invisible format characters inside a nickname are refused", () => {
  for (const typed of ["김\n민수", "김\t민수", "김\r민수", "a\u0000b", "a\u007fb", "a\u0085b", "a b", "a b", "‮admin", "a⁦b", "a​b", "a‎b", "a﻿b", "a­b"]) {
    assert.match(refused(typed), /제어 문자/, JSON.stringify(typed));
  }
});

test("emoji joined with a zero-width joiner stay allowed", () => {
  assert.equal(accepted("개발자 👩‍💻"), "개발자 👩‍💻");
});
