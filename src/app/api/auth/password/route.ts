import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorResponse, HttpError, setSessionCookie, verifyCredentials } from "@/lib/auth";
import { newPasswordError } from "@/lib/credentials";
import { hashPassword } from "@/lib/crypto";

/** POST /api/auth/password — change a password with the current one, then sign in like /api/auth/login. */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { username?: string; currentPassword?: string; newPassword?: string };
    const username = String(b.username ?? "");
    const currentPassword = String(b.currentPassword ?? "");
    const newPassword = String(b.newPassword ?? "");
    if (!username.trim() || !currentPassword || !newPassword) {
      throw new HttpError(400, "ID, 현재 비밀번호, 새 비밀번호를 모두 입력하세요");
    }
    // Checked before the current password, so a refused new password never counts toward the lock.
    const problem = newPasswordError(currentPassword, newPassword);
    if (problem) throw new HttpError(400, problem);

    const u = await verifyCredentials(username, currentPassword);
    const now = new Date();
    await getDb()
      .update(schema.users)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: now, lastLoginAt: now })
      .where(eq(schema.users.id, u.id));
    await setSessionCookie(u);
    return Response.json({ ok: true, role: u.role });
  } catch (e) {
    return errorResponse(e);
  }
}
