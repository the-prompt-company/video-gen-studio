import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { inScope, parseScopeFilter, resolveScope, scopeCondition, teamScope, type Scope, type ScopeFilter, type Viewer } from "./scope";
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
