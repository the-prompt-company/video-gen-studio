import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "vgs_session";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

export type SessionUser = { id: number; username: string; role: "user" | "admin" };
export type Session = SessionUser & { issuedAtS: number };

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
    return { id, username: payload.u, role: payload.r === "admin" ? "admin" : "user", issuedAtS: payload.iat };
  } catch {
    return null;
  }
}

// A JWT iat is whole seconds, so this compares seconds: the session a change signs right after it stays valid,
// and so does one signed earlier in that same second.
export function revokedByPasswordChange(issuedAtS: number, passwordChangedAt: Date | null): boolean {
  return passwordChangedAt !== null && issuedAtS < Math.floor(passwordChangedAt.getTime() / 1000);
}
