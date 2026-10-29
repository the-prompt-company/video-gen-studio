import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "vgs_session";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

export type SessionUser = { id: number; username: string; role: "user" | "admin" };
/** A verified session. `issuedAt` is the token's iat, in whole seconds. */
export type Session = SessionUser & { issuedAt: number };

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ chars)");
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ u: user.username, r: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    const id = Number(payload.sub);
    if (!id || typeof payload.u !== "string" || typeof payload.iat !== "number") return null;
    return { id, username: payload.u, role: payload.r === "admin" ? "admin" : "user", issuedAt: payload.iat };
  } catch {
    return null;
  }
}

/**
 * A session signed before the password last changed belongs to the old password. iat drops the milliseconds,
 * so the comparison is in whole seconds: the session the change itself signs, later in that second, stays valid.
 * The cost is that a session signed earlier in the same second survives too.
 */
export function revokedByPasswordChange(issuedAt: number, passwordChangedAt: Date | null): boolean {
  return passwordChangedAt !== null && issuedAt < Math.floor(passwordChangedAt.getTime() / 1000);
}
