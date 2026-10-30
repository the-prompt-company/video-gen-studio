import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { LOCALE_COOKIE, resolveLocale, TIME_ZONE } from "./locale";

export default getRequestConfig(async () => {
  const [jar, h, user] = await Promise.all([cookies(), headers(), getCurrentUser()]);
  const locale = resolveLocale({ member: user?.locale ?? null, cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
