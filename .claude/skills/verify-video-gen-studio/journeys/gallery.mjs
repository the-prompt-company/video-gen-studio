/** Feature: gallery — tiles, detail dialog, download link, admin scope toggle. See features/gallery.md. */
export default async function gallery({ page, ev }) {
  await ev.login("/gallery");
  if (!(await page.getByRole("heading", { name: "갤러리", level: 1 }).isVisible())) ev.fail("gallery h1 missing");
  const tiles = page.getByRole("button", { name: /자세히 보기$/ });
  const count = await tiles.count();
  await ev.shot("grid");
  if (count === 0) ev.fail("no completed generations for this user: run `npm run db:mock` first (precondition), or complete a real generation");
  ev.note(`${count} tile(s)`);

  // gallery-detail: open the first tile; the dialog shows the video, meta line, and a download link.
  await tiles.first().click();
  const dialog = page.getByRole("dialog", { name: "생성 상세" });
  await dialog.waitFor({ timeout: 5_000 });
  const video = dialog.getByLabel("생성된 영상");
  const src = await video.getAttribute("src");
  if (!src) ev.fail("detail video has no src");
  await video.evaluate((v) => new Promise((res, rej) => { if (v.readyState >= 1) return res(); v.onloadedmetadata = res; v.onerror = () => rej(new Error("video failed to load")); setTimeout(() => rej(new Error("video metadata timeout")), 15_000); }));
  const size = await video.evaluate((v) => `${v.videoWidth}×${v.videoHeight}`);
  ev.note(`detail video ${src} loaded at ${size}`);
  const download = dialog.getByRole("link", { name: "다운로드" });
  if (!(await download.isVisible())) ev.fail("download link missing in detail");
  const href = await download.getAttribute("href");
  if (href !== src && !href?.startsWith(`${src}?download=`)) ev.fail("download href differs from the video src");
  await ev.shot("detail");

  // gallery-close: Esc closes the dialog.
  await page.keyboard.press("Escape");
  if (await dialog.isVisible().catch(() => false)) ev.fail("Esc did not close the detail dialog");

  // gallery-scope (admin only): 전체 shows at least as many tiles as 내 것.
  const all = page.getByRole("link", { name: "전체", exact: true });
  if (await all.isVisible()) {
    await all.click();
    await page.waitForURL("**/gallery?all=1");
    await page.waitForLoadState("networkidle");
    const allCount = await tiles.count();
    if (allCount < count) ev.fail(`전체 (${allCount}) shows fewer tiles than 내 것 (${count})`);
    ev.note(`admin scope toggle: 내 것 ${count} → 전체 ${allCount}`);
    await ev.shot("all-scope");
  } else ev.note("not an admin: scope toggle absent (expected)");
}
