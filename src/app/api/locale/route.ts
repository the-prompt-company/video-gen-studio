import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorResponse, getCurrentUser, HttpError } from "@/lib/auth";
import { setLocaleCookie } from "@/i18n/cookie";
import { LOCALES, parseLocale } from "@/i18n/locale";

/**
 * POST /api/locale { locale } — the language picker. It always sets the cookie. A signed-in member's choice is also
 * stored on the account, so it follows them to other browsers; a visitor on the login screen only has the cookie.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { locale?: unknown } | null;
    const locale = parseLocale(body?.locale);
    if (!locale) throw new HttpError(400, `locale must be one of ${LOCALES.join(", ")}`);
    const user = await getCurrentUser();
    if (user) await getDb().update(schema.users).set({ locale }).where(eq(schema.users.id, user.id));
    await setLocaleCookie(locale);
    return Response.json({ locale });
  } catch (e) {
    return errorResponse(e);
  }
}
