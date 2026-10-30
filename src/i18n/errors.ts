import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ErrorParams, Reason } from "@/lib/errors";

/** A translator looked up by a key that arrives as data (an error code, a stored param), so tsc cannot check the key or its arguments. */
export type KeyTranslator = { (key: string, values?: ErrorParams): string; has(key: string): boolean };

/** A parameter's name from the `params` translator. A key no message names, such as a stored row's `seed`, reads as itself. */
export function paramLabelOf(t: KeyTranslator): (key: string) => string {
  return (key) => (t.has(key) ? t(key) : key);
}

/** A param blocker carries the parameter's key as `param`, and its message quotes the name as `label`. */
export function reasonText(t: KeyTranslator, reason: Reason, paramLabel: (key: string) => string = (key) => key): string {
  if ("text" in reason) return reason.text;
  if (!t.has(reason.code)) return t("unknownCode", { code: reason.code });
  const param = reason.params?.param;
  return t(reason.code, param === undefined ? reason.params : { ...reason.params, label: paramLabel(String(param)) });
}

export function useParamLabel(): (key: string) => string {
  const t = useTranslations("params") as unknown as KeyTranslator;
  return useMemo(() => paramLabelOf(t), [t]);
}

/** Turns a Reason into text in the page's language. Every server error the browser shows goes through it. */
export function useErrorText(): (reason: Reason) => string {
  const t = useTranslations("errors") as unknown as KeyTranslator;
  const paramLabel = useParamLabel();
  return useCallback((reason: Reason) => reasonText(t, reason, paramLabel), [t, paramLabel]);
}
