// The browser imports this module too, so it must stay free of server-only imports.
import type { Messages } from "next-intl";

/** Every error a member can see. The codes are the keys of `errors` in ko.json, so a code without a message fails tsc. */
export type ErrorCode = keyof Messages["errors"];

export type ErrorParams = Record<string, string | number>;

/** What the server sends as `{ error: AppError }`, and what the page translates. */
export type AppError = { code: ErrorCode; params?: ErrorParams };

/**
 * Why something failed or waits. It is an AppError the page translates, or text shown exactly as given, which is the
 * provider's own words, a failure reason stored in Korean before error codes, or a message thrown in the browser.
 */
export type Reason = AppError | { text: string };

export function appError(code: ErrorCode, params?: ErrorParams): AppError {
  return params ? { code, params } : { code };
}

function paramsOf(raw: unknown): ErrorParams | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const kept = Object.entries(raw).filter(([, v]) => typeof v === "string" || typeof v === "number");
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * The `error` of a response from this app's API. A body without one, such as a proxy's error page, reads as its HTTP
 * status. The code is not checked here, because only the messages know every code. The page shows a code it has no
 * message for (a newer server during a deploy) as `unknownCode`.
 */
export function parseAppError(body: unknown, status: number): AppError {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string" || !code) return { code: "httpStatus", params: { status } };
  return appError(code as ErrorCode, paramsOf((error as { params?: unknown }).params));
}

/** Thrown in the browser to carry a parsed AppError to the catch that shows it. */
export class ApiError extends Error {
  constructor(readonly error: AppError) {
    super(error.code);
  }
}

/** What a catch in the browser shows, the AppError an ApiError carries or the message of anything else thrown. */
export function caught(e: unknown): Reason {
  if (e instanceof ApiError) return e.error;
  return { text: e instanceof Error ? e.message : String(e) };
}
