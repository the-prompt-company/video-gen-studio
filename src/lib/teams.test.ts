import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BULK_USERS, MAX_TEAM_NAME_LENGTH, parseTeamId, parseTeamName, parseUserIds, teamIdFromPath } from "./teams";

const name = (raw: unknown) => {
  const r = parseTeamName(raw);
  assert.equal(r.ok, true, `${JSON.stringify(raw)} should be accepted, got ${JSON.stringify(r)}`);
  return r.ok ? r.name : undefined;
};
const nameRefused = (raw: unknown) => {
  const r = parseTeamName(raw);
  assert.equal(r.ok, false, `${JSON.stringify(raw)} should be refused, got ${JSON.stringify(r)}`);
  return r.ok ? undefined : r.reason;
};

test("a team name is stored trimmed and in NFC, with its case and inner spaces kept", () => {
  assert.equal(name("  마케팅 1팀 "), "마케팅 1팀");
  assert.equal(name("\u3000Design Team\u3000"), "Design Team");
  assert.equal(name("Cafe\u0301"), "Caf\u00e9");
});

test(`a team name of up to ${MAX_TEAM_NAME_LENGTH} characters is accepted and one more is refused with the limit`, () => {
  assert.equal(MAX_TEAM_NAME_LENGTH, 30);
  assert.equal(name("팀".repeat(30)), "팀".repeat(30));
  assert.deepEqual(nameRefused("팀".repeat(31)), { code: "nameTooLong", params: { kind: "teamName", max: 30, length: 31 } });
});

test("a blank, multi-line, invisible or missing team name is refused with a reason about the team name", () => {
  for (const raw of ["", "   ", "\t\n"]) assert.deepEqual(nameRefused(raw), { code: "nameBlank", params: { kind: "teamName" } }, JSON.stringify(raw));
  assert.deepEqual(nameRefused("영업\n1팀"), { code: "nameControl", params: { kind: "teamName" } });
  assert.deepEqual(nameRefused("영업\u202e1팀"), { code: "nameInvisible", params: { kind: "teamName" } });
  assert.deepEqual(nameRefused("\u3164"), { code: "nameNoVisible", params: { kind: "teamName" } });
  for (const raw of [undefined, null, 12, ["팀"]]) assert.deepEqual(nameRefused(raw), { code: "teamNameNotText" }, JSON.stringify(raw));
});

test("a team id is a positive integer that fits the serial column, and null means no team", () => {
  assert.deepEqual(parseTeamId(7), { ok: true, teamId: 7 });
  assert.deepEqual(parseTeamId(2 ** 31 - 1), { ok: true, teamId: 2 ** 31 - 1 });
  assert.deepEqual(parseTeamId(null), { ok: true, teamId: null });
  for (const raw of [0, -1, 1.5, Number.NaN, "7", undefined, {}, 2 ** 31, 2 ** 53]) assert.equal(parseTeamId(raw).ok, false, JSON.stringify(raw));
});

test("a team id in a URL is plain digits", () => {
  assert.equal(teamIdFromPath("12"), 12);
  for (const segment of ["0", "1e1", "0x1", " 5 ", "-3", "abc", "", "3000000000"]) assert.equal(teamIdFromPath(segment), null, JSON.stringify(segment));
});

test(`a bulk selection is 1 to ${MAX_BULK_USERS} positive user ids, with repeats dropped`, () => {
  assert.deepEqual(parseUserIds([3, 1, 3]), { ok: true, userIds: [3, 1] });
  assert.deepEqual(parseUserIds(Array.from({ length: MAX_BULK_USERS }, (_, i) => i + 1)).ok, true);
  const refused = (raw: unknown) => {
    const r = parseUserIds(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    return r.ok ? undefined : r.reason;
  };
  assert.deepEqual(refused([]), { code: "noUsersChosen" });
  assert.deepEqual(refused(Array.from({ length: MAX_BULK_USERS + 1 }, (_, i) => i + 1)), { code: "tooManyUsers", params: { max: MAX_BULK_USERS } });
  for (const raw of [undefined, "1,2", [1, "2"], [0], [1.5], [-3], [3e9]]) assert.deepEqual(refused(raw), { code: "badUserIds" }, JSON.stringify(raw));
});
