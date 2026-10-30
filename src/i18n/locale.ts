export const LOCALES = ["ko", "en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";

/** The team works in Seoul, so every member reads Seoul time whatever their browser or the server says. */
export const TIME_ZONE = "Asia/Seoul";

/** Set only by a choice (the picker, or a sign-in that mirrors the member's choice), never from Accept-Language. */
export const LOCALE_COOKIE = "vgs_locale";

/** Each language names itself, so a reader finds theirs whatever language the page is in. */
export const LOCALE_NAMES: Record<Locale, string> = {
  // eslint-disable-next-line i18n/no-hangul -- the Korean name of Korean, shown as is in every locale
  ko: "한국어",
  en: "English",
  "zh-CN": "简体中文",
};

export function parseLocale(raw: unknown): Locale | null {
  return LOCALES.find((l) => l === raw) ?? null;
}

/** Any Chinese tag, Traditional included, gets Simplified Chinese: it reads closer than Korean. */
const BY_LANGUAGE: Record<string, Locale> = { ko: "ko", en: "en", zh: "zh-CN" };

export function fromAcceptLanguage(header: string | null): Locale | null {
  const ranked = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { language: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.language && x.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((x) => BY_LANGUAGE[x.language]).find(Boolean) ?? null;
}

export function resolveLocale(input: { member: string | null; cookie: string | undefined; acceptLanguage: string | null }): Locale {
  return parseLocale(input.member) ?? parseLocale(input.cookie) ?? fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * What a successful sign-in writes. A pick on the login screen during this visit becomes the member's language.
 * Otherwise the member's stored language replaces whatever the browser's cookie says, so on a shared browser the
 * previous member's cookie neither shows to the next member nor ends up stored on their account.
 */
export function localeAfterSignIn({ picked, stored }: { picked: Locale | null; stored: Locale | null }): { store: Locale | null; cookie: Locale | null } {
  return { store: picked, cookie: picked ?? stored };
}
