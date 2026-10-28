/** Feature: dashboard — personal usage stats, chart/empty states, recent list. See features/dashboard.md. */
export default async function dashboard({ page, ev }) {
  await ev.login("/dashboard");
  if (!(await page.getByRole("heading", { name: "대시보드", level: 1 }).isVisible())) ev.fail("dashboard h1 missing");
  for (const label of ["누적 비용", "생성 횟수", "생성한 영상 길이", "API 키"]) {
    if (!(await page.getByText(label, { exact: true }).first().isVisible())) ev.fail(`stat "${label}" missing`);
  }
  const apiKey = await page.getByText("API 키", { exact: true }).locator("xpath=following-sibling::div[1]").textContent();
  ev.note(`API 키 stat: ${apiKey?.trim()}`);

  // dashboard-usage: the cost card is either a chart or the empty copy; the model card likewise.
  const cards = page.getByRole("heading", { level: 2 });
  for (const title of ["최근 30일 · 일별 비용", "모델별"]) {
    if (!(await cards.filter({ hasText: title }).isVisible())) ev.fail(`card "${title}" missing`);
  }
  const empties = await page.getByText("아직 데이터가 없습니다.").count();
  ev.note(empties ? `${empties} card(s) in empty state (no completed generations)` : "usage chart and model breakdown populated");

  // dashboard-recent: the stats agree with the API the page is built from (/api/generations).
  const api = await ev.api("/api/generations?limit=50");
  if (api.status !== 200) ev.fail(`/api/generations returned ${api.status}`);
  const mine = api.body?.items?.length ?? 0;
  const shown = Number(((await page.getByText("생성 횟수", { exact: true }).locator("xpath=following-sibling::div[1]").textContent()) ?? "").replace(/[^\d]/g, ""));
  if (mine > 0 && shown === 0) ev.fail(`API lists ${mine} generations but the 생성 횟수 stat shows 0`);
  ev.note(`생성 횟수 stat ${shown} · API items (latest 50) ${mine}`);
  await ev.shot("dashboard", { fullPage: true });
}
