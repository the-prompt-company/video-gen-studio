import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { GENERATION_STATUSES, type GenerationStatus } from "./generation-status";
import {
  cancelRow,
  inScope,
  parseScopeFilter,
  readRow,
  resolveScope,
  scopeCondition,
  settleScope,
  teamScope,
  type Scope,
  type ScopeFilter,
  type Viewer,
} from "./scope";
import type { Team, TeamId } from "./teams";

const member = (id: number) => ({ id, username: `u${id}@example.test`, nickname: null });
const red: Team = { id: 1 as TeamId, name: "레드", members: [member(1), member(2), member(3)] };
const blue: Team = { id: 2 as TeamId, name: "블루", members: [member(4)] };
const everyoneIds = [1, 2, 3, 4, 5, 6];

const visible = (viewer: Viewer, filter: ScopeFilter) => {
  const scope = resolveScope(viewer, filter);
  return scope && everyoneIds.filter((id) => inScope(scope, id));
};

test("a member in a team sees own videos under mine, teammates without themselves under team, and both under all", () => {
  const viewer: Viewer = { id: 2, role: "user", team: red };
  assert.deepEqual(visible(viewer, "mine"), [2]);
  assert.deepEqual(visible(viewer, "team"), [1, 3]);
  assert.deepEqual(visible(viewer, "all"), [1, 2, 3]);
});

test("a member never sees another team or members without a team, and has no everyone scope", () => {
  const viewer: Viewer = { id: 4, role: "user", team: blue };
  assert.deepEqual(visible(viewer, "team"), []);
  assert.deepEqual(visible(viewer, "all"), [4]);
  assert.equal(resolveScope(viewer, "everyone"), null);
});

test("a member without a team gets an empty team scope and only their own videos under all", () => {
  const viewer: Viewer = { id: 5, role: "user", team: null };
  assert.deepEqual(visible(viewer, "mine"), [5]);
  assert.deepEqual(visible(viewer, "team"), []);
  assert.deepEqual(visible(viewer, "all"), [5]);
});

test("an admin follows the same team rules and also gets everyone", () => {
  const inTeam: Viewer = { id: 3, role: "admin", team: red };
  assert.deepEqual(visible(inTeam, "team"), [1, 2]);
  assert.deepEqual(visible(inTeam, "all"), [1, 2, 3]);
  assert.deepEqual(visible(inTeam, "everyone"), everyoneIds);
  const alone: Viewer = { id: 6, role: "admin", team: null };
  assert.deepEqual(visible(alone, "all"), [6]);
  assert.deepEqual(visible(alone, "everyone"), everyoneIds);
});

test("a team scope covers every current member, for an admin on any team and a member only on their own", () => {
  const ids = (scope: Scope | null) => scope && everyoneIds.filter((id) => inScope(scope, id));
  const admin: Viewer = { id: 6, role: "admin", team: null };
  assert.deepEqual(ids(teamScope(admin, red)), [1, 2, 3]);
  assert.deepEqual(ids(teamScope(admin, { ...blue, members: [] })), []);
  assert.deepEqual(ids(teamScope({ id: 2, role: "user", team: red }, red)), [1, 2, 3]);
  assert.equal(teamScope({ id: 2, role: "user", team: red }, blue), null);
  assert.equal(teamScope({ id: 5, role: "user", team: null }, red), null);
});

test("a filter from a request is one of the four names, anything else is no filter", () => {
  for (const name of ["mine", "team", "all", "everyone"]) assert.equal(parseScopeFilter(name), name);
  for (const raw of ["Mine", "teams", "", undefined, null, ["mine"], 1]) assert.equal(parseScopeFilter(raw), null, JSON.stringify(raw));
});

test("the SQL condition over generations.user_id admits exactly the scope's users", () => {
  const render = (scope: Scope) => new PgDialect().sqlToQuery(scopeCondition(scope));
  const team = render(resolveScope({ id: 2, role: "user", team: red }, "all")!);
  assert.match(team.sql, /"generations"\."user_id" in \(\$1, \$2, \$3\)/);
  assert.deepEqual([...team.params].sort(), [1, 2, 3]);
  assert.equal(render(resolveScope({ id: 5, role: "user", team: null }, "team")!).sql, "false");
  assert.deepEqual(render({ kind: "everyone" }), { sql: "true", params: [] });
});

const v: Record<number, Viewer> = {
  1: { id: 1, role: "user", team: red },
  2: { id: 2, role: "user", team: red },
  3: { id: 3, role: "admin", team: red },
  4: { id: 4, role: "user", team: blue },
  5: { id: 5, role: "user", team: null },
  6: { id: 6, role: "admin", team: null },
};
const row = (userId: number, status: GenerationStatus) => ({ userId, status });
const done = (n: number) => row(n, "completed");
const live = (n: number) => row(n, "in_progress");
const NOT_FOUND = { kind: "refuse", status: 404, code: "noSuchGeneration" };
const NOT_YOURS = { kind: "refuse", status: 403, code: "notYourGeneration" };

test("a teammate reads a finished row as stored and never settles it", () => {
  const finished = done(1);
  assert.deepEqual(readRow(v[2], finished), { kind: "asStored", row: finished });
  assert.deepEqual(readRow(v[1], done(2)), { kind: "asStored", row: done(2) });
});

test("a teammate's live, failed or canceled row is a 404, the same answer as a missing row", () => {
  assert.deepEqual(readRow(v[2], null), NOT_FOUND);
  for (const status of GENERATION_STATUSES.filter((s) => s !== "completed")) {
    assert.deepEqual(readRow(v[2], row(1, status)), NOT_FOUND, status);
    assert.deepEqual(cancelRow(v[2], row(1, status)), NOT_FOUND, status);
  }
});

test("another team's rows, a teamless member's rows and a missing row are 404 on read and on cancel", () => {
  const cases: [Viewer, ReturnType<typeof done> | null][] = [
    [v[2], done(4)],
    [v[4], done(2)],
    [v[5], done(1)],
    [v[2], done(5)],
    [v[2], null],
  ];
  for (const [viewer, r] of cases) {
    const label = JSON.stringify({ viewer: viewer.id, row: r });
    assert.deepEqual(readRow(viewer, r), NOT_FOUND, label);
    assert.deepEqual(cancelRow(viewer, r), NOT_FOUND, label);
  }
});

test("only the owner cancels: a teammate and an admin get 403 on a row they can see", () => {
  assert.deepEqual(cancelRow(v[1], done(2)), NOT_YOURS);
  assert.deepEqual(cancelRow(v[3], live(4)), NOT_YOURS);
  assert.deepEqual(cancelRow(v[6], done(5)), NOT_YOURS);
  const mine = live(1);
  assert.deepEqual(cancelRow(v[1], mine), { kind: "cancel", row: mine });
});

test("the owner and an admin settle on read, whatever the status", () => {
  for (const status of GENERATION_STATUSES) {
    for (const [viewer, owner] of [[v[1], 1], [v[3], 3], [v[3], 4], [v[6], 5], [v[6], 2]] as const) {
      const r = row(owner, status);
      assert.deepEqual(readRow(viewer, r), { kind: "settle", row: r }, `${viewer.id} reads ${owner}'s ${status} row`);
    }
  }
});

test("the poll settles exactly the rows the read path settles", () => {
  const rows = everyoneIds.flatMap((n) => [done(n), live(n)]);
  for (const viewer of Object.values(v)) {
    for (const r of rows) {
      const label = `viewer ${viewer.id}, ${r.status} row of ${r.userId}`;
      assert.equal(inScope(settleScope(viewer), r.userId), readRow(viewer, r).kind === "settle", label);
    }
  }
  const render = (scope: Scope) => new PgDialect().sqlToQuery(scopeCondition(scope));
  const own = render(settleScope(v[2]));
  assert.deepEqual([own.sql, own.params], ['"generations"."user_id" in ($1)', [2]]);
  assert.deepEqual(render(settleScope(v[3])), { sql: "true", params: [] });
});

test("a member who leaves a team stops reading former teammates' rows at once", () => {
  const finished = done(1);
  assert.equal(readRow(v[2], finished).kind, "asStored");
  const left: Viewer = { id: 2, role: "user", team: null };
  const moved: Viewer = { id: 2, role: "user", team: { ...blue, members: [member(4), member(2)] } };
  const stayed: Viewer = { id: 1, role: "user", team: { ...red, members: [member(1), member(3)] } };
  assert.deepEqual(readRow(left, finished), NOT_FOUND);
  assert.deepEqual(readRow(moved, finished), NOT_FOUND);
  assert.deepEqual(readRow(stayed, done(2)), NOT_FOUND);
});
