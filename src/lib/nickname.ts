import { parseDisplayName, type ParsedName } from "./display-name";

export const MAX_NICKNAME_LENGTH = 30;

export type ParsedNickname = { ok: true; nickname: string } | Extract<ParsedName, { ok: false }>;

export function parseNickname(raw: string): ParsedNickname {
  const parsed = parseDisplayName(raw, "nickname", MAX_NICKNAME_LENGTH);
  return parsed.ok ? { ok: true, nickname: parsed.name } : parsed;
}
