import { asc, eq, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Team, TeamId } from "./teams";

async function teamsWhere(where: SQL | undefined): Promise<Team[]> {
  const t = schema.teams;
  const u = schema.users;
  const rows = await getDb()
    .select({ id: t.id, name: t.name, member: { id: u.id, username: u.username, nickname: u.nickname } })
    .from(t)
    .leftJoin(u, eq(u.teamId, t.id))
    .where(where)
    .orderBy(asc(t.name), asc(t.id), asc(u.username));
  const teams = new Map<TeamId, Team>();
  for (const { id, name, member } of rows) {
    let team = teams.get(id);
    if (!team) teams.set(id, (team = { id, name, members: [] }));
    if (member) team.members.push(member);
  }
  return [...teams.values()];
}

export function listTeams(): Promise<Team[]> {
  return teamsWhere(undefined);
}

export async function teamOf(id: TeamId): Promise<Team | null> {
  return (await teamsWhere(eq(schema.teams.id, id)))[0] ?? null;
}
