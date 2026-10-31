const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Feature: admin — users table, the edit / add / import modals, model price round-trip, logs tab. See features/admin.md. */
export default async function admin({ page, ev, creds }) {
  /** The whole message as a RegExp whose named slots match the given sources, such as `{ rate: "\\$[\\d.]+" }`. */
  const shape = async (key, slots, values = {}) => {
    const marks = Object.keys(slots).map((_, i) => String.fromCharCode(1 + i));
    let source = literal(await ev.t(key, { ...values, ...Object.fromEntries(Object.keys(slots).map((k, i) => [k, marks[i]])) }));
    Object.values(slots).forEach((s, i) => (source = source.replace(marks[i], () => s)));
    return new RegExp(`^${source}$`);
  };
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
  if (!(await page.getByRole("heading", { name: await ev.t("pages.admin"), level: 1 }).isVisible())) ev.fail("admin h1 missing");

  // admin-users: table lists at least the signed-in admin; its rows, members.add.title and import.title open modals.
  await page.getByRole("button", { name: await ev.t("admin.tabs.users"), exact: true }).click();
  const editName = await ev.t("members.edit", { username: creds.username });
  const idButton = page.getByRole("button", { name: editName, exact: true });
  const row = page.getByRole("row").filter({ has: idButton });
  await row.waitFor({ timeout: 15_000 });
  const addTitle = await ev.t("members.add.title");
  const importTitle = await ev.t("import.title");
  const addButton = page.getByRole("button", { name: addTitle, exact: true });
  const importButton = page.getByRole("button", { name: importTitle, exact: true });
  if (!(await addButton.isVisible()) || !(await importButton.isVisible())) ev.fail(`the users tab should show the "${addTitle}" and "${importTitle}" buttons`);
  if ((await page.getByRole("heading", { level: 2, name: addTitle }).count()) || (await page.getByRole("heading", { level: 2, name: importTitle }).count())) ev.fail(`"${addTitle}" and "${importTitle}" should not be open panels before their buttons are pressed`);
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
  const add = page.getByRole("dialog", { name: addTitle });
  await add.waitFor({ timeout: 10_000 });
  const idField = add.getByLabel("ID", { exact: true });
  if (!(await focused(idField))) ev.fail(`opening "${addTitle}" should focus its ID field`);
  if ((await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)) !== "hidden") ev.fail("the page behind an open modal should have overflow hidden");
  const held = await scrollY();
  await wheelAt(lockView.width - 8, lockView.height / 2, held > 0 ? -600 : 600);
  await new Promise((r) => setTimeout(r, 600));
  if ((await scrollY()) !== held) ev.fail(`the page behind the open modal scrolled from ${held} to ${await scrollY()}`);
  if (lockView !== full) await page.setViewportSize(full);
  ev.note(`adm-modal-add: dialog named "${addTitle}", focus on ID, page overflow hidden and held at scrollY ${held} after a wheel ${held > 0 ? "up" : "down"}`);
  await idField.fill("vgs-mod-draft");
  await ev.shot("modal-add");
  await page.keyboard.press("Escape");
  await add.waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await focused(addButton))) ev.fail(`Esc should return focus to "${addTitle}"`);
  await addButton.click();
  await add.waitFor({ timeout: 5_000 });
  if ((await idField.inputValue()) !== "vgs-mod-draft") ev.fail(`a typed "${addTitle}" draft should survive closing and reopening`);
  await idField.fill("");
  if (full.width >= 640) {
    await page.mouse.click(8, 8);
    await add.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-modal-add: Esc closed it with focus back on "${addTitle}", the draft survived reopening, and a backdrop click closed it`);
  } else {
    await add.getByRole("button", { name: await ev.t("common.close") }).click();
    await add.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-modal-add: Esc closed it with focus back on "${addTitle}", the draft survived reopening, and common.close closed it`);
  }

  await importButton.click();
  const importer = page.getByRole("dialog", { name: importTitle });
  await importer.waitFor({ timeout: 10_000 });
  if (!(await importer.evaluate((d) => d.contains(document.activeElement)))) ev.fail(`opening "${importTitle}" should move focus into it`);
  if (!(await importer.getByRole("table", { name: await ev.t("import.example.label") }).isVisible())) ev.fail("the import modal should show the expected format");
  await ev.shot("modal-import");
  await importer.getByRole("button", { name: await ev.t("common.close") }).click();
  await importer.waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await focused(importButton))) ev.fail(`common.close should return focus to "${importTitle}"`);
  ev.note(`adm-modal-import: dialog named "${importTitle}", focus inside, common.close closed it with focus back on its button`);

  await idButton.focus();
  await page.keyboard.press("Enter");
  const edit = page.getByRole("dialog", { name: editName });
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
  ev.note(`adm-user-edit: dialog named "${editName}" opened from the keyboard and by a row click; Esc returned focus to the row's button`);

  // admin-price: change a model's price, confirm the server stored it, then restore. Reversible mutation.
  // Under next dev the panel's mount effect runs twice; a price typed before the second load lands is reset, so wait for every load.
  const loads = new Set();
  const isLoad = (r) => r.method() === "GET" && new URL(r.url()).pathname === "/api/admin/models";
  page.on("request", (r) => isLoad(r) && loads.add(r));
  page.on("requestfinished", (r) => loads.delete(r));
  page.on("requestfailed", (r) => loads.delete(r));
  await page.getByRole("button", { name: await ev.t("admin.tabs.models"), exact: true }).click();
  const before = await ev.api("/api/admin/models");
  if (before.status !== 200 || !Array.isArray(before.body?.items)) ev.fail(`/api/admin/models returned ${before.status}`);
  const ids = before.body.items.map((m) => m.modelId);
  if (ids.join(",") !== "bytedance/seedance-2.0,minimax/h3,openai/gpt-image-2") ev.fail(`the models tab should list Seedance 2.0, MiniMax H3 and GPT Image 2, got ${ids.join(", ")}`);
  const units = [];
  for (const [id, basis, unit] of [["bytedance/seedance-2.0", "seedance", "second"], ["minimax/h3", "h3", "second"], ["openai/gpt-image-2", "gptImage2", "mTokens"]]) {
    const text = await ev.t("models.unit", { basis: await ev.t(`prices.basis.${basis}`), per: await ev.t("prices.per", { unit }) });
    const row = page.getByRole("listitem").filter({ hasText: id });
    if (!(await row.getByText(text).isVisible())) ev.fail(`${id} row does not say what its rate means (${text})`);
    units.push(`${id} reads ${text}`);
  }
  ev.note(`adm-rate-meaning: ${units.join(", ")}`);
  const gptRow = page.getByRole("listitem").filter({ hasText: "openai/gpt-image-2" });
  const gptFill = await ev.t("models.fill", { label: await ev.t("prices.preset.openaiList"), rate: "$30" });
  if (!(await gptRow.getByRole("button", { name: gptFill, exact: true }).isVisible())) ev.fail(`GPT Image 2 offers no one-click OpenAI price ("${gptFill}")`);
  const gptExample = gptRow.getByText(await shape("models.example", { cost: "\\$[\\d.]+" }, { example: await ev.t("prices.example.gptImage2") }));
  if (!(await gptExample.isVisible())) ev.fail("GPT Image 2 shows no example cost");
  const toggle = new RegExp(`^(${literal(await ev.t("models.toggle", { enabled: "yes" }))}|${literal(await ev.t("models.toggle", { enabled: "no" }))})$`);
  if (!(await gptRow.getByRole("button", { name: toggle }).isVisible())) ev.fail("GPT Image 2 has no enable toggle");
  ev.note(`adm-image-model: GPT Image 2 listed with its unit, the "${gptFill}" fill, "${(await gptExample.textContent())?.trim()}", and its toggle`);
  const target = before.body.items.find((m) => m.modelId === "minimax/h3");
  const original = Number(target.pricePerSecUsd);
  const rowEl = page.getByRole("listitem").filter({ hasText: target.modelId });
  await rowEl.waitFor({ timeout: 10_000 });
  const input = rowEl.getByRole("spinbutton");
  const save = rowEl.getByRole("button", { name: await ev.t("common.save"), exact: true });
  const stored = async () => Number((await ev.api("/api/admin/models")).body?.items?.find((m) => m.modelId === target.modelId)?.pricePerSecUsd);
  try {
    await until(async () => loads.size === 0 && (await input.inputValue()) === String(original), `the price field never settled on the stored ${original}`);
    const fills = rowEl.getByRole("button", { name: await shape("models.fill", { label: ".+", rate: "\\$[\\d.]+" }) });
    // The visible text is the preset's label and then its rate, such as "List price $0.13".
    const published = await fills.evaluateAll((els) => els.map((el) => ({ name: el.getAttribute("aria-label"), rate: Number(/\$([\d.]+)\s*$/.exec(el.textContent ?? "")?.[1]) })));
    if (!published.length || published.some((p) => !Number.isFinite(p.rate))) ev.fail(`H3's published-rate buttons read ${JSON.stringify(published)}`);
    const differing = published.find((p) => p.rate !== original);
    if (!differing) ev.fail(`H3 offers no published rate other than the stored ${original} to fill`);
    const probe = differing.rate;
    await rowEl.getByRole("button", { name: differing.name, exact: true }).click();
    if ((await input.inputValue()) !== String(probe)) ev.fail(`the published-rate chip filled ${await input.inputValue()}, wanted ${probe}`);
    const h3Example = await ev.t("prices.example.h3");
    const example = await rowEl.getByText(await shape("models.example", { cost: "\\$[\\d.]+" }, { example: h3Example })).textContent();
    const cost = probe * 10;
    const wanted = await ev.t("models.example", { example: h3Example, cost: `$${cost.toFixed(cost >= 1 ? 2 : 4)}` });
    if (example?.trim() !== wanted) ev.fail(`the example cost should follow the typed rate: "${example}", wanted "${wanted}"`);
    if (!(await save.isEnabled())) ev.fail("common.save stayed disabled after filling the price");
    await save.click();
    await until(async () => (await stored()) === probe, async () => `price save did not persist: wanted ${probe}, server has ${await stored()}`);
    ev.note(`price round-trip on ${target.modelId}: ${original} → ${probe} by the published-rate chip (persisted); ${example}`);
    await ev.shot("price-saved");
  } finally {
    const restore = await ev.api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId: target.modelId, pricePerSecUsd: original }) });
    ev.note(`price restored to ${original}: HTTP ${restore.status}`);
  }

  // admin-logs: the logs tab renders its table (or empty copy) without an error banner.
  await page.getByRole("button", { name: await ev.t("admin.tabs.logs"), exact: true }).click();
  await page.waitForLoadState("networkidle");
  if (await page.getByText(/^HTTP \d{3}/).isVisible().catch(() => false)) ev.fail("logs tab shows an HTTP error");
  await ev.shot("logs", { fullPage: true });
}
