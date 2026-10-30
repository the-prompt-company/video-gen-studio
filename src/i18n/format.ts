import type { createFormatter } from "next-intl";

/** What useFormatter() and getFormatter() return, with the page's language and Seoul time already in it. */
type Format = ReturnType<typeof createFormatter>;

type When = Date | string | number;

/**
 * Whole dollars from $100, cents from $1, otherwise four places, so a rate reads $0.0985 in every language. The narrow
 * symbol keeps Korean and Chinese from printing US$, and no grouping keeps $1234 as the dashboard always showed it.
 */
export function usd(format: Format, value: number | string | null | undefined): string {
  const v = Number(value ?? 0);
  const digits = v >= 100 ? 0 : v >= 1 ? 2 : 4;
  return format.number(v, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

export function dateTime(format: Format, value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short", hourCycle: "h23" });
}

/**
 * "3분 전". `now` comes from the page that rendered the list, never from Date.now() during render, so the server's
 * HTML and the browser's first render print the same text.
 */
export function ago(format: Format, value: When, now: When): string {
  return format.relativeTime(new Date(value), new Date(now));
}
