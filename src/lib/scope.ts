import { inArray, sql, type SQL } from "drizzle-orm";
import { generations, type Generation, type User } from "@/db/schema";
import type { ErrorCode } from "./errors";
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

export function resolveScope(viewer: Viewer, filter: Exclude<ScopeFilter, "everyone">): Scope;
export function resolveScope(viewer: Viewer, filter: ScopeFilter): Scope | null;
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

type RowFacts = Pick<Generation, "userId" | "status">;

export type Refusal = { kind: "refuse"; status: 403 | 404; code: Extract<ErrorCode, "noSuchGeneration" | "notYourGeneration"> };

export type ReadDecision<R> = { kind: "settle"; row: R } | { kind: "asStored"; row: R } | Refusal;

export type CancelDecision<R> = { kind: "cancel"; row: R } | Refusal;

type RowAccess = "owner" | "admin" | "reader" | "none";

const NOT_FOUND: Refusal = { kind: "refuse", status: 404, code: "noSuchGeneration" };
const NOT_YOURS: Refusal = { kind: "refuse", status: 403, code: "notYourGeneration" };

const ROW_POLICY = {
  owner: { read: "settle", cancel: "cancel" },
  admin: { read: "settle", cancel: NOT_YOURS },
  reader: { read: "asStored", cancel: NOT_YOURS },
  none: { read: NOT_FOUND, cancel: NOT_FOUND },
} as const satisfies Record<RowAccess, { read: "settle" | "asStored" | Refusal; cancel: "cancel" | Refusal }>;

function accessOf(viewer: Viewer, row: RowFacts): RowAccess {
  if (row.userId === viewer.id) return "owner";
  if (viewer.role === "admin") return "admin";
  return row.status === "completed" && inScope(resolveScope(viewer, "all"), row.userId) ? "reader" : "none";
}

export function readRow<R extends RowFacts>(viewer: Viewer, row: R | null): ReadDecision<R> {
  if (row === null) return NOT_FOUND;
  const { read } = ROW_POLICY[accessOf(viewer, row)];
  return typeof read === "string" ? { kind: read, row } : read;
}

export function cancelRow<R extends RowFacts>(viewer: Viewer, row: R | null): CancelDecision<R> {
  if (row === null) return NOT_FOUND;
  const { cancel } = ROW_POLICY[accessOf(viewer, row)];
  return typeof cancel === "string" ? { kind: cancel, row } : cancel;
}

export function settleScope(viewer: Pick<Viewer, "id" | "role">): Scope {
  return viewer.role === "admin" ? { kind: "everyone" } : users([viewer.id]);
}
