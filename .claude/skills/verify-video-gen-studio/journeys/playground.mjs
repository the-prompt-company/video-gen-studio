/** Feature: playground — drawer, model select, aspect pills, reference dialog, generate gate, live polling. See features/playground.md. */
import { writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LIVE = new Set(["queued", "in_progress"]);

/** Group poll requests into ticks: requests less than 500 ms apart belong to one tick. */
function ticks(polls) {
  const out = [];
  for (const p of [...polls].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && p.t - last.t < 500) last.n += 1;
    else out.push({ t: p.t, n: 1 });
  }
  return out;
}

export default async function playground({ page, ev, env }) {
  // Every GET /api/generations/<id> the page makes, with its response, so pg-poll can judge them.
  const polls = [];
  const lists = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() !== "GET") return;
    const { pathname } = new URL(res.url());
    if (pathname === "/api/generations") lists.push(req.timing().startTime);
    const m = /^\/api\/generations\/([^/]+)$/.exec(pathname);
    if (!m) return;
    const body = await res.json().catch(() => null);
    polls.push({ t: req.timing().startTime, path: pathname, id: m[1], status: res.status(), itemId: body?.item?.id ?? null });
  });

  await ev.login("/playground");
  // A live item can finish, or another process can replace mock rows, while the journey runs. An id counts as
  // live when it was live at the start or at the end of the run.
  const liveIds = new Set();
  const readLive = async () => {
    const feed = await ev.api("/api/generations?limit=12");
    for (const i of feed.body?.items ?? []) if (LIVE.has(i.status)) liveIds.add(i.id);
  };
  await readLive();
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

  // pg-poll: each live item on the stage is polled by its own uuid, every poll is a 200, and the body is that item.
  // VGS_POLL_WAIT_MS keeps the page open longer so the backoff schedule can be read; VGS_POLL_NAV=1 leaves for 갤러리 and comes back.
  await readLive();
  const waitMs = Number(env.VGS_POLL_WAIT_MS ?? 0);
  if (waitMs > 0) {
    ev.note(`waiting ${waitMs} ms on /playground for polls`);
    await page.waitForTimeout(waitMs);
  } else {
    const until = Date.now() + 8_000;
    while (liveIds.size > 0 && ticks(polls).length < 2 && Date.now() < until) await page.waitForTimeout(250);
  }
  if (env.VGS_POLL_NAV === "1" && liveIds.size > 0) {
    const before = polls.length;
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await nav.getByRole("link", { name: "갤러리" }).click();
    await page.waitForURL("**/gallery**");
    await page.waitForTimeout(3_000);
    const away = polls.length - before;
    await nav.getByRole("link", { name: "플레이그라운드" }).click();
    await page.waitForURL("**/playground**");
    const back = Date.now();
    const until = back + 6_000;
    while (polls.length === before + away && Date.now() < until) await page.waitForTimeout(100);
    const listAt = lists.filter((t) => t >= back - 500).at(-1);
    const first = polls.filter((p) => p.t >= back).sort((a, b) => a.t - b.t)[0];
    ev.note(`navigate: ${away} polls while on /gallery; first poll ${first ? Math.round(first.t - (listAt ?? back)) : "none"} ms after the feed reloaded on return`);
    if (away > 0) ev.fail(`${away} poll requests went out while on /gallery`);
    if (!first) ev.fail("no poll request within 6 s of returning to /playground");
  }

  const bad = polls.filter((p) => p.status !== 200 || !liveIds.has(p.id) || p.itemId !== p.id);
  const schedule = ticks(polls);
  const gaps = schedule.slice(1).map((k, i) => Math.round(k.t - schedule[i].t));
  writeFileSync(join(ev.dir, "poll.json"), JSON.stringify({ liveIds: [...liveIds], polls, ticks: schedule, gaps }, null, 2));
  for (const p of polls) ev.note(`poll GET ${p.path} → ${p.status}${p.itemId === p.id ? "" : ` (body item.id ${p.itemId})`}`);
  // The overlay puts the request log in the screenshot; it is removed right after.
  await page.getByRole("region", { name: "결과 무대" }).scrollIntoViewIfNeeded();
  const lines = polls.length ? polls.map((p) => `GET ${p.path} → ${p.status}`) : ["no poll requests"];
  await page.evaluate((text) => {
    const el = document.createElement("pre");
    el.id = "vgs-poll-overlay";
    el.textContent = text;
    el.style.cssText = "position:fixed;right:12px;top:64px;z-index:9999;max-height:70vh;overflow:hidden;padding:10px 12px;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.82);border:1px solid #999;border-radius:6px;white-space:pre";
    document.body.appendChild(el);
  }, ["vgs harness overlay · poll requests this run", ...lines].join("\n"));
  await ev.shot("poll");
  await page.evaluate(() => document.getElementById("vgs-poll-overlay")?.remove());
  if (liveIds.size === 0) {
    if (polls.length > 0) ev.fail(`${polls.length} poll requests with no live item on the feed`);
    ev.note("poll requests 0 (no live item on the feed)");
  } else {
    if (polls.length === 0) ev.fail(`live items ${[...liveIds].join(",")} on the feed but no poll request within 8 s`);
    if (bad.length) ev.fail(`poll requests not matching a live uuid with a 200 and its own item: ${bad.map((p) => `${p.path} → ${p.status}`).join("; ")}`);
    ev.note(`poll requests ${polls.length}, all 200`);
    ev.note(`poll ticks ${schedule.length} (${schedule.map((k) => k.n).join(",")} requests each), gaps ${gaps.join(", ")} ms`);
    const bar = page.getByRole("progressbar", { name: "생성 진행 중" }).first();
    if (!(await bar.isVisible())) ev.fail("live item on the feed but no 생성 진행 중 progress bar on the stage");
  }
}
