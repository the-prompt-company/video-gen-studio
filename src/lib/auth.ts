import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, SESSION_TTL_S, signSession, verifySessionToken, type SessionUser } from "@/lib/session";

export { SESSION_COOKIE, verifySessionToken, type SessionUser };

/** The session from the cookie, without a database read. */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** The session, re-checked against the users table (role, active). */
export async function getCurrentUser() {
  const s = await getSession();
  if (!s) return null;
  const db = getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id)).limit(1);
  if (!u || !u.active) return null;
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
  const msg = e instanceof Error ? e.message : String(e);
  console.error(e);
  return Response.json({ error: msg }, { status: 500 });
}
