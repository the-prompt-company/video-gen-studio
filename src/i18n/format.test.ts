import { test } from "node:test";
import assert from "node:assert/strict";
import { createFormatter } from "use-intl/core";
import { LOCALES, TIME_ZONE, type Locale } from "./locale";
import { ago, dateTime, usd } from "./format";

// Vercel functions run in UTC. Every date below must still read in Seoul time.
process.env.TZ = "UTC";

const formatter = (locale: Locale) => createFormatter({ locale, timeZone: TIME_ZONE });

test("dollars read $ with today's digits rule in every language, never US$", () => {
  for (const locale of LOCALES) {
    const f = formatter(locale);
    assert.deepEqual([usd(f, 0.225), usd(f, 12.5), usd(f, 1234), usd(f, "0.0985"), usd(f, null)], ["$0.2250", "$12.50", "$1234", "$0.0985", "$0.0000"], locale);
  }
});

test("a date and time read in Seoul time, 24-hour, in each language's short pattern", () => {
  const at = new Date("2026-10-29T07:05:00Z");
  assert.equal(dateTime(formatter("ko"), at), "26. 10. 29. 16:05");
  assert.equal(dateTime(formatter("en"), at), "10/29/26, 16:05");
  assert.equal(dateTime(formatter("zh-CN"), at.toISOString()), "2026/10/29 16:05");
  assert.equal(dateTime(formatter("ko"), new Date("2026-10-28T15:05:00Z")), "26. 10. 29. 00:05", "past midnight in Seoul is the next day, hour 00");
  assert.equal(dateTime(formatter("en"), null), "—");
});

test("a relative time counts back from the `now` it is given, so the server and the browser agree", () => {
  const now = new Date("2026-10-29T07:05:00Z");
  const before = (s: number) => new Date(now.getTime() - s * 1000);
  assert.deepEqual(
    LOCALES.map((l) => ago(formatter(l), before(180), now)),
    ["3분 전", "3 minutes ago", "3分钟前"],
  );
  assert.deepEqual(
    LOCALES.map((l) => ago(formatter(l), before(5).toISOString(), now.getTime())),
    ["5초 전", "5 seconds ago", "5秒钟前"],
  );
  assert.equal(ago(formatter("ko"), before(2 * 3600), now), "2시간 전");
  assert.equal(ago(formatter("en"), before(3 * 86400), now), "3 days ago");
});
