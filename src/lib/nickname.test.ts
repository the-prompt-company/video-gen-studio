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

test("characters are counted by code point, not UTF-16 unit, so 30 emoji outside the BMP fit", () => {
  assert.equal(accepted("😀".repeat(30)), "😀".repeat(30));
  assert.match(refused("😀".repeat(31)), /30자/);
});

test("control, line-breaking and invisible format characters inside a nickname are refused", () => {
  for (const typed of ["김\n민수", "김\t민수", "김\r민수", "a\u0000b", "a\u007fb", "a\u0085b", "a\u2028b", "a\u2029b", "\u202eadmin", "a\u2066b", "a\u200bb", "a\u200eb", "a\ufeffb", "a\u00adb"]) {
    assert.match(refused(typed), /제어 문자/, JSON.stringify(typed));
  }
});

test("a nickname that would render blank is refused: fillers, invisible joiners and marks with no letter", () => {
  for (const typed of ["\u3164", "\uffa0", "\u115f\u1160", "\u2800", "\u034f", "\u200d", "\ufe0f", "\u0301\u0302", "\u3164 \u3164"]) {
    assert.match(refused(typed), /보이는 글자가 없는/, JSON.stringify(typed));
  }
  assert.match(refused("a\ud800b"), /제어 문자/, "a lone surrogate");
});

test("emoji joined with a zero-width joiner stay allowed", () => {
  assert.equal(accepted("개발자 👩\u200d💻"), "개발자 👩\u200d💻");
  assert.equal(accepted("\u2764\ufe0f"), "\u2764\ufe0f");
  assert.equal(accepted("e\u0301"), "e\u0301");
});
