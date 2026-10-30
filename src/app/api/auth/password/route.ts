import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { attemptSignIn, errorResponse, HttpError, setSessionCookie } from "@/lib/auth";
import { newPasswordError } from "@/lib/credentials";
import { hashPassword } from "@/lib/crypto";
import { setLocaleCookie } from "@/i18n/cookie";
import { localeAfterSignIn, parseLocale } from "@/i18n/locale";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { username?: string; currentPassword?: string; newPassword?: string; locale?: unknown };
    const username = String(b.username ?? "");
    const currentPassword = String(b.currentPassword ?? "");
    const newPassword = String(b.newPassword ?? "");
    if (!username.trim() || !currentPassword || !newPassword) {
      throw new HttpError(400, "passwordFieldsMissing");
    }
    const problem = newPasswordError(currentPassword, newPassword);
    if (problem) throw HttpError.of(400, problem);

    const u = await attemptSignIn(username, currentPassword);
    const locale = localeAfterSignIn({ picked: parseLocale(b.locale), stored: u.locale });
    const now = new Date();
    await getDb()
      .update(schema.users)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: now, lastLoginAt: now, ...(locale.store && { locale: locale.store }) })
      .where(eq(schema.users.id, u.id));
    await setSessionCookie(u);
    if (locale.cookie) await setLocaleCookie(locale.cookie);
    return Response.json({ ok: true, role: u.role });
  } catch (e) {
    return errorResponse(e);
  }
}
