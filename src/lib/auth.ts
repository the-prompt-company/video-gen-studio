import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { loginId } from "@/lib/credentials";
import { verifyPassword } from "@/lib/crypto";
import { errorDetail } from "@/lib/error-detail";
import { SESSION_COOKIE, SESSION_TTL_S, revokedByPasswordChange, signSession, verifySessionToken, type Session, type SessionUser } from "@/lib/session";

export { SESSION_COOKIE, verifySessionToken, type SessionUser };

export async function getUnverifiedSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** One `users` read per render: the root layout's language and the page's own checks share it. */
export const getCurrentUser = cache(async () => {
  const s = await getUnverifiedSession();
  if (!s) return null;
  const db = getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id)).limit(1);
  if (!u || !u.active || revokedByPasswordChange(s.issuedAtS, u.passwordChangedAt)) return null;
  return u;
});

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

export async function attemptSignIn(username: string, password: string): Promise<User> {
  const db = getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.username, loginId(username))).limit(1);
  const wrong = new HttpError(401, "ID 또는 비밀번호가 맞지 않습니다");
  if (!u) throw wrong;
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    throw new HttpError(423, `실패가 누적되어 잠겼습니다. ${LOCK_MINUTES}분 후 다시 시도하세요`);
  }
  if (!u.active) throw new HttpError(403, "비활성화된 계정입니다");

  if (!verifyPassword(password, u.passwordHash)) {
    const failures = u.failedAttempts + 1;
    await db
      .update(schema.users)
      .set({
        failedAttempts: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(schema.users.id, u.id));
    throw wrong;
  }
  if (u.failedAttempts > 0 || u.lockedUntil) {
    await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  }
  return u;
}

export async function setSessionCookie(user: SessionUser) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "로그인이 필요합니다");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "관리자만 사용할 수 있습니다");
  return u;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  // An unexpected error can carry SQL text or server paths. The browser gets a reference; the log keeps the detail.
  const ref = randomUUID().slice(0, 8);
  console.error(JSON.stringify({ evt: "unhandled_error", ref, error: errorDetail(e) }));
  return Response.json({ error: `서버 오류가 발생했습니다 (참조 ${ref})` }, { status: 500 });
}
