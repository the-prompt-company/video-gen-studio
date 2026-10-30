import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { ErrorParams, Reason } from "@/lib/errors";

/** The `errors` translator looked up by a code that arrives as data, so tsc cannot check the key or its arguments. */
export type ErrorTranslator = { (key: string, values?: ErrorParams): string; has(key: string): boolean };

export function reasonText(t: ErrorTranslator, reason: Reason): string {
  if ("text" in reason) return reason.text;
  return t.has(reason.code) ? t(reason.code, reason.params) : t("unknownCode", { code: reason.code });
}

/** Turns a Reason into text in the page's language: the one place the browser renders a server error. */
export function useErrorText(): (reason: Reason) => string {
  const t = useTranslations("errors") as unknown as ErrorTranslator;
  return useCallback((reason: Reason) => reasonText(t, reason), [t]);
}
