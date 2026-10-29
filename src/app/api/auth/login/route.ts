import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { attemptSignIn, errorResponse, HttpError, setSessionCookie } from "@/lib/auth";
import { setLocaleCookie } from "@/i18n/cookie";
import { localeAfterSignIn, parseLocale } from "@/i18n/locale";

export async function POST(req: Request) {
  try {
    // `locale` is sent only when the visitor used the language picker during this visit.
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string; locale?: unknown };
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    if (!username.trim() || !password) throw new HttpError(400, "ID와 비밀번호를 입력하세요");

    const u = await attemptSignIn(username, password);
    const locale = localeAfterSignIn({ picked: parseLocale(body.locale), stored: u.locale });
    const db = getDb();
    if (u.mustChangePassword) {
      // A new member's first sign-in always lands here, so a language picked on this screen is kept now, not after the change.
      if (locale.store) await db.update(schema.users).set({ locale: locale.store }).where(eq(schema.users.id, u.id));
      if (locale.cookie) await setLocaleCookie(locale.cookie);
      return Response.json({ mustChangePassword: true });
    }

    await db.update(schema.users).set({ lastLoginAt: new Date(), ...(locale.store && { locale: locale.store }) }).where(eq(schema.users.id, u.id));
    await setSessionCookie(u);
    if (locale.cookie) await setLocaleCookie(locale.cookie);
    return Response.json({ ok: true, role: u.role });
  } catch (e) {
    return errorResponse(e);
  }
}
