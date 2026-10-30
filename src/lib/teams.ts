// The admin screens import this module too, so it must stay free of server-only imports. Queries live in team-store.ts.
import { parseDisplayName, type ParsedName } from "./display-name";
import { appError, type AppError } from "./errors";

export type TeamId = number & { readonly __brand: "TeamId" };

export type TeamMember = { id: number; username: string; nickname: string | null };

export type Team = { id: TeamId; name: string; members: TeamMember[] };

export const MAX_TEAM_NAME_LENGTH = 30;

export const MAX_BULK_USERS = 200;

export function parseTeamName(raw: unknown): ParsedName {
  if (typeof raw !== "string") return { ok: false, reason: appError("teamNameNotText") };
  return parseDisplayName(raw, "teamName", MAX_TEAM_NAME_LENGTH);
}

const MAX_SERIAL = 2_147_483_647;

const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) <= MAX_SERIAL;

export function parseTeamId(raw: unknown): { ok: true; teamId: TeamId | null } | { ok: false; reason: AppError } {
  if (raw === null) return { ok: true, teamId: null };
  if (isId(raw)) return { ok: true, teamId: raw as TeamId };
  return { ok: false, reason: appError("badTeamId") };
}

/** A team id from a URL segment: digits only, so "1e1", "0x1" and " 5 " are no team. */
export function teamIdFromPath(segment: string): TeamId | null {
  if (!/^\d{1,10}$/.test(segment)) return null;
  const parsed = parseTeamId(Number(segment));
  return parsed.ok ? parsed.teamId : null;
}

export function parseUserIds(raw: unknown): { ok: true; userIds: number[] } | { ok: false; reason: AppError } {
  if (!Array.isArray(raw) || !raw.every(isId)) return { ok: false, reason: appError("badUserIds") };
  const userIds = [...new Set(raw)];
  if (userIds.length === 0) return { ok: false, reason: appError("noUsersChosen") };
  if (userIds.length > MAX_BULK_USERS) return { ok: false, reason: appError("tooManyUsers", { max: MAX_BULK_USERS }) };
  return { ok: true, userIds };
}
