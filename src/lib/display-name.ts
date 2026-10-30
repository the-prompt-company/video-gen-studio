import { appError, type AppError } from "./errors";

// Direction overrides and zero-width marks can make a name read as someone else's, or as nothing. Joiners stay for emoji.
const INVISIBLE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;
const BLANK = /[\s\u115f\u1160\u3164\uffa0\u200c\u200d]/gu;

/** Which name a reason talks about. Each message picks its words, particles included, with a select on it. */
export type NameKind = "nickname" | "teamName";

export type ParsedName = { ok: true; name: string } | { ok: false; reason: AppError };

export function parseDisplayName(raw: string, kind: NameKind, max: number): ParsedName {
  const refuse = (code: "nameBlank" | "nameControl" | "nameInvisible" | "nameNoVisible"): ParsedName => ({ ok: false, reason: appError(code, { kind }) });
  const name = raw.normalize("NFC").trim();
  if (!name) return refuse("nameBlank");
  if (/\p{Cc}/u.test(name)) return refuse("nameControl");
  if (INVISIBLE.test(name)) return refuse("nameInvisible");
  if (!name.replace(BLANK, "")) return refuse("nameNoVisible");
  const length = Array.from(name).length;
  if (length > max) return { ok: false, reason: appError("nameTooLong", { kind, max, length }) };
  return { ok: true, name };
}
