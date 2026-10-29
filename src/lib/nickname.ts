import { parseDisplayName } from "./display-name";

export const MAX_NICKNAME_LENGTH = 30;

export type ParsedNickname = { ok: true; nickname: string } | { ok: false; reason: string };

export function parseNickname(raw: string): ParsedNickname {
  const parsed = parseDisplayName(raw, "닉네임", MAX_NICKNAME_LENGTH);
  return parsed.ok ? { ok: true, nickname: parsed.name } : parsed;
}
