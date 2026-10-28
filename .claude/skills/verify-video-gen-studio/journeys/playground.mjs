/** Feature: playground — drawer, model select, aspect pills, reference dialog, generate gate. See features/playground.md. */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export default async function playground({ page, ev, env }) {
  await ev.login("/playground");
  const drawer = page.getByRole("complementary", { name: "생성 설정" });
  if (!(await drawer.isVisible())) ev.fail("drawer aside[aria-label=생성 설정] not visible");
  await ev.shot("drawer");

  // model-select: a native select; the catalog ships Seedance 2.0 + Hailuo 2.3 unless an admin disabled one.
  const model = page.getByLabel("모델");
  const options = await model.locator("option").allTextContents();
  if (options.length === 0) ev.fail("model select has no options (all models disabled in admin?)");
  ev.note(`model options: ${options.join(" | ")}`);
  const seedance = options.find((o) => o.startsWith("Seedance"));
  const hailuo = options.find((o) => o.startsWith("Hailuo"));

  // prompt: typing updates the character-count hint.
  await page.getByLabel("프롬프트").fill("검증용 프롬프트: 비 오는 밤거리, 느린 돌리 인");
  const hint = drawer.getByText(/^\d+자$/);
  if (!(await hint.isVisible())) ev.fail("prompt length hint did not appear");

  // aspect-pills: Seedance exposes 출력 화면비 as pressable pills; 세로 9:16 flips the hint to 세로.
  if (seedance) {
    await model.selectOption({ label: seedance });
    const group = page.getByRole("group", { name: "출력 화면비" });
    await group.waitFor({ timeout: 5_000 });
    const portrait = group.getByRole("button", { name: /9:16/ });
    await portrait.click();
    if ((await portrait.getAttribute("aria-pressed")) !== "true") ev.fail("9:16 pill did not become aria-pressed");
    const pressed = await group.getByRole("button", { pressed: true }).count();
    if (pressed !== 1) ev.fail(`exactly one aspect pill should be pressed, found ${pressed}`);
    await ev.shot("seedance-portrait");
  } else ev.note("Seedance not offered; aspect-pills skipped (unmet precondition)");

  // model-switch: Hailuo has no aspect option; duration is a 6|10 select and the fixed-768p note shows.
  if (hailuo) {
    await model.selectOption({ label: hailuo });
    if (await page.getByRole("group", { name: "출력 화면비" }).isVisible()) ev.fail("aspect pills should disappear for Hailuo");
    const dur = await page.getByLabel("길이(초)").locator("option").allTextContents();
    if (dur.join(",") !== "6,10") ev.fail(`Hailuo duration options should be 6,10, got ${dur.join(",")}`);
    if (!(await drawer.getByText(/768p/).first().isVisible())) ev.fail("Hailuo fixed-768p note missing");
    await ev.shot("hailuo");
  } else ev.note("Hailuo not offered; model-switch skipped (unmet precondition)");

  // refs-dialog: button opens a modal; the picker is a real <input type=file>; Esc closes and focus returns.
  const refsButton = page.getByRole("button", { name: "레퍼런스 추가" });
  await refsButton.click();
  const dialog = page.getByRole("dialog", { name: "레퍼런스 추가" });
  await dialog.waitFor({ timeout: 5_000 });
  await ev.shot("refs-dialog-empty");
  const chooser = dialog.locator('input[type=file][accept^="image/"]');
  await chooser.setInputFiles(join(webDir, "public", "mock", "ref-landscape-1.jpg"));
  // Upload goes to Higgsfield storage through /api/uploads and needs the user's API key.
  // With a key: a thumbnail "1" appears. Without: role=alert explains. Both are real outcomes; record which.
  const thumb = dialog.getByRole("list", { name: "첨부한 레퍼런스" }).locator("li");
  const alert = dialog.getByRole("alert");
  await Promise.race([thumb.first().waitFor({ timeout: 30_000 }), alert.waitFor({ timeout: 30_000 })]).catch(() => ev.fail("neither a thumbnail nor an error appeared within 30s of picking a file"));
  if (await thumb.count()) ev.note(`reference uploaded: ${await thumb.count()} thumbnail(s)`);
  else ev.note(`upload refused (expected without an API key): ${await alert.textContent()}`);
  await ev.shot("refs-dialog-after-pick");
  await page.keyboard.press("Escape");
  if (await dialog.isVisible().catch(() => false)) ev.fail("Esc did not close the reference dialog");
  if (!(await refsButton.evaluate((el) => el === document.activeElement))) ev.fail("focus did not return to 레퍼런스 추가 after closing");

  // generate-gate: without an API key the status banner shows and 생성하기 stays disabled.
  const banner = drawer.getByRole("status");
  const generate = drawer.getByRole("button", { name: "생성하기" });
  if (await banner.isVisible()) {
    if (await generate.isEnabled()) ev.fail("생성하기 must be disabled while the no-API-key banner shows");
    ev.note("no API key on this account: generate correctly disabled; paid submit not exercised");
  } else if (env.VGS_ALLOW_SPEND === "1") {
    if (!(await generate.isEnabled())) ev.fail("API key present but 생성하기 disabled");
    await generate.click();
    const stage = page.getByRole("region", { name: "결과 무대" });
    await stage.getByRole("article").first().waitFor({ timeout: 30_000 });
    ev.note("generation submitted (VGS_ALLOW_SPEND=1); a queued item is on the stage");
  } else ev.note("API key present; paid submit skipped (set VGS_ALLOW_SPEND=1 to exercise it)");
  await ev.shot("generate-gate");
}
