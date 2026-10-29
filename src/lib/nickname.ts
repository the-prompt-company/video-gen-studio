export const MAX_NICKNAME_LENGTH = 30;

export type ParsedNickname = { ok: true; nickname: string } | { ok: false; reason: string };

export function parseNickname(raw: string): ParsedNickname {
  const nickname = raw.normalize("NFC").trim();
  if (!nickname) return { ok: false, reason: "닉네임이 비어 있습니다" };
  if (/\p{Cc}/u.test(nickname)) return { ok: false, reason: "닉네임에 줄바꿈이나 탭 같은 제어 문자가 있습니다. 한 줄로 고치세요" };
  const length = Array.from(nickname).length;
  if (length > MAX_NICKNAME_LENGTH) return { ok: false, reason: `닉네임은 ${MAX_NICKNAME_LENGTH}자까지입니다 (지금 ${length}자)` };
  return { ok: true, nickname };
}
