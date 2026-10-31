/** Feature: playground — the composer's model menu, settings, attachments and frames, the generate gate, every endpoint against the fake, live polling. See features/playground.md. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composerHandles, FAMILY_NAME, usd } from "../composer-handles.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(skillDir, "..", "..", "..");
const LIVE = new Set(["queued", "in_progress"]);
const IMAGES = ["ref-landscape-1.jpg", "ref-landscape-2.jpg"].map((f) => join(webDir, "public", "mock", f));
const WEBM_AS_MP4 = { name: "clip-3s.mp4", mimeType: "video/mp4", buffer: readFileSync(join(skillDir, "fixtures", "clip-3s.webm")) };
const SEEDANCE = "bytedance/seedance-2.0";
const H3 = "minimax/h3";

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
  // A row can finish, or mock rows can be replaced, mid-run: an id counts as live if it was live at the start or at the end.
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
  const h = await composerHandles(ev, page);
  const t = h.t;
  if (!(await h.box.isVisible())) ev.fail("the composer (playground.composer) is not visible");
  await ev.shot("composer");

  // pg-model-menu
  let menu = await h.openMenu();
  const outputs = menu.getByRole("group", { name: await t("playground.outputs") });
  const videoTab = outputs.getByRole("button", { name: await t("playground.output", { output: "video" }) });
  if ((await videoTab.count()) && (await videoTab.getAttribute("aria-pressed")) !== "true") await videoTab.click();
  const options = (await menu.getByRole("button", { name: /^(Seedance 2\.0|MiniMax H3|GPT Image 2|Hailuo)/ }).allInnerTexts()).map((s) => s.split("\n")[0].trim());
  ev.note(`model options: ${options.join(" | ")}`);
  if (options.some((o) => /Hailuo/.test(o))) ev.fail("Hailuo is still offered");
  const seedance = options.some((o) => o.startsWith(FAMILY_NAME[SEEDANCE]));
  const h3 = options.some((o) => o.startsWith(FAMILY_NAME[H3]));
  const imageTab = outputs.getByRole("button", { name: await t("playground.output", { output: "image" }) });
  const gpt = (await imageTab.count()) > 0 && (await imageTab.isEnabled());
  if (!seedance && !h3) ev.fail("the model menu lists no video model (all disabled in admin?)");
  await ev.shot("model-menu");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });

  const expectMode = async (mode, why) => {
    const got = await h.mode();
    if (got !== mode) ev.fail(`${why}: the composer says it sends ${got ?? "the prompt alone"}, expected ${mode ?? "the prompt alone"}`);
  };

  // pg-mode: the attachments decide it, so the menu offers models only.
  if (seedance) {
    await h.pickModel(SEEDANCE, "video");
    if ((await h.chipText()) !== FAMILY_NAME[SEEDANCE]) ev.fail(`the model chip should read ${FAMILY_NAME[SEEDANCE]}, got ${await h.chipText()}`);
    await expectMode(null, "nothing attached");
    menu = await h.openMenu();
    const modeRows = await menu.getByRole("button", { name: new RegExp(`(${[await t("mode.t2v"), await t("mode.i2v"), await t("mode.r2v")].join("|")})`) }).count();
    if (modeRows !== 0) ev.fail(`the model menu should offer no mode, found ${modeRows} rows naming one`);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  }

  // pg-aspect-pills
  if (seedance) {
    const settings = await h.openSettings();
    const aspect = settings.getByRole("group", { name: await t("playground.aspect.label") });
    const portrait = aspect.getByRole("button", { name: /9:16/ });
    await portrait.click();
    if ((await portrait.getAttribute("aria-pressed")) !== "true") ev.fail("the 9:16 pill did not become aria-pressed");
    const pressed = await aspect.getByRole("button", { pressed: true }).count();
    if (pressed !== 1) ev.fail(`exactly one aspect pill should be pressed, found ${pressed}`);
    const res = (await settings.getByRole("group", { name: await t("params.resolution") }).getByRole("button").allInnerTexts()).map((s) => s.trim());
    if (res.join(",") !== "480p,720p,1080p,4k") ev.fail(`Seedance resolutions should be 480p,720p,1080p,4k, got ${res.join(",")}`);
    await ev.shot("seedance-portrait");
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached" });
    const summary = await h.box.getByRole("button", { name: new RegExp(`^${await t("playground.settings.open", { summary: "" })}`) }).getAttribute("aria-label");
    const want = await t("playground.aspect.pill", { shape: await t("generation.shape", { shape: "portrait" }), ratio: "9:16" });
    if (!summary.includes(want)) ev.fail(`the settings chip should read ${want}, reads ${summary}`);
  } else ev.note("Seedance not offered; aspect-pills skipped (unmet precondition)");

  // pg-model-switch
  if (h3) {
    await h.pickModel(H3, "video");
    const settings = await h.openSettings();
    const auto = settings.getByRole("group", { name: await t("playground.aspect.label") }).getByRole("button", { name: await t("playground.aspect.auto"), exact: true });
    if ((await auto.getAttribute("aria-pressed")) !== "true") ev.fail("H3 should start on the auto pill (playground.aspect.auto)");
    const dur = (await settings.getByRole("group", { name: await t("params.duration") }).getByRole("button").allInnerTexts()).map((s) => s.trim());
    const wantDur = await Promise.all(["5", "10", "15"].map((s) => t("playground.summary.duration", { seconds: s })));
    if (dur.join(",") !== wantDur.join(",")) ev.fail(`H3 durations should be ${wantDur.join(",")}, got ${dur.join(",")}`);
    if (await settings.getByRole("group", { name: await t("params.resolution") }).count()) ev.fail("H3 has no resolution choice");
    if (!(await settings.getByText(await t("families.h3.note")).isVisible())) ev.fail("H3 fixed-2K note (families.h3.note) missing");
    await ev.shot("h3");
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached" });
    if (seedance) await h.pickModel(SEEDANCE, "video");
  } else ev.note("MiniMax H3 not offered; model-switch skipped (unmet precondition)");

  // pg-refs-add
  const add = h.box.getByRole("button", { name: await t("playground.refs.add"), exact: true });
  await add.click();
  const addMenu = page.getByRole("dialog", { name: await t("playground.refs.add") });
  await addMenu.waitFor({ timeout: 5_000 });
  if (!(await addMenu.getByText(await t("playground.refs.menuNote", { frames: "yes" })).isVisible())) ev.fail("the add menu does not explain the order, the drop and the frames (playground.refs.menuNote)");
  await ev.shot("add-menu");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), addMenu.getByRole("button", { name: new RegExp(await t("playground.refs.uploadImages")) }).click()]);
  await chooser.setFiles(IMAGES[0]);
  const alert = h.box.getByRole("alert");
  await Promise.race([h.refs.first().waitFor({ timeout: 30_000 }), alert.waitFor({ timeout: 30_000 })]).catch(() => ev.fail("neither a thumbnail nor an error appeared within 30s of picking a file"));
  await h.waitForUploads("the first reference");
  const attached = (await h.refs.count()) > 0 && !(await alert.isVisible());
  if (attached) ev.note(`reference uploaded: ${await h.refs.count()} thumbnail(s)`);
  else ev.note(`upload refused (expected without an API key): ${await alert.textContent()}`);
  await page.keyboard.press("Escape");
  if (await addMenu.isVisible().catch(() => false)) ev.fail("Esc did not close the add menu");
  if (!(await add.evaluate((el) => el === document.activeElement))) ev.fail("focus did not return to + (playground.refs.add) after closing");
  await ev.shot("after-pick");
  if (attached && seedance) {
    await expectMode("r2v", "an image added with nothing marked");
    await h.markFrame("1", "ref-landscape-1.jpg", "start");
    await expectMode("i2v", "the image marked as the start frame");
    const settings = await h.openSettings();
    if (await settings.getByRole("group", { name: await t("playground.aspect.label") }).count()) ev.fail("Seedance image-to-video takes no aspect ratio, but the pills show");
    await ev.shot("start-frame");
    await page.keyboard.press("Escape");
    await h.refs.first().getByRole("button").last().click();
    await expectMode(null, "the start frame taken off");
  }

  // pg-generate-gate
  const banner = h.status.filter({ hasText: await t("errors.noKey") });
  if (await banner.isVisible()) {
    if (await h.generate.isEnabled()) ev.fail("생성하기 (playground.generate) must be disabled while the no-API-key line shows");
    ev.note("no API key on this account: generate correctly disabled; paid submit not exercised");
  } else if (env.VGS_FAKE_HF) {
    for (const id of await everyMode({ page, ev, h, seedance, h3, gpt, uploads, fake: env.VGS_FAKE_HF })) liveIds.add(id);
  } else if (env.VGS_ALLOW_SPEND === "1") {
    await h.prompt.fill("검증용 프롬프트: 비 오는 밤거리, 느린 돌리 인");
    if (!(await h.generate.isEnabled())) ev.fail("API key present but 생성하기 (playground.generate) disabled");
    await h.generate.click();
    await h.turns.first().waitFor({ timeout: 30_000 });
    ev.note("generation submitted (VGS_ALLOW_SPEND=1); a queued turn is in the stream");
  } else ev.note("API key present; paid submit skipped (set VGS_ALLOW_SPEND=1, or VGS_FAKE_HF against the fake, to exercise it)");
  await ev.shot("generate-gate");

  // pg-poll
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
  if (env.VGS_POLL_NAV === "1" && liveAtEnd === 0) ev.note("navigate: skipped, no live row on the stream's thread to poll on return");
  if (env.VGS_POLL_NAV === "1" && liveAtEnd > 0) {
    const before = polls.length;
    const nav = page.getByRole("navigation", { name: await t("nav.label") });
    await nav.getByRole("link", { name: await t("pages.gallery") }).click();
    await page.waitForURL("**/gallery**");
    await page.waitForTimeout(3_000);
    const away = polls.length - before;
    // The header link opens a new thread; Back returns to the thread whose rows are live.
    await page.goBack();
    await page.waitForURL("**/playground?thread=**");
    const back = Date.now();
    const until = back + 6_000;
    while (polls.length === before + away && Date.now() < until) await page.waitForTimeout(100);
    const listAt = lists.filter((x) => x >= back - 500).at(-1);
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
    if (polls.length > 0) ev.fail(`${polls.length} poll requests with no live row in the stream`);
    ev.note("poll requests 0 (no live row in the stream)");
  } else {
    if (polls.length === 0) ev.fail(`live rows ${[...liveIds].join(",")} in the stream but no poll request within 8 s`);
    if (bad.length) ev.fail(`poll requests not matching a live uuid with a 200 and its own row: ${bad.map((p) => `${p.path} → ${p.status}`).join("; ")}`);
    ev.note(`poll requests ${polls.length}, all 200`);
    ev.note(`poll ticks ${schedule.length} (${schedule.map((k) => k.n).join(",")} requests each), gaps ${gaps.join(", ")} ms`);
    if (liveAtEnd > 0 && !(await h.stream.getByRole("progressbar", { name: await t("playground.feed.progress") }).first().isVisible())) ev.fail("live row in the stream but no progress line (playground.feed.progress)");
  }
}

async function everyMode({ page, ev, h, seedance, h3, gpt, uploads, fake }) {
  const stats = async () => (await fetch(`${fake}/_stats`)).json();
  const t = h.t;
  const submitted = [];
  // Each thumbnail's last button is its remove button; an image's first one opens its frame menu.
  const clearRefs = async () => {
    while ((await h.refs.count()) > 0) await h.refs.first().getByRole("button").last().click();
  };
  const submitAndRead = async (label, want, checkBody) => {
    const before = (await stats()).submits.length;
    const shown = await h.cost();
    const { status, body } = await h.submit();
    if (status !== 201 || body?.item?.modelId !== want) ev.fail(`${label}: POST answered ${status} with ${body?.item?.modelId ?? JSON.stringify(body?.error)}`);
    submitted.push(body.item.id);
    const until = Date.now() + 10_000;
    let sent;
    while (!sent && Date.now() < until) {
      sent = (await stats()).submits.slice(before).find((s) => s.idempotencyKey === body.item.id);
      if (!sent) await page.waitForTimeout(200);
    }
    if (!sent) ev.fail(`${label}: the fake saw no submit for row ${body.item.id}`);
    if (sent.endpoint !== want || sent.status !== 200) ev.fail(`${label}: the fake got ${sent.endpoint} → ${sent.status}, wanted ${want}`);
    const problem = checkBody(sent.body, body.item);
    if (problem) ev.fail(`${label}: ${problem} in ${JSON.stringify(sent.body)}`);
    const priced = shown.startsWith("$");
    if (priced && shown !== usd(body.estimatedCostUsd)) ev.fail(`${label}: the composer showed ${shown} but the row's cost is ${body.estimatedCostUsd}`);
    ev.note(`pg-generate-modes ${label}: ${sent.endpoint} ← ${JSON.stringify(sent.body)}; the composer showed ${priced ? shown : "no rate"}, row cost ${body.estimatedCostUsd}`);
    await ev.shot(`generated-${label.replace(/[^\w-]+/g, "-")}`);
  };
  const urls = (b, key) => (Array.isArray(b[key]) ? b[key] : []);
  const noMedia = (b) => (["image_url", "end_image_url", "image_urls", "video_urls"].some((k) => k in b) ? "text-to-video must carry no media" : null);
  const [L1, L2] = IMAGES.map((f) => f.split(/[\\/]/).pop());

  for (const family of [seedance && SEEDANCE, h3 && H3].filter(Boolean)) {
    const short = family === H3 ? "h3" : "seedance";
    await h.pickModel(family, "video");
    await clearRefs();
    if (family === H3) {
      await h.prompt.fill("");
      const prompt = h.status.filter({ hasText: await t("errors.promptRequired", { model: "MiniMax H3", mode: "t2v" }) });
      if (!(await prompt.isVisible()) || (await h.generate.isEnabled())) ev.fail("H3 text without a prompt should say why (errors.promptRequired) and keep 생성하기 off");
      ev.note(`pg-blocker: ${(await h.status.allInnerTexts()).join(" | ")}`);
      await ev.shot("h3-blocked");
    }
    await h.prompt.fill(`검증 ${short}: 등대 위로 천천히 상승하는 카메라`);
    if ((await h.mode()) !== null) ev.fail(`${short}: with nothing attached the composer should send the prompt alone`);
    await submitAndRead(`${short} text`, `${family}/text-to-video`, (b) => (!b.prompt ? "prompt missing" : noMedia(b)));

    await h.imageInput.setInputFiles(IMAGES);
    await h.videoInput.setInputFiles(WEBM_AS_MP4);
    await h.waitForUploads(`${short} references`);
    if ((await h.refs.count()) !== 3) ev.fail(`${short}: three references should be attached, found ${await h.refs.count()}`);
    if (!uploads.every((u) => typeof u === "string" && u.startsWith(fake))) ev.fail(`uploads did not go to the fake ${fake}: ${uploads.join(", ")}; refusing to click 생성하기`);
    if ((await h.mode()) !== "r2v") ev.fail(`${short}: two images and a video should go as reference to video, the composer says ${await h.mode()}`);
    if (family === SEEDANCE && !(await h.box.getByText(await t("playground.fact.inputVideo", { seconds: "3.0" })).isVisible())) ev.fail("the estimate line does not count the 3 s reference video (playground.fact.inputVideo)");
    await ev.shot(`${short}-references`);
    await submitAndRead(`${short} reference`, `${family}/reference-to-video`, (b) =>
      urls(b, "image_urls").length !== 2 ? "image_urls should hold 2 urls" : urls(b, "video_urls").length !== 1 ? "video_urls should hold 1 url" : "image_url" in b ? "image_url must not be sent" : null,
    );

    await h.markFrame("1", L1, "start");
    await h.markFrame("2", L2, "end");
    const others = h.status.filter({ hasText: await t("errors.framesWithOthers", { count: 1 }) });
    if (!(await others.isVisible()) || (await h.generate.isEnabled())) ev.fail(`${short}: frames beside the video should say so (errors.framesWithOthers) and keep 생성하기 off`);
    await h.refs.last().getByRole("button").last().click();
    if ((await h.mode()) !== "i2v") ev.fail(`${short}: 시작 and 끝 alone should go as image to video, the composer says ${await h.mode()}`);
    await submitAndRead(`${short} start and end frame`, `${family}/image-to-video`, (b, item) =>
      typeof b.image_url !== "string" || b.image_url !== item.imageRefs[0]
        ? "image_url should be the image marked 시작"
        : item.imageRefs.length !== 2 || b.end_image_url !== item.imageRefs[1]
          ? "end_image_url should be the image marked 끝"
          : "image_urls" in b || "video_urls" in b
            ? "image to video must send the frames only"
            : family === SEEDANCE && "aspect_ratio" in b
              ? "Seedance image-to-video takes no aspect_ratio"
              : null,
    );
    await clearRefs();
  }

  if (gpt) {
    const openai = async () => (await stats()).openai.requests;
    const imageCall = async (label, prompt, op, check) => {
      await h.prompt.fill(prompt);
      const { status, body } = await h.submit();
      if (status !== 201 || body?.item?.modelId !== `openai/gpt-image-2/${op}`) ev.fail(`${label}: POST answered ${status} with ${body?.item?.modelId ?? JSON.stringify(body?.error)}`);
      submitted.push(body.item.id);
      // The image call runs in after(), so it can reach the fake after the POST has answered.
      let sent = [];
      for (let i = 0; i < 50 && sent.length === 0; i++) {
        if (i > 0) await page.waitForTimeout(200);
        sent = (await openai()).filter((r) => r.body.prompt === prompt);
      }
      const problem = sent.length !== 1 || sent[0].op !== op ? `OpenAI got ${JSON.stringify(sent.map((r) => r.op))}` : check(sent[0].body, body.item);
      if (problem) ev.fail(`${label}: ${problem}`);
      ev.note(`pg-generate-modes ${label}: OpenAI ${op} ← ${JSON.stringify(sent[0].body.images ?? "no images")}`);
      await ev.shot(`generated-${label.replace(/[^\w-]+/g, "-")}`);
    };
    await h.pickModel("openai/gpt-image-2", "image");
    await clearRefs();
    await imageCall("gpt text", `검증 gpt ${Date.now().toString(36)}: 안개 낀 등대`, "generations", (b) => ("images" in b ? "a generation must carry no images" : null));
    await h.imageInput.setInputFiles(IMAGES);
    await h.waitForUploads("the GPT Image 2 references");
    if ((await h.mode()) !== "r2i") ev.fail(`two images on GPT Image 2 should go as reference to image, the composer says ${await h.mode()}`);
    if ((await (await h.frameButton("1", L1)).count()) !== 0) ev.fail("GPT Image 2 should offer no frame to mark");
    await imageCall("gpt reference", `검증 gpt ${Date.now().toString(36)}: 두 사진의 빛으로`, "edits", (b, item) =>
      JSON.stringify((b.images ?? []).map((i) => i.image_url)) !== JSON.stringify(item.imageRefs) || item.imageRefs.length !== 2 ? `images ${JSON.stringify(b.images)} should be the two references ${JSON.stringify(item.imageRefs)}` : null,
    );
    await clearRefs();
  } else ev.note("GPT Image 2 not offered; its endpoints skipped (unmet precondition)");

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
