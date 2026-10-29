import { inArray, sql, type SQL } from "drizzle-orm";
import { generations, type User } from "@/db/schema";
import { teamOf } from "./team-store";
import type { Team } from "./teams";

export type Viewer = { id: number; role: User["role"]; team: Team | null };

export const SCOPE_FILTERS = ["mine", "team", "all", "everyone"] as const;

export type ScopeFilter = (typeof SCOPE_FILTERS)[number];

export type Scope = { kind: "everyone" } | { kind: "users"; userIds: readonly number[] };

export async function viewerOf(user: Pick<User, "id" | "role" | "teamId">): Promise<Viewer> {
  return { id: user.id, role: user.role, team: user.teamId === null ? null : await teamOf(user.teamId) };
}

export function parseScopeFilter(raw: unknown): ScopeFilter | null {
  return SCOPE_FILTERS.find((f) => f === raw) ?? null;
}

const users = (ids: number[]): Scope => ({ kind: "users", userIds: [...new Set(ids)] });

export function resolveScope(viewer: Viewer, filter: ScopeFilter): Scope | null {
  const teammates = (viewer.team?.members ?? []).map((m) => m.id).filter((id) => id !== viewer.id);
  switch (filter) {
    case "mine":
      return users([viewer.id]);
    case "team":
      return users(teammates);
    case "all":
      return users([viewer.id, ...teammates]);
    case "everyone":
      return viewer.role === "admin" ? { kind: "everyone" } : null;
  }
}

/** Every current member of `team`: any team for an admin, only their own for a member. */
export function teamScope(viewer: Viewer, team: Team): Scope | null {
  if (viewer.role !== "admin" && viewer.team?.id !== team.id) return null;
  return users(team.members.map((m) => m.id));
}

export function inScope(scope: Scope, userId: number): boolean {
  return scope.kind === "everyone" || scope.userIds.includes(userId);
}

/** Drizzle renders `inArray` over an empty list as `false`, so a scope with no users matches no rows. */
export function scopeCondition(scope: Scope): SQL {
  return scope.kind === "everyone" ? sql`true` : inArray(generations.userId, [...scope.userIds]);
}
