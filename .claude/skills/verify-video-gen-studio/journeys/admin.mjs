/** Feature: admin — users table, user detail, model price round-trip, logs tab. See features/admin.md. */
export default async function admin({ page, ev, creds }) {
  await ev.login("/playground");
  if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail(`${creds.username} is not an admin: run with VGS_USER/VGS_PASS of an admin account`);
  await page.goto(page.url().replace(/\/playground.*/, "/admin"), { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "어드민", level: 1 }).isVisible())) ev.fail("admin h1 missing");

  // admin-users: table lists at least the signed-in admin; clicking a row opens its edit card.
  const usersTab = page.getByRole("button", { name: "사용자 · API 키" });
  await usersTab.click();
  const row = page.getByRole("row").filter({ hasText: creds.username }).first();
  await row.waitFor({ timeout: 15_000 });
  await ev.shot("users");
  await row.click();
  const edit = page.getByRole("heading", { level: 2, name: `${creds.username} 편집` });
  await edit.waitFor({ timeout: 10_000 });
  if (!(await page.getByPlaceholder("key-id:key-secret").isVisible())) ev.fail("API key form missing in the edit card");
  await ev.shot("user-edit");

  // admin-price: change a model's price, confirm the server stored it, then restore. Reversible mutation.
  await page.getByRole("button", { name: "모델 · 단가" }).click();
  const before = await ev.api("/api/admin/models");
  if (before.status !== 200 || !Array.isArray(before.body?.items)) ev.fail(`/api/admin/models returned ${before.status}`);
  const target = before.body.items.find((m) => /hailuo/i.test(m.modelId)) ?? before.body.items[0];
  if (!target) ev.fail("no model rows in admin");
  const original = Number(target.pricePerSecUsd);
  const probe = Number((original + 0.0001).toFixed(4));
  const rowEl = page.getByRole("row").filter({ hasText: target.modelId });
  await rowEl.waitFor({ timeout: 10_000 });
  const input = rowEl.getByRole("spinbutton");
  const save = rowEl.getByRole("button", { name: "저장" });
  try {
    await input.fill(String(probe));
    if (!(await save.isEnabled())) ev.fail("저장 stayed disabled after editing the price");
    await save.click();
    await page.waitForTimeout(500);
    const after = await ev.api("/api/admin/models");
    const stored = Number(after.body.items.find((m) => m.modelId === target.modelId)?.pricePerSecUsd);
    if (stored !== probe) ev.fail(`price save did not persist: wanted ${probe}, server has ${stored}`);
    ev.note(`price round-trip on ${target.modelId}: ${original} → ${probe} (persisted)`);
    await ev.shot("price-saved");
  } finally {
    const restore = await ev.api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId: target.modelId, pricePerSecUsd: original }) });
    ev.note(`price restored to ${original}: HTTP ${restore.status}`);
  }

  // admin-logs: the logs tab renders its table (or empty copy) without an error banner.
  await page.getByRole("button", { name: "로그 · 히스토리" }).click();
  await page.waitForLoadState("networkidle");
  if (await page.getByText(/^HTTP \d{3}/).isVisible().catch(() => false)) ev.fail("logs tab shows an HTTP error");
  await ev.shot("logs", { fullPage: true });
}
