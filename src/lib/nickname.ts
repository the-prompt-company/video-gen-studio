export const MAX_NICKNAME_LENGTH = 30;

// Direction overrides and zero-width marks can make a name read as someone else's, or as nothing. Joiners stay for emoji.
const INVISIBLE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;
const BLANK = /[\s\u115f\u1160\u3164\uffa0\u200c\u200d]/gu;

export type ParsedNickname = { ok: true; nickname: string } | { ok: false; reason: string };

export function parseNickname(raw: string): ParsedNickname {
  const nickname = raw.normalize("NFC").trim();
  if (!nickname) return { ok: false, reason: "닉네임이 비어 있습니다" };
  if (/\p{Cc}/u.test(nickname)) return { ok: false, reason: "닉네임에 줄바꿈이나 탭 같은 제어 문자가 있습니다. 한 줄로 고치세요" };
  if (INVISIBLE.test(nickname)) return { ok: false, reason: "닉네임에 보이지 않는 문자나 글자 방향을 바꾸는 문자가 있습니다. 보이는 글자로만 적으세요" };
  if (!nickname.replace(BLANK, "")) return { ok: false, reason: "닉네임에 보이는 글자가 없습니다. 글자를 하나 이상 적으세요" };
  const length = Array.from(nickname).length;
  if (length > MAX_NICKNAME_LENGTH) return { ok: false, reason: `닉네임은 ${MAX_NICKNAME_LENGTH}자까지입니다 (지금 ${length}자)` };
  return { ok: true, nickname };
}
