/** Feature: gallery — tiles, detail dialog, download link, admin scope toggle. See features/gallery.md. */
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function gallery({ page, ev }) {
  await ev.login("/gallery");
  if (!(await page.getByRole("heading", { name: await ev.t("pages.gallery"), level: 1 }).isVisible())) ev.fail("gallery h1 missing");
  const [before, after] = (await ev.t("gallery.openDetail", { prompt: "<<prompt>>" })).split("<<prompt>>");
  const tiles = page.getByRole("button", { name: new RegExp(`^${literal(before)}[\\s\\S]*${literal(after)}$`) });
  const count = await tiles.count();
  await ev.shot("grid");
  if (count === 0) ev.fail("no completed generations for this user: run `npm run db:mock` first (precondition), or complete a real generation");
  ev.note(`${count} tile(s)`);

  await tiles.first().click();
  const dialog = page.getByRole("dialog", { name: await ev.t("gallery.detail.title"), exact: true });
  await dialog.waitFor({ timeout: 5_000 });
  const image = dialog.getByRole("img", { name: await ev.t("generation.image"), exact: true });
  const isImage = (await image.count()) > 0;
  const media = isImage ? image : dialog.getByLabel(await ev.t("generation.video"), { exact: true });
  const src = await media.getAttribute("src");
  if (!src) ev.fail(`detail ${isImage ? "image" : "video"} has no src`);
  if (isImage) {
    await media.evaluate((el) => new Promise((res, rej) => { if (el.complete && el.naturalWidth > 0) return res(); el.onload = res; el.onerror = () => rej(new Error("image failed to load")); setTimeout(() => rej(new Error("image load timeout")), 15_000); }));
  } else {
    await media.evaluate((v) => new Promise((res, rej) => { if (v.readyState >= 1) return res(); v.onloadedmetadata = res; v.onerror = () => rej(new Error("video failed to load")); setTimeout(() => rej(new Error("video metadata timeout")), 15_000); }));
  }
  const size = await media.evaluate((el) => (el.tagName === "IMG" ? `${el.naturalWidth}×${el.naturalHeight}` : `${el.videoWidth}×${el.videoHeight}`));
  ev.note(`detail ${isImage ? "image" : "video"} ${src} loaded at ${size}`);
  const download = dialog.getByRole("link", { name: await ev.t("generation.download"), exact: true });
  if (!(await download.isVisible())) ev.fail("download link missing in detail");
  const href = await download.getAttribute("href");
  if (href !== src && !href?.startsWith(`${src}?download=`)) ev.fail("download href differs from the media src");
  await ev.shot("detail");

  await page.keyboard.press("Escape");
  if (await dialog.isVisible().catch(() => false)) ev.fail("Esc did not close the detail dialog");

  const everyone = page.getByRole("link", { name: await ev.t("gallery.scope.everyone"), exact: true });
  if (await everyone.isVisible()) {
    await everyone.click();
    await page.waitForURL("**/gallery?scope=everyone");
    await page.waitForLoadState("networkidle");
    const allCount = await tiles.count();
    if (allCount < count) ev.fail(`scope everyone (${allCount}) shows fewer tiles than scope mine (${count})`);
    ev.note(`admin scope toggle: mine ${count} → everyone ${allCount}`);
    await ev.shot("everyone-scope");
  } else ev.note("not an admin: scope toggle absent (expected)");
}
