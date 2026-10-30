import { appError, type AppError } from "./errors";

export const INITIAL_PASSWORD = "oooooooo";

export const MIN_PASSWORD_LENGTH = 8;

export function loginId(raw: string): string {
  const id = raw.trim();
  return id.includes("@") ? id.toLowerCase() : id;
}

export function newPasswordError(current: string, next: string): AppError | null {
  if (next.length < MIN_PASSWORD_LENGTH) return appError("passwordTooShort", { min: MIN_PASSWORD_LENGTH });
  if (next === INITIAL_PASSWORD) return appError("passwordIsInitial");
  if (next === current) return appError("passwordUnchanged");
  return null;
}
