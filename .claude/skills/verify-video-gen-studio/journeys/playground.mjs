/** Feature: playground — drawer, model select, generation mode, reference dialog, generate gate, every mode against the fake, live polling. See features/playground.md. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(skillDir, "..", "..", "..");
const LIVE = new Set(["queued", "in_progress"]);
const IMAGES = ["ref-landscape-1.jpg", "ref-landscape-2.jpg"].map((f) => join(webDir, "public", "mock", f));
const WEBM_AS_MP4 = { name: "clip-3s.mp4", mimeType: "video/mp4", buffer: readFileSync(join(skillDir, "fixtures", "clip-3s.webm")) };

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
  const uploads = [];
  // One batched GET /api/generations?ids=a,b per tick: each id becomes one poll entry with the batch's start time,
  // so a batch groups into one tick and an id missing from the returned items still counts as bad.
  page.on("response", async (res) => {
    const req = res.request();
    const { pathname, searchParams } = new URL(res.url());
    if (req.method() === "POST" && pathname === "/api/uploads") return uploads.push((await res.json().catch(() => null))?.url ?? null);
    if (req.method() !== "GET") return;
    const batch = pathname === "/api/generations" ? searchParams.get("ids") : null;
    if (pathname === "/api/generations" && batch === null) lists.push(req.timing().startTime);
    const m = /^\/api\/generations\/([^/]+)$/.exec(pathname);
    if (!m && batch === null) return;
    const body = await res.json().catch(() => null);
    if (m) return polls.push({ t: req.timing().startTime, path: pathname, id: m[1], status: res.status(), itemId: body?.item?.id ?? null });
    const returned = new Set((body?.items ?? []).map((i) => i.id));
    for (const id of batch.split(",")) polls.push({ t: req.timing().startTime, path: `${pathname}?ids=`, id, status: res.status(), itemId: returned.has(id) ? id : null });
  });

  await ev.login("/playground");
  // A live item can finish, or another process can replace mock rows, while the journey runs. An id counts as
  // live when it was live at the start or at the end of the run. The stage holds one thread, the URL's, and a new
  // thread (no `thread`) holds nothing yet.
  const liveIds = new Set();
  const readLive = async () => {
    const thread = new URL(page.url()).searchParams.get("thread");
    if (thread === null) return 0;
    const feed = await ev.api(`/api/generations?thread=${thread}&limit=12`);
    const live = (feed.body?.items ?? []).filter((i) => LIVE.has(i.status));
    for (const i of live) liveIds.add(i.id);
    return live.length;
  };
  await readLive();
  const drawer = page.getByRole("complementary", { name: await ev.t("playground.drawer") });
  if (!(await drawer.isVisible())) ev.fail("the drawer (playground.drawer) is not visible");
  await ev.shot("drawer");
  const stage = page.getByRole("region", { name: await ev.t("playground.stage") });

  const model = drawer.getByLabel(await ev.t("playground.model"));
  const options = await model.locator("option").allTextContents();
  ev.note(`model options: ${options.join(" | ")}`);
  const seedance = options.find((o) => o.startsWith("Seedance 2.0"));
  const h3 = options.find((o) => o.startsWith("MiniMax H3"));
  if (options.length === 0) ev.fail("model select has no options (all models disabled in admin?)");
  if (options.some((o) => /Hailuo/.test(o))) ev.fail("Hailuo is still offered");

  const modes = drawer.getByRole("list", { name: await ev.t("playground.modes") });
  const currentMode = async () => (await modes.locator('[aria-current="step"]').textContent())?.trim();
  const expectMode = async (mode, why) => {
    const want = await ev.t(`mode.${mode}`);
    const got = await currentMode();
    if (got !== want) ev.fail(`${why}: the mode should read ${want} (mode.${mode}), got ${got}`);
  };
  await expectMode("t2v", "nothing attached");
  if (!(await drawer.getByText(await ev.t("playground.refs.optional"), { exact: true }).first().isVisible())) ev.fail("the reference counter does not mark references optional (playground.refs.optional)");

  // prompt: typing updates the character-count hint.
  const promptBox = drawer.getByLabel(await ev.t("playground.prompt"));
  const promptText = "검증용 프롬프트: 비 오는 밤거리, 느린 돌리 인";
  await promptBox.fill(promptText);
  if (!(await drawer.getByText(await ev.t("playground.promptLength", { count: promptText.length }), { exact: true }).isVisible())) ev.fail("the prompt length hint (playground.promptLength) did not appear");

  // aspect-pills: Seedance exposes the output aspect ratio as pressable pills; the 9:16 pill flips the hint to portrait.
  const aspect = drawer.getByRole("group", { name: await ev.t("playground.aspect.label") });
  const resolution = drawer.getByLabel(await ev.t("params.resolution"));
  if (seedance) {
    await model.selectOption({ label: seedance });
    await aspect.waitFor({ timeout: 5_000 });
    const portrait = aspect.getByRole("button", { name: /9:16/ });
    await portrait.click();
    if ((await portrait.getAttribute("aria-pressed")) !== "true") ev.fail("9:16 pill did not become aria-pressed");
    const pressed = await aspect.getByRole("button", { pressed: true }).count();
    if (pressed !== 1) ev.fail(`exactly one aspect pill should be pressed, found ${pressed}`);
    if (!(await drawer.getByText(await ev.t("generation.shape", { shape: "portrait" }), { exact: true }).isVisible())) ev.fail("the aspect hint does not read portrait (generation.shape) after 9:16");
    const res = await resolution.locator("option").allTextContents();
    if (res.join(",") !== "480p,720p,1080p,4k") ev.fail(`Seedance resolutions should be 480p,720p,1080p,4k, got ${res.join(",")}`);
    await ev.shot("seedance-portrait");
  } else ev.note("Seedance not offered; aspect-pills skipped (unmet precondition)");

  if (h3) {
    await model.selectOption({ label: h3 });
    await aspect.waitFor({ timeout: 5_000 });
    if ((await aspect.getByRole("button", { name: await ev.t("playground.aspect.auto"), exact: true }).getAttribute("aria-pressed")) !== "true") ev.fail("H3 should start on the auto pill (playground.aspect.auto)");
    const dur = await drawer.getByLabel(await ev.t("params.duration")).locator("option").allTextContents();
    if (dur.join(",") !== "5,10,15") ev.fail(`H3 duration options should be 5,10,15, got ${dur.join(",")}`);
    if (!(await drawer.getByText(await ev.t("families.h3.note")).first().isVisible())) ev.fail("H3 fixed-2K note (families.h3.note) missing");
    if (await resolution.count()) ev.fail("H3 has no resolution choice");
    await ev.shot("h3");
    if (seedance) await model.selectOption({ label: seedance });
  } else ev.note("MiniMax H3 not offered; model-switch skipped (unmet precondition)");

  // refs-dialog: button opens a modal; the picker is a real <input type=file>; Esc closes and focus returns.
  const addRefs = await ev.t("playground.refs.add");
  const attachedName = await ev.t("playground.refs.attached");
  const refsButton = drawer.getByRole("button", { name: addRefs, exact: true });
  await refsButton.click();
  const dialog = page.getByRole("dialog", { name: addRefs });
  await dialog.waitFor({ timeout: 5_000 });
  const [videoNote, imageNote] = await Promise.all(["higgsfield", "openai"].map((provider) => ev.t("playground.refs.note", { provider })));
  if (!(await dialog.getByText(videoNote).or(dialog.getByText(imageNote)).isVisible())) ev.fail("the reference dialog does not say references are optional (playground.refs.note)");
  await ev.shot("refs-dialog-empty");
  await dialog.locator('input[type=file][accept^="image/"]').setInputFiles(IMAGES[0]);
  // Upload goes to Higgsfield storage through /api/uploads and needs the user's API key.
  // With a key: a thumbnail "1" appears. Without: role=alert explains. Both are real outcomes; record which.
  const thumb = dialog.getByRole("list", { name: attachedName }).locator("li");
  const alert = dialog.getByRole("alert");
  await Promise.race([thumb.first().waitFor({ timeout: 30_000 }), alert.waitFor({ timeout: 30_000 })]).catch(() => ev.fail("neither a thumbnail nor an error appeared within 30s of picking a file"));
  const attached = (await thumb.count()) > 0;
  if (attached) ev.note(`reference uploaded: ${await thumb.count()} thumbnail(s)`);
  else ev.note(`upload refused (expected without an API key): ${await alert.textContent()}`);
  await ev.shot("refs-dialog-after-pick");
  await page.keyboard.press("Escape");
  if (await dialog.isVisible().catch(() => false)) ev.fail("Esc did not close the reference dialog");
  if (!(await refsButton.evaluate((el) => el === document.activeElement))) ev.fail("focus did not return to the add-references button (playground.refs.add) after closing");

  const startFrame = drawer.getByRole("checkbox", { name: await ev.t("playground.startFromImage") });
  if (attached) {
    await expectMode("r2v", "one image");
    if (!(await startFrame.isVisible())) ev.fail("the start-from-image checkbox (playground.startFromImage) is not offered for exactly one image");
    await startFrame.check();
    await expectMode("i2v", "start from this image");
    if (seedance && (await aspect.isVisible())) ev.fail("Seedance image-to-video takes no aspect ratio, but the pills show");
    await ev.shot("start-from-image");
    await startFrame.uncheck();
    await removeAll(drawer, attachedName);
    await expectMode("t2v", "the reference removed");
  }

  // generate-gate: without an API key the status banner shows and the Generate button stays disabled.
  const banner = drawer.getByRole("status").filter({ hasText: await ev.t("errors.noKey") });
  const generate = drawer.getByRole("button", { name: await ev.t("playground.generate"), exact: true });
  if (await banner.isVisible()) {
    if (await generate.isEnabled()) ev.fail("Generate (playground.generate) must be disabled while the no-API-key banner shows");
    ev.note("no API key on this account: generate correctly disabled; paid submit not exercised");
  } else if (env.VGS_FAKE_HF) {
    for (const id of await everyMode({ page, ev, drawer, stage, model, promptBox, seedance, h3, generate, expectMode, startFrame, uploads, fake: env.VGS_FAKE_HF })) liveIds.add(id);
  } else if (env.VGS_ALLOW_SPEND === "1") {
    if (!(await generate.isEnabled())) ev.fail("API key present but Generate (playground.generate) disabled");
    await generate.click();
    await stage.getByRole("article").first().waitFor({ timeout: 30_000 });
    ev.note("generation submitted (VGS_ALLOW_SPEND=1); a queued item is on the stage");
  } else ev.note("API key present; paid submit skipped (set VGS_ALLOW_SPEND=1, or VGS_FAKE_HF against the fake, to exercise it)");
  await ev.shot("generate-gate");

  // pg-poll: each live item on the stage is polled by its own uuid, every poll is a 200, and the body is that item.
  // VGS_POLL_WAIT_MS keeps the page open longer so the backoff schedule can be read; VGS_POLL_NAV=1 leaves for the gallery and comes back.
  const liveAtEnd = await readLive();
  const waitMs = Number(env.VGS_POLL_WAIT_MS ?? 0);
  if (waitMs > 0) {
    ev.note(`waiting ${waitMs} ms on /playground for polls`);
    await page.waitForTimeout(waitMs);
  } else {
    const until = Date.now() + 8_000;
    while (liveIds.size > 0 && ticks(polls).length < 2 && Date.now() < until) await page.waitForTimeout(250);
  }
  if (env.VGS_POLL_NAV === "1" && liveAtEnd === 0) ev.note("navigate: skipped, no live row on the stage's thread to poll on return");
  if (env.VGS_POLL_NAV === "1" && liveAtEnd > 0) {
    const before = polls.length;
    const nav = page.getByRole("navigation", { name: await ev.t("nav.label") });
    await nav.getByRole("link", { name: await ev.t("pages.gallery") }).click();
    await page.waitForURL("**/gallery**");
    await page.waitForTimeout(3_000);
    const away = polls.length - before;
    // The header link opens a new thread; Back returns to the thread whose rows are live.
    await page.goBack();
    await page.waitForURL("**/playground?thread=**");
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
  await stage.scrollIntoViewIfNeeded();
  const lines = polls.length ? polls.map((p) => `GET ${p.path} → ${p.status}`) : ["no poll requests"];
  await page.evaluate((text) => {
    const el = document.createElement("pre");
    el.id = "vgs-poll-overlay";
    el.textContent = text;
    el.style.cssText = "position:fixed;right:12px;top:64px;z-index:9999;max-height:70vh;overflow:hidden;padding:10px 12px;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.82);border:1px solid #999;border-radius:6px;white-space:pre";
    document.body.appendChild(el);
  }, ["vgs harness overlay · poll requests this run", ...lines.slice(-40)].join("\n"));
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
    if (liveAtEnd > 0 && !(await stage.getByRole("progressbar", { name: await ev.t("playground.feed.progress") }).first().isVisible())) ev.fail("live item on the feed but no progress bar (playground.feed.progress) on the stage");
  }
}

/** Each attached thumbnail holds one button, its remove button. */
async function removeAll(drawer, attachedName) {
  const remove = drawer.getByRole("list", { name: attachedName }).getByRole("button");
  while ((await remove.count()) > 0) await remove.first().click();
}

async function everyMode({ page, ev, drawer, stage, model, promptBox, seedance, h3, generate, expectMode, startFrame, uploads, fake }) {
  const stats = async () => (await fetch(`${fake}/_stats`)).json();
  const addRefs = await ev.t("playground.refs.add");
  const attachedName = await ev.t("playground.refs.attached");
  const railGenerate = stage.getByRole("button", { name: await ev.t("playground.rail.generate"), exact: true });
  const submitted = [];
  const attach = async (images, videos) => {
    await drawer.getByRole("button", { name: addRefs, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: addRefs });
    await dialog.waitFor({ timeout: 5_000 });
    const list = dialog.getByRole("list", { name: attachedName }).locator("li");
    const want = (await list.count()) + images.length + videos.length;
    if (images.length) await dialog.locator('input[type=file][accept^="image/"]').setInputFiles(images);
    for (const v of videos) await dialog.locator('input[type=file][accept="video/mp4"]').setInputFiles(v);
    const until = Date.now() + 30_000;
    while ((await list.count()) < want && Date.now() < until) {
      if (await dialog.getByRole("alert").isVisible()) ev.fail(`attach failed: ${await dialog.getByRole("alert").textContent()}`);
      await page.waitForTimeout(200);
    }
    if ((await list.count()) < want) ev.fail(`only ${await list.count()} of ${want} references attached`);
    await page.keyboard.press("Escape");
  };
  const submitAndRead = async (label, want, checkBody) => {
    const before = (await stats()).submits.length;
    const counter = (await railGenerate.locator("xpath=following-sibling::span[1]").textContent())?.trim();
    const answer = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/generations", { timeout: 30_000 });
    await generate.click();
    const res = await answer;
    const body = await res.json();
    if (res.status() !== 201 || body.item?.modelId !== want) ev.fail(`${label}: POST answered ${res.status()} with ${body.item?.modelId ?? JSON.stringify(body.error)}`);
    submitted.push(body.item.id);
    const until = Date.now() + 10_000;
    let sent;
    while (!sent && Date.now() < until) {
      sent = (await stats()).submits.slice(before).find((s) => s.idempotencyKey === body.item.id);
      if (!sent) await page.waitForTimeout(200);
    }
    if (!sent) ev.fail(`${label}: the fake saw no submit for row ${body.item.id}`);
    if (sent.endpoint !== want || sent.status !== 200) ev.fail(`${label}: the fake got ${sent.endpoint} → ${sent.status}, wanted ${want}`);
    const problem = checkBody(sent.body);
    if (problem) ev.fail(`${label}: ${problem} in ${JSON.stringify(sent.body)}`);
    const shown = counter === "—" ? null : counter;
    if (shown !== null && shown !== usd(body.estimatedCostUsd)) ev.fail(`${label}: the rail's generate counter showed ${shown} but the row's cost is ${body.estimatedCostUsd}`);
    ev.note(`pg-generate-modes ${label}: ${sent.endpoint} ← ${JSON.stringify(sent.body)}; the rail counter showed ${shown ?? "— (no rate)"}, row cost ${body.estimatedCostUsd}`);
    await ev.shot(`generated-${label.replace(/[^\w-]+/g, "-")}`);
  };
  const urls = (b, key) => (Array.isArray(b[key]) ? b[key] : []);

  for (const option of [seedance, h3].filter(Boolean)) {
    await model.selectOption({ label: option });
    const family = option.startsWith("Seedance") ? "bytedance/seedance-2.0" : "minimax/h3";
    const short = family === "minimax/h3" ? "h3" : "seedance";
    await removeAll(drawer, attachedName);
    if (family === "minimax/h3") {
      await promptBox.fill("");
      const blocker = drawer.getByRole("status").filter({ hasText: await ev.t("errors.promptRequired", { model: "MiniMax H3", mode: "t2v" }) });
      if (!(await blocker.isVisible()) || (await generate.isEnabled())) ev.fail("H3 without a prompt should say why (errors.promptRequired) and keep Generate disabled");
      ev.note(`pg-blocker: ${await blocker.textContent()}`);
      await ev.shot("h3-needs-prompt");
    }
    await promptBox.fill(`검증 ${short}: 등대 위로 천천히 상승하는 카메라`);

    await attach(IMAGES, [WEBM_AS_MP4]);
    if (!uploads.every((u) => typeof u === "string" && u.startsWith(fake))) ev.fail(`uploads did not go to the fake ${fake}: ${uploads.join(", ")}; refusing to click Generate`);
    await expectMode("r2v", "two images and a video");
    if (family === "bytedance/seedance-2.0" && !(await drawer.getByText(await ev.t("playground.fact.inputVideo", { seconds: "3.0" })).isVisible())) ev.fail("the estimate line does not count the 3 s reference video (playground.fact.inputVideo)");
    await ev.shot(`${short}-references`);
    await submitAndRead(`${short} reference`, `${family}/reference-to-video`, (b) =>
      urls(b, "image_urls").length !== 2 ? "image_urls should hold 2 urls" : urls(b, "video_urls").length !== 1 ? "video_urls should hold 1 url" : "image_url" in b ? "image_url must not be sent" : null,
    );

    await removeAll(drawer, attachedName);
    await attach([IMAGES[0]], []);
    await startFrame.check();
    await expectMode("i2v", "start from this image");
    await submitAndRead(`${short} first frame`, `${family}/image-to-video`, (b) =>
      typeof b.image_url !== "string" ? "image_url missing" : "image_urls" in b ? "image_urls must not be sent" : family === "bytedance/seedance-2.0" && "aspect_ratio" in b ? "Seedance image-to-video takes no aspect_ratio" : null,
    );

    await removeAll(drawer, attachedName);
    await expectMode("t2v", "no reference");
    await submitAndRead(`${short} text`, `${family}/text-to-video`, (b) =>
      !b.prompt ? "prompt missing" : ["image_url", "image_urls", "video_urls"].some((k) => k in b) ? "text-to-video must carry no media" : null,
    );
  }

  const until = Date.now() + 60_000;
  let live = submitted;
  while (live.length > 0 && Date.now() < until) {
    await page.waitForTimeout(1_000);
    const read = await ev.api(`/api/generations?ids=${submitted.join(",")}`);
    if (read.status !== 200) {
      ev.note(`waiting for the rows: GET ?ids= answered ${read.status}, asking again`);
      continue;
    }
    live = (read.body?.items ?? []).filter((r) => ["pending", "queued", "in_progress"].includes(r.status)).map((r) => r.id);
  }
  const ended = (await ev.api(`/api/generations?ids=${submitted.join(",")}`)).body?.items ?? [];
  if (live.length > 0) ev.fail(`rows still live after 60 s: ${live.join(", ")}`);
  if (ended.some((r) => r.status !== "completed")) ev.fail(`not every row completed: ${ended.map((r) => `${r.modelId} ${r.status} ${JSON.stringify(r.reason ?? "")}`).join("; ")}`);
  ev.note(`pg-generate-modes: all ${ended.length} rows completed; costs kept: ${ended.map((r) => r.costUsd).join(", ")}`);
  return submitted;
}

function usd(n) {
  const v = Number(n ?? 0);
  return `$${v.toFixed(v >= 100 ? 0 : v >= 1 ? 2 : 4)}`;
}
