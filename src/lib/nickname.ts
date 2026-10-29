/** The nickname rule, shared by the settings form and PATCH /api/me. The browser imports this module too. */
export const NICKNAME_MAX = 30;

/** Controls, line and paragraph separators, and invisible format characters such as bidi overrides; the emoji joiner stays. */
const UNPRINTABLE = /[\p{Cc}\p{Zl}\p{Zp}]|(?!‍)\p{Cf}/u;

export type ParsedNickname = { ok: true; nickname: string | null } | { ok: false; error: string };

/** Trimmed, at most NICKNAME_MAX code points, printable. Blank parses to null, which shows the ID instead. */
export function parseNickname(typed: string): ParsedNickname {
  const nickname = typed.trim();
  if (UNPRINTABLE.test(nickname)) {
    return { ok: false, error: "닉네임에 줄바꿈이나 제어 문자, 보이지 않는 문자는 쓸 수 없습니다. 보이는 글자만 입력하세요" };
  }
  if ([...nickname].length > NICKNAME_MAX) return { ok: false, error: `닉네임은 ${NICKNAME_MAX}자 이하로 정하세요` };
  return { ok: true, nickname: nickname || null };
}
