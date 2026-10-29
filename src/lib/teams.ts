// The admin screens import this module too, so it must stay free of server-only imports. Queries live in team-store.ts.
import { parseDisplayName, type ParsedName } from "./display-name";

export type TeamId = number & { readonly __brand: "TeamId" };

export type TeamMember = { id: number; username: string; nickname: string | null };

export type Team = { id: TeamId; name: string; members: TeamMember[] };

export const MAX_TEAM_NAME_LENGTH = 30;

export const MAX_BULK_USERS = 200;

export const NO_SUCH_TEAM = "없는 팀입니다. 목록을 새로 불러온 뒤 다시 고르세요";

export const DUPLICATE_TEAM_NAME = "이미 있는 팀 이름입니다. 대소문자만 달라도 같은 이름으로 봅니다";

export function parseTeamName(raw: unknown): ParsedName {
  if (typeof raw !== "string") return { ok: false, reason: "팀 이름을 글자로 보내세요" };
  return parseDisplayName(raw, "팀 이름", MAX_TEAM_NAME_LENGTH);
}

const MAX_SERIAL = 2_147_483_647;

const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) <= MAX_SERIAL;

export function parseTeamId(raw: unknown): { ok: true; teamId: TeamId | null } | { ok: false; reason: string } {
  if (raw === null) return { ok: true, teamId: null };
  if (isId(raw)) return { ok: true, teamId: raw as TeamId };
  return { ok: false, reason: "teamId는 팀 번호 또는 미소속(null)입니다" };
}

/** A team id from a URL segment: digits only, so "1e1", "0x1" and " 5 " are no team. */
export function teamIdFromPath(segment: string): TeamId | null {
  if (!/^\d{1,10}$/.test(segment)) return null;
  const parsed = parseTeamId(Number(segment));
  return parsed.ok ? parsed.teamId : null;
}

export function parseUserIds(raw: unknown): { ok: true; userIds: number[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || !raw.every(isId)) return { ok: false, reason: "userIds는 사용자 번호 목록입니다" };
  const userIds = [...new Set(raw)];
  if (userIds.length === 0) return { ok: false, reason: "사용자를 한 명 이상 고르세요" };
  if (userIds.length > MAX_BULK_USERS) return { ok: false, reason: `한 번에 ${MAX_BULK_USERS}명까지 지정할 수 있습니다` };
  return { ok: true, userIds };
}
