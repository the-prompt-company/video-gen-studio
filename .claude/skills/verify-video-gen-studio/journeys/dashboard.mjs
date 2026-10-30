/** Feature: dashboard — personal usage stats, chart/empty states, recent list. See features/dashboard.md. */
export default async function dashboard({ page, ev }) {
  await ev.login("/dashboard");
  if (!(await page.getByRole("heading", { name: await ev.t("pages.dashboard"), level: 1 }).isVisible())) ev.fail("dashboard h1 missing");
  const stat = async (key) => page.getByText(await ev.t(key), { exact: true }).first();
  const statValue = async (key) => ((await (await stat(key)).locator("xpath=following-sibling::div[1]").textContent()) ?? "").trim();
  for (const key of ["dashboard.stats.totalSpend", "dashboard.stats.generations", "dashboard.stats.videoLength", "dashboard.stats.apiKey"]) {
    if (!(await (await stat(key)).isVisible())) ev.fail(`stat ${key} missing`);
  }
  ev.note(`API key stat: ${await statValue("dashboard.stats.apiKey")}`);

  const cards = page.getByRole("heading", { level: 2 });
  for (const title of [await ev.t("dashboard.daily"), await ev.t("dashboard.byModel"), await ev.t("dashboard.recent", { count: 20 })]) {
    if (!(await cards.filter({ hasText: title }).isVisible())) ev.fail(`card "${title}" missing`);
  }
  const empties = await page.getByText(await ev.t("dashboard.noData"), { exact: true }).count();
  ev.note(empties ? `${empties} card(s) in empty state (no completed generations)` : "usage chart and model breakdown populated");

  const api = await ev.api("/api/generations?limit=50");
  if (api.status !== 200) ev.fail(`/api/generations returned ${api.status}`);
  const mine = api.body?.items?.length ?? 0;
  const shown = Number((await statValue("dashboard.stats.generations")).replace(/[^\d]/g, ""));
  if (mine > 0 && shown === 0) ev.fail(`API lists ${mine} generations but the generations stat shows 0`);
  ev.note(`generations stat ${shown} · API items (latest 50) ${mine}`);
  await ev.shot("dashboard", { fullPage: true });
}
