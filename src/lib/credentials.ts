/** The password an admin hands out for a new or reset account. Sign-in asks for a new one before anything else. */
export const INITIAL_PASSWORD = "oooooooo";

export const MIN_PASSWORD_LENGTH = 8;

/** The ID as stored. An email ID is case-insensitive, so it is lowercased; any other ID keeps its case. */
export function loginId(raw: string): string {
  const id = raw.trim();
  return id.includes("@") ? id.toLowerCase() : id;
}

/** Why `next` cannot replace `current`, worded for the member, or null when it can. */
export function newPasswordError(current: string, next: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `새 비밀번호를 ${MIN_PASSWORD_LENGTH}자 이상으로 정하세요`;
  if (next === INITIAL_PASSWORD) return "처음 받은 임시 비밀번호는 새 비밀번호로 쓸 수 없습니다. 다른 비밀번호를 정하세요";
  if (next === current) return "새 비밀번호가 현재 비밀번호와 같습니다. 다른 비밀번호를 정하세요";
  return null;
}
