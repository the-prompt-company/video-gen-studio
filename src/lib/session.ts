import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "vgs_session";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

export type SessionUser = { id: number; username: string; role: "user" | "admin" };

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

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    const id = Number(payload.sub);
    if (!id || typeof payload.u !== "string") return null;
    return { id, username: payload.u, role: payload.r === "admin" ? "admin" : "user" };
  } catch {
    return null;
  }
}

