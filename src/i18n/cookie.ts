import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./locale";

export async function setLocaleCookie(locale: Locale) {
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}
