"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ErrorText } from "@/components/ui";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/locale";

/**
 * Three buttons, each named in its own language. A pick sets the language cookie and, for a signed-in member, the
 * account's language (POST /api/locale), then re-renders the page in place so typed input survives.
 */
export function LanguagePicker({ onPicked, className }: { onPicked?: (locale: Locale) => void; className?: string }) {
  const t = useTranslations("language");
  const current = useLocale();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pick(locale: Locale) {
    if (locale === current || sending) return;
    setSending(true);
    setFailed(false);
    const res = await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
      cache: "no-store",
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    onPicked?.(locale);
    startRefresh(() => router.refresh());
  }

  return (
    <div className={className}>
      <div role="group" aria-label={t("label")} aria-busy={sending || refreshing} className="flex flex-wrap gap-1">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={locale === current}
            onClick={() => pick(locale)}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm transition sm:min-h-10 ${
              locale === current ? "bg-white/12 text-foreground" : "text-muted hover:bg-white/10 hover:text-foreground"
            }`}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </div>
      {failed && (
        <div className="mt-2">
          <ErrorText>{t("failed")}</ErrorText>
        </div>
      )}
    </div>
  );
}
