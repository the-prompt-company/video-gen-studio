import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { attemptSignIn, errorResponse, HttpError, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    if (!username.trim() || !password) throw new HttpError(400, "ID와 비밀번호를 입력하세요");

    const u = await attemptSignIn(username, password);
    if (u.mustChangePassword) return Response.json({ mustChangePassword: true });

    await getDb().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
    await setSessionCookie(u);
    return Response.json({ ok: true, role: u.role });
  } catch (e) {
    return errorResponse(e);
  }
}
