/** Feature: admin — users table, the edit / add / import modals, model price round-trip, logs tab. See features/admin.md. */
export default async function admin({ page, ev, creds }) {
  const until = async (check, what, timeout = 10_000) => {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) ev.fail(typeof what === "function" ? await what() : what);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const focused = (locator) => locator.evaluate((el) => el === document.activeElement);
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const wheelAt = async (x, y, dy = 600) => {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, dy);
  };
  const full = page.viewportSize();

  await ev.login("/playground");
  if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail(`${creds.username} is not an admin: run with VGS_USER/VGS_PASS of an admin account`);
  await page.goto(page.url().replace(/\/playground.*/, "/admin"), { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "어드민", level: 1 }).isVisible())) ev.fail("admin h1 missing");

  // admin-users: table lists at least the signed-in admin; its rows, 사용자 추가 and 엑셀로 회원 만들기 open modals.
  await page.getByRole("button", { name: "사용자 · API 키" }).click();
  const idButton = page.getByRole("button", { name: `${creds.username} 편집`, exact: true });
  const row = page.getByRole("row").filter({ has: idButton });
  await row.waitFor({ timeout: 15_000 });
  const addButton = page.getByRole("button", { name: "사용자 추가", exact: true });
  const importButton = page.getByRole("button", { name: "엑셀로 회원 만들기", exact: true });
  if (!(await addButton.isVisible()) || !(await importButton.isVisible())) ev.fail("the users tab should show 사용자 추가 and 엑셀로 회원 만들기 buttons");
  if ((await page.getByRole("heading", { level: 2, name: "사용자 추가" }).count()) || (await page.getByRole("heading", { level: 2, name: "엑셀로 회원 만들기" }).count())) ev.fail("사용자 추가 and 엑셀로 회원 만들기 should not be open panels before their buttons are pressed");
  await ev.shot("users");

  // The lock only shows on a page that overflows. With few members the page fits, so the scroll checks look through a shorter window.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const lockView = pageHeight > full.height ? full : { width: full.width, height: Math.floor(pageHeight * 0.6) };
  if (lockView !== full) {
    await page.setViewportSize(lockView);
    ev.note(`the page is ${pageHeight}px tall, inside the ${full.height}px viewport, so the scroll checks run at ${lockView.width}×${lockView.height}`);
  }
  await wheelAt(lockView.width / 2, lockView.height / 2);
  await until(async () => (await scrollY()) > 0, "control: the wheel did not scroll the page with no modal open");
  await page.evaluate(() => window.scrollTo(0, 0));
  ev.note("control: with no modal open the wheel scrolls the admin page");

  await addButton.click();
  const add = page.getByRole("dialog", { name: "사용자 추가" });
  await add.waitFor({ timeout: 10_000 });
  const idField = add.getByLabel("ID", { exact: true });
  if (!(await focused(idField))) ev.fail("opening 사용자 추가 should focus its ID field");
  if ((await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)) !== "hidden") ev.fail("the page behind an open modal should have overflow hidden");
  const held = await scrollY();
  await wheelAt(lockView.width - 8, lockView.height / 2, held > 0 ? -600 : 600);
  await new Promise((r) => setTimeout(r, 600));
  if ((await scrollY()) !== held) ev.fail(`the page behind the open modal scrolled from ${held} to ${await scrollY()}`);
  if (lockView !== full) await page.setViewportSize(full);
  ev.note(`adm-modal-add: dialog named 사용자 추가, focus on ID, page overflow hidden and held at scrollY ${held} after a wheel ${held > 0 ? "up" : "down"}`);
  await idField.fill("vgs-mod-draft");
  await ev.shot("modal-add");
  await page.keyboard.press("Escape");
  await add.waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await focused(addButton))) ev.fail("Esc should return focus to 사용자 추가");
  await addButton.click();
  await add.waitFor({ timeout: 5_000 });
  if ((await idField.inputValue()) !== "vgs-mod-draft") ev.fail("a typed 사용자 추가 draft should survive closing and reopening");
  await idField.fill("");
  if (full.width >= 640) {
    await page.mouse.click(8, 8);
    await add.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note("adm-modal-add: Esc closed it with focus back on 사용자 추가, the draft survived reopening, and a backdrop click closed it");
  } else {
    await add.getByRole("button", { name: "닫기" }).click();
    await add.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note("adm-modal-add: Esc closed it with focus back on 사용자 추가, the draft survived reopening, and 닫기 closed it");
  }

  await importButton.click();
  const importer = page.getByRole("dialog", { name: "엑셀로 회원 만들기" });
  await importer.waitFor({ timeout: 10_000 });
  if (!(await importer.evaluate((d) => d.contains(document.activeElement)))) ev.fail("opening 엑셀로 회원 만들기 should move focus into it");
  if (!(await importer.getByRole("table", { name: "엑셀 형식 예시" }).isVisible())) ev.fail("the import modal should show the expected format");
  await ev.shot("modal-import");
  await importer.getByRole("button", { name: "닫기" }).click();
  await importer.waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await focused(importButton))) ev.fail("닫기 should return focus to 엑셀로 회원 만들기");
  ev.note("adm-modal-import: dialog named 엑셀로 회원 만들기, focus inside, 닫기 closed it with focus back on its button");

  await idButton.focus();
  await page.keyboard.press("Enter");
  const edit = page.getByRole("dialog", { name: `${creds.username} 편집` });
  await edit.waitFor({ timeout: 10_000 });
  if (!(await edit.evaluate((d) => d.contains(document.activeElement)))) ev.fail("opening the editor should move focus into it");
  await page.keyboard.press("Escape");
  await edit.waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await focused(idButton))) ev.fail("Esc should return focus to the row's ID button");
  await row.click();
  await edit.waitFor({ timeout: 10_000 });
  if (!(await edit.getByPlaceholder("key-id:key-secret").isVisible())) ev.fail("API key form missing in the editor");
  await ev.shot("user-edit");
  await page.keyboard.press("Escape");
  await edit.waitFor({ state: "hidden", timeout: 5_000 });
  ev.note(`adm-user-edit: dialog named "${creds.username} 편집" opened from the keyboard and by a row click; Esc returned focus to the row's button`);

  // admin-price: change a model's price, confirm the server stored it, then restore. Reversible mutation.
  // Under next dev the panel's mount effect runs twice; a price typed before the second load lands is reset, so wait for every load.
  const loads = new Set();
  const isLoad = (r) => r.method() === "GET" && new URL(r.url()).pathname === "/api/admin/models";
  page.on("request", (r) => isLoad(r) && loads.add(r));
  page.on("requestfinished", (r) => loads.delete(r));
  page.on("requestfailed", (r) => loads.delete(r));
  await page.getByRole("button", { name: "모델 · 단가" }).click();
  const before = await ev.api("/api/admin/models");
  if (before.status !== 200 || !Array.isArray(before.body?.items)) ev.fail(`/api/admin/models returned ${before.status}`);
  const ids = before.body.items.map((m) => m.modelId);
  if (ids.join(",") !== "bytedance/seedance-2.0,minimax/h3,openai/gpt-image-2") ev.fail(`the 모델 tab should list Seedance 2.0, MiniMax H3 and GPT Image 2, got ${ids.join(", ")}`);
  for (const [id, unit] of [["bytedance/seedance-2.0", "480p·16:9 기준 초당 USD"], ["minimax/h3", "2K 기준 초당 USD"], ["openai/gpt-image-2", "이미지 출력 기준 100만 토큰당 USD"]]) {
    const row = page.getByRole("listitem").filter({ hasText: id });
    if (!(await row.getByText(unit).isVisible())) ev.fail(`${id} row does not say what its rate means (${unit})`);
  }
  ev.note("adm-rate-meaning: Seedance reads 480p·16:9 기준 초당 USD, H3 reads 2K 기준 초당 USD, GPT Image 2 reads 이미지 출력 기준 100만 토큰당 USD");
  const gptRow = page.getByRole("listitem").filter({ hasText: "openai/gpt-image-2" });
  if (!(await gptRow.getByRole("button", { name: "OpenAI 정가 30로 채우기" }).isVisible())) ev.fail("GPT Image 2 offers no one-click OpenAI price");
  if (!(await gptRow.getByText(/^예: 1024×1024 중간 품질 1장 \$/).isVisible())) ev.fail("GPT Image 2 shows no example cost");
  if (!(await gptRow.getByRole("button", { name: /사용 중 · 끄기|꺼짐 · 켜기/ }).isVisible())) ev.fail("GPT Image 2 has no enable toggle");
  ev.note(`adm-image-model: GPT Image 2 listed with its unit, the OpenAI 정가 $30 fill, "${(await gptRow.getByText(/^예: /).textContent())?.trim()}", and its toggle`);
  const target = before.body.items.find((m) => m.modelId === "minimax/h3");
  const original = Number(target.pricePerSecUsd);
  const rowEl = page.getByRole("listitem").filter({ hasText: target.modelId });
  await rowEl.waitFor({ timeout: 10_000 });
  const input = rowEl.getByRole("spinbutton");
  const save = rowEl.getByRole("button", { name: "저장" });
  const stored = async () => Number((await ev.api("/api/admin/models")).body?.items?.find((m) => m.modelId === target.modelId)?.pricePerSecUsd);
  try {
    await until(async () => loads.size === 0 && (await input.inputValue()) === String(original), `the price field never settled on the stored ${original}`);
    const fills = rowEl.getByRole("button", { name: /로 채우기$/ });
    const published = await fills.evaluateAll((els) => els.map((el) => ({ name: el.getAttribute("aria-label"), rate: Number(/([\d.]+)로 채우기$/.exec(el.getAttribute("aria-label") ?? "")?.[1]) })));
    const differing = published.find((p) => p.rate !== original);
    if (!differing) ev.fail(`H3 offers no published rate other than the stored ${original} to fill`);
    const probe = differing.rate;
    await rowEl.getByRole("button", { name: differing.name, exact: true }).click();
    if ((await input.inputValue()) !== String(probe)) ev.fail(`the published-rate chip filled ${await input.inputValue()}, wanted ${probe}`);
    const example = await rowEl.getByText(/^예: 10초 \$/).textContent();
    const cost = probe * 10;
    if (example?.trim() !== `예: 10초 $${cost.toFixed(cost >= 1 ? 2 : 4)}`) ev.fail(`the example cost should follow the typed rate: ${example}`);
    if (!(await save.isEnabled())) ev.fail("저장 stayed disabled after filling the price");
    await save.click();
    await until(async () => (await stored()) === probe, async () => `price save did not persist: wanted ${probe}, server has ${await stored()}`);
    ev.note(`price round-trip on ${target.modelId}: ${original} → ${probe} by the published-rate chip (persisted); ${example}`);
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
