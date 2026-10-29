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
  return r.ok ? "" : r.reason;
};

test("a team name is stored trimmed and in NFC, with its case and inner spaces kept", () => {
  assert.equal(name("  마케팅 1팀 "), "마케팅 1팀");
  assert.equal(name("\u3000Design Team\u3000"), "Design Team");
  assert.equal(name("Cafe\u0301"), "Caf\u00e9");
});

test(`a team name of up to ${MAX_TEAM_NAME_LENGTH} characters is accepted and one more is refused with the limit`, () => {
  assert.equal(MAX_TEAM_NAME_LENGTH, 30);
  assert.equal(name("팀".repeat(30)), "팀".repeat(30));
  assert.match(nameRefused("팀".repeat(31)), /^팀 이름은 30자까지입니다 \(지금 31자\)$/);
});

test("a blank, multi-line, invisible or missing team name is refused with a reason that names the team name", () => {
  for (const raw of ["", "   ", "\t\n"]) assert.match(nameRefused(raw), /^팀 이름이 비어 있습니다$/, JSON.stringify(raw));
  assert.match(nameRefused("영업\n1팀"), /^팀 이름에 줄바꿈이나 탭/);
  assert.match(nameRefused("영업\u202e1팀"), /^팀 이름에 보이지 않는/);
  assert.match(nameRefused("\u3164"), /^팀 이름에 보이는 글자가 없습니다/);
  for (const raw of [undefined, null, 12, ["팀"]]) assert.match(nameRefused(raw), /팀 이름을 글자로/, JSON.stringify(raw));
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
    return r.ok ? "" : r.reason;
  };
  assert.match(refused([]), /한 명 이상/);
  assert.match(refused(Array.from({ length: MAX_BULK_USERS + 1 }, (_, i) => i + 1)), new RegExp(`${MAX_BULK_USERS}명까지`));
  for (const raw of [undefined, "1,2", [1, "2"], [0], [1.5], [-3], [3e9]]) assert.match(refused(raw), /사용자 번호/, JSON.stringify(raw));
});
