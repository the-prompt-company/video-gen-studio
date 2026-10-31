/** Feature: composer — the chat stream and its docked composer. See features/composer.md. */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composerHandles, FAMILY_NAME, usd } from "../composer-handles.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const SEEDANCE = "bytedance/seedance-2.0";
const H3 = "minimax/h3";
const GPT = "openai/gpt-image-2";
const RATES = { [SEEDANCE]: 0.0985, [H3]: 0.065 };

export default async function composer({ page, ev, base, env, webDir, local }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, threads, rows and rates, so .env.local must point at a local database");
  const fake = env.VGS_FAKE_HF;
  if (!fake) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; the journey uploads to it and generates through it");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const mobile = env.VGS_MOBILE === "1";
  const viewport = mobile ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "composer");
  mkdirSync(reviewDir, { recursive: true });
  const sideways = [];
  const review = async (surface, p) => {
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await p.waitForTimeout(250);
    await ev.shot(surface, { page: p });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`) });
    const [scroll, inner] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (scroll !== inner) sideways.push(`${surface} ${scroll}>${inner}`);
    // The stream scrolls on its own, so a turn wider than it would not widen the page.
    const inside = await p.evaluate(() => [...document.querySelectorAll("[role=region]")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute("aria-label")));
    if (inside.length) sideways.push(`${surface} inside ${inside.join(", ")}`);
  };
  const file = (name) => join(webDir, "public", "mock", name);
  const LANDSCAPE = [file("ref-landscape-1.jpg"), file("ref-landscape-2.jpg")];
  const SQUARE = file("ref-square.jpg");
  const jpeg = (i, name = `ref-${i}.jpg`) => ({ name, mimeType: "image/jpeg", buffer: readFileSync(LANDSCAPE[i % 2]) });
  const CLIP = { name: "clip-3s.mp4", mimeType: "video/mp4", buffer: readFileSync(join(skillDir, "fixtures", "clip-3s.webm")) };

  const stamp = Date.now().toString(36);
  const member = `vgs-cmp-${stamp}@example.test`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const stats = async () => (await fetch(`${fake}/_stats`)).json();
  let savedRates = null;
  let a = null;

  try {
    await ev.login("/gallery", page);
    savedRates = (await ev.api("/api/admin/models")).body?.items ?? [];
    for (const [modelId, usd] of Object.entries(RATES)) {
      const r = await ev.api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId, pricePerSecUsd: usd }) });
      if (r.status !== 200) ev.fail(`setting the ${modelId} rate answered ${r.status}`);
    }
    const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: member, password: INITIAL, apiKey: "fake-id:fake-secret" }) });
    if (made.status !== 201) ev.fail(`creating ${member} answered ${made.status}: ${JSON.stringify(made.body)}`);
    const [{ id: memberId }] = await sql`select id from users where username = ${member}`;

    a = await ev.newPage();
    const ta = (key, values) => ev.t(key, values, a);
    await a.goto(`${base}/login`, { waitUntil: "networkidle" });
    await a.getByLabel("ID").fill(member);
    await a.getByLabel(await ta("auth.password")).fill(INITIAL);
    await a.getByRole("button", { name: await ta("auth.signIn"), exact: true }).click();
    await a.getByRole("heading", { level: 1, name: await ta("auth.heading.temporary.title") }).waitFor({ timeout: 30_000 });
    await a.getByLabel(await ta("auth.newPassword")).first().fill(`${member}-chosen`);
    await a.getByLabel(await ta("auth.confirmPassword")).fill(`${member}-chosen`);
    await a.getByRole("button", { name: await ta("auth.changePassword"), exact: true }).click();
    await a.waitForURL("**/playground", { timeout: 30_000 });
    await a.waitForLoadState("networkidle");

    const h = await composerHandles(ev, a);
    const { box, stream, prompt, generate, status, openMenu, pickModel } = h;
    const expectChip = async (family, why) => {
      const got = await h.chipText();
      if (got !== FAMILY_NAME[family]) ev.fail(`${why}: the model chip reads "${got}", expected "${FAMILY_NAME[family]}"`);
    };
    const expectMode = async (mode, why) => {
      const got = await h.mode();
      if (got !== mode) ev.fail(`${why}: the composer says it sends ${got ?? "the prompt alone"}, expected ${mode ?? "the prompt alone"}`);
    };
    const expectBlocked = async (key, values, why) => {
      if (!(await status.filter({ hasText: await ta(key, values) }).isVisible()) || (await generate.isEnabled())) ev.fail(`${why}: expected the blocker ${key} with 생성하기 off, got status "${(await status.allInnerTexts()).join(" | ")}"`);
    };
    const expectReady = async (why) => {
      if (!(await generate.isEnabled())) ev.fail(`${why}: 생성하기 should be on, status "${(await status.allInnerTexts()).join(" | ")}"`);
    };
    const expectFrames = async (want, why) => {
      for (const [tag, name, role] of want) {
        const got = await h.frameOf(tag, name);
        if (got !== role) ev.fail(`${why}: image ${tag} (${name}) holds ${got}, expected ${role}`);
      }
    };
    const settled = (why) => h.waitForUploads(why);
    const attachRefs = (files) => h.imageInput.setInputFiles(files);
    const attachVideo = (files) => h.videoInput.setInputFiles(files);
    const removeButton = async (kind, tag, name) => box.getByRole("button", { name: await ta("playground.refs.removeLabel", { kind, tag, name }), exact: true });
    // Each thumbnail's last button is its remove button.
    const clearAll = async () => {
      for (let i = 0; (await h.refs.count()) > 0; i++) {
        if (i === 20) ev.fail("the attachments would not all come off");
        await h.refs.first().getByRole("button").last().click();
      }
    };
    const counter = async () => (await box.getByText(new RegExp(`^${(await ta("playground.refs.imageCount", { count: "9", max: "9" })).replace("9/9", "\\d+/\\d+")}`)).innerText()).trim();
    const costText = () => h.cost();
    const submit = async (label, how = "click") => {
      const { status: code, body } = await h.submit(how);
      if (!body?.item || !body?.thread) ev.fail(`${label}: POST answered ${code} ${JSON.stringify(body)}`);
      return body;
    };
    const sentFor = async (id) => {
      for (let i = 0; i < 50; i++) {
        const sent = (await stats()).submits.find((s) => s.idempotencyKey === id);
        if (sent) return sent;
        await a.waitForTimeout(200);
      }
      ev.fail(`the fake saw no submit for row ${id}`);
    };
    const threadOf = () => new URL(a.url()).searchParams.get("thread");
    const fileName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());
    const [L1, L2] = ["ref-landscape-1.jpg", "ref-landscape-2.jpg"];

    await stream.getByText(await ta("playground.empty.title"), { exact: true }).waitFor({ timeout: 15_000 });
    await expectChip(SEEDANCE, "a member with a key starts on Seedance");
    await expectMode(null, "nothing attached");
    await review("new-thread", a);
    await prompt.fill(`[composer] ${stamp} 비 오는 밤 한강 다리, 우산을 펼치는 순간 클로즈업`);
    await expectReady("a prompt alone");
    await review("composer-text", a);

    const menu = await openMenu();
    const modeNames = await Promise.all(["t2v", "i2v", "r2v", "t2i", "r2i"].map((m) => ta(`mode.${m}`)));
    const modeRows = await menu.getByRole("button", { name: new RegExp(modeNames.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")) }).count();
    if (modeRows !== 0) ev.fail(`the model menu should offer no mode to pick, found ${modeRows} rows naming one`);
    for (const f of [SEEDANCE, H3]) if (!(await menu.getByRole("button", { name: new RegExp(`^${FAMILY_NAME[f]} · `) }).isVisible())) ev.fail(`the model menu does not list ${FAMILY_NAME[f]}`);
    if (!(await menu.getByText(await ta("playground.rateHint", { basis: await ta("prices.basis.seedance"), rate: await ta("prices.rate", { usd: "$0.0985", unit: "second" }) }))).isVisible()) ev.fail("the Seedance row does not show its rate");
    const seedanceTakes = await ta("playground.takes", { images: 6, videos: 3, frames: "both" });
    if (!(await menu.getByText(seedanceTakes, { exact: true }).isVisible())) ev.fail(`the Seedance row should say what it takes: "${seedanceTakes}"`);
    await review("model-menu", a);
    await a.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    if (!(await h.chip.evaluate((el) => el === document.activeElement))) ev.fail("Esc should return focus to the model chip");

    const drop = await h.dropFiles([jpeg(0, L1), jpeg(1, L2)], { hold: true });
    await box.getByText(await ta("playground.dropHere"), { exact: true }).waitFor({ timeout: 5_000 });
    await review("drop-state", a);
    await drop();
    await settled("the dropped images");
    if ((await h.refs.count()) !== 2) ev.fail(`two dropped images should be attached, found ${await h.refs.count()}`);
    await expectMode("r2v", "two dropped images");
    await expectFrames([["1", L1, "none"], ["2", L2, "none"]], "dropped files");
    if (!(await box.getByText(await ta("playground.frames.hint"), { exact: true }).isVisible())) ev.fail("the line under the images should say an image can be made a frame");
    await review("dropped", a);
    ev.note("drop: two images landed as references; the composer says it sends reference to video");

    const promptBefore = await prompt.inputValue();
    await h.pasteFiles([{ name: "pasted.jpg", mimeType: "image/jpeg", buffer: readFileSync(SQUARE) }]);
    await settled("the pasted image");
    if ((await h.refs.count()) !== 3) ev.fail(`a pasted image should be a third reference, found ${await h.refs.count()}`);
    if ((await prompt.inputValue()) !== promptBefore) ev.fail("pasting an image should not change the prompt");
    await expectFrames([["3", "pasted.jpg", "none"]], "a pasted file");
    ev.note("paste: an image pasted into the prompt landed as reference 3");

    await (await h.frameButton("1", L1)).click();
    const frameMenu = a.getByRole("dialog", { name: await ta("playground.frames.title", { tag: "1" }) });
    await frameMenu.waitFor();
    for (const role of ["start", "end"]) if (!(await frameMenu.getByRole("button", { name: new RegExp(`^${await ta("playground.frames.role", { role })}`) }).isVisible())) ev.fail(`the frame menu should offer ${role}`);
    await review("frame-menu", a);
    await frameMenu.getByRole("button", { name: new RegExp(`^${await ta("playground.frames.role", { role: "start" })}`) }).click();
    await frameMenu.waitFor({ state: "detached" });
    await expectFrames([["1", L1, "start"]], "picking 시작 in the menu");
    await expectMode("i2v", "an image marked as the start frame");
    await expectBlocked("errors.framesWithOthers", { count: 2 }, "a start frame beside two more images");
    const left = box.getByText(await ta("playground.frames.left"), { exact: true });
    if ((await left.count()) !== 2) ev.fail(`the two images left out should say so, ${await left.count()} do`);
    await review("frames-blocked", a);
    await h.markFrame("2", L2, "end");
    await expectBlocked("errors.framesWithOthers", { count: 1 }, "start and end beside one more image");
    await h.markFrame("2", L2, "start");
    await expectFrames([["1", L1, "none"], ["2", L2, "both"]], "marking image 2 as the start moves the label from image 1");
    await h.markFrame("1", L1, "start");
    await expectFrames([["1", L1, "start"], ["2", L2, "end"]], "marking image 1 as the start again");
    await (await removeButton("image", "3", "pasted.jpg")).click();
    await expectReady("start and end frames alone");
    await expectMode("i2v", "start and end frames");
    await review("frames", a);
    ev.note("frames: 시작 and 끝 moved like radio buttons, a third image blocked 생성하기 until it was removed");

    const settingsChip = box.getByRole("button", { name: new RegExp(`^${await ta("playground.settings.open", { summary: "" })}`) });
    const costBefore = await costText();
    await settingsChip.click();
    const settings = a.getByRole("dialog", { name: await ta("playground.settings.title") });
    await settings.waitFor();
    if (!(await settings.getByText(await ta("playground.aspect.label"), { exact: true }).isVisible()) || (await settings.getByRole("group", { name: await ta("playground.aspect.label") }).count()) > 0) {
      ev.fail("Seedance frames should explain the aspect ratio instead of offering pills");
    }
    await settings.getByRole("group", { name: await ta("params.resolution") }).getByRole("button", { name: "720p", exact: true }).click();
    await settings.getByRole("slider").fill("8");
    const summaryNow = (await settingsChip.getAttribute("aria-label")) ?? "";
    for (const part of [await ta("playground.summary.duration", { seconds: 8 }), "720p"]) if (!summaryNow.includes(part)) ev.fail(`the settings chip should read ${part}, reads "${summaryNow}"`);
    const costAfter = await costText();
    if (costAfter === costBefore) ev.fail(`the cost stayed ${costBefore} after 720p and 8 s`);
    ev.note(`settings: chip "${summaryNow}", cost ${costBefore} → ${costAfter}`);
    await review("settings", a);
    await a.keyboard.press("Escape");
    await settings.waitFor({ state: "detached" });

    const one = await submit("frames");
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === one.thread.id, { timeout: 15_000 });
    const sentOne = await sentFor(one.item.id);
    const [startUrl, endUrl] = one.item.imageRefs;
    if (sentOne.endpoint !== `${SEEDANCE}/image-to-video`) ev.fail(`frames went to ${sentOne.endpoint}`);
    if (sentOne.body.image_url !== startUrl || sentOne.body.end_image_url !== endUrl || !startUrl?.startsWith(fake) || !endUrl?.startsWith(fake)) ev.fail(`frames body ${JSON.stringify(sentOne.body)} vs refs ${JSON.stringify(one.item.imageRefs)}`);
    if (Object.keys(sentOne.body).indexOf("end_image_url") !== Object.keys(sentOne.body).indexOf("image_url") + 1) ev.fail("end_image_url should follow image_url");
    if ("image_urls" in sentOne.body || sentOne.body.duration !== 8 || sentOne.body.resolution !== "720p" || "aspect_ratio" in sentOne.body) ev.fail(`frames body ${JSON.stringify(sentOne.body)}`);
    if (usd(one.estimatedCostUsd) !== costAfter) ev.fail(`the composer showed ${costAfter}, the row was quoted ${one.estimatedCostUsd}`);
    const turnOne = stream.locator(`article[data-id="${one.item.id}"]`);
    await turnOne.waitFor({ timeout: 10_000 });
    const frameLabels = (await turnOne.getByRole("list").getByRole("listitem").allInnerTexts()).map((s) => s.trim());
    const wantLabels = [await ta("playground.feed.frame", { slot: "start" }), await ta("playground.feed.frame", { slot: "end" })];
    if (JSON.stringify(frameLabels) !== JSON.stringify(wantLabels)) ev.fail(`the turn labels its frames ${JSON.stringify(frameLabels)}`);
    ev.note(`end frame: ${sentOne.endpoint} ← image_url ${startUrl}, end_image_url ${endUrl}; row ${one.item.id} in new thread ${one.thread.id}`);

    await clearAll();
    await expectMode(null, "every attachment taken off");
    await turnOne.getByRole("button", { name: await ta("playground.actions.reuse"), exact: true }).click();
    await box.getByText(await ta("playground.note.reused", { refs: "frames" })).waitFor({ timeout: 10_000 });
    await settled("the frames 다시 put back");
    const [n1, n2] = [fileName(startUrl), fileName(endUrl)];
    await expectFrames([["1", n1, "start"], ["2", n2, "end"]], "다시 on a frames turn");
    await expectMode("i2v", "다시 on a frames turn");
    await expectReady("다시 restored both frames");
    await review("reused-frames", a);
    ev.note(`다시: the frames turn came back with ${n1} as 시작 and ${n2} as 끝`);

    await h.markFrame("1", n1, "start");
    await h.markFrame("2", n2, "end");
    await expectMode("r2v", "both marks taken off");
    await attachRefs([0, 1, 2, 3, 4].map((i) => jpeg(i)));
    const tooMany = await ta("playground.upload.tooMany", { kind: "image", max: 6 });
    await box.getByRole("alert").filter({ hasText: tooMany }).waitFor({ timeout: 10_000 }).catch(() => ev.fail(`a seventh image should be refused with "${tooMany}"`));
    await attachVideo(CLIP);
    await settled("references");
    const count = await counter();
    const wantCount = `${await ta("playground.refs.imageCount", { count: "6", max: "6" })}`;
    if (!count.startsWith(wantCount) || (await h.refs.count()) !== 7) ev.fail(`the counter reads "${count}" with ${await h.refs.count()} items`);
    if (!(await box.getByText(await ta("playground.fact.inputVideo", { seconds: "3.0" })).isVisible())) ev.fail("the cost line should count the 3 s video");
    await review("composer-references", a);
    await pickModel(H3);
    await expectChip(H3, "switching to H3");
    await expectMode("r2v", "H3 keeps the references");
    await expectBlocked("errors.tooManyImages", { model: "MiniMax H3", max: 5 }, "six images on H3");
    await (await removeButton("image", "6", "ref-3.jpg")).click();
    await expectReady("five images on H3");

    await prompt.fill(`[composer] ${stamp} 같은 다리, 카메라를 더 낮게`);
    const two = await submit("references", "keyboard");
    if (two.thread.id !== one.thread.id || threadOf() !== one.thread.id) ev.fail(`the second generation went to thread ${two.thread.id}`);
    const sentTwo = await sentFor(two.item.id);
    if (sentTwo.endpoint !== `${H3}/reference-to-video` || sentTwo.body.image_urls?.length !== 5 || sentTwo.body.video_urls?.length !== 1 || "image_url" in sentTwo.body) ev.fail(`references sent ${sentTwo.endpoint} ${JSON.stringify(sentTwo.body)}`);
    ev.note(`references: ${sentTwo.endpoint} with 5 images and 1 video into the same thread by Ctrl+Enter`);

    await h.markFrame("1", n1, "start");
    await expectMode("i2v", "a start frame on H3");
    await pickModel(GPT, "image");
    await expectChip(GPT, "the image tab");
    await expectMode("r2i", "GPT Image 2 takes the images as references");
    await box.getByText(await ta("playground.note.unmarked", { model: "GPT Image 2" })).waitFor({ timeout: 5_000 });
    if ((await (await h.frameButton("1", n1)).count()) !== 0) ev.fail("GPT Image 2 should offer no frame to mark");
    await expectBlocked("errors.noVideoRefs", { model: "GPT Image 2" }, "a video on the image model");
    await review("gpt-no-frames", a);
    ev.note("GPT Image 2: the 시작 mark came off with playground.note.unmarked, and no image offers a frame menu");

    await clearAll();
    await expectMode(null, "GPT Image 2 with nothing attached");
    await box.getByRole("button", { name: await ta("playground.refs.add"), exact: true }).click();
    const addMenu = a.getByRole("dialog", { name: await ta("playground.refs.add") });
    await addMenu.waitFor();
    const [chooser] = await Promise.all([a.waitForEvent("filechooser"), addMenu.getByRole("button", { name: new RegExp(await ta("playground.refs.uploadImages")) }).click()]);
    await chooser.setFiles(SQUARE);
    await settled("the picked image");
    await expectMode("r2i", "an image picked with +");
    if (!(await addMenu.isVisible())) ev.fail("the add menu should stay open for more files");
    await a.keyboard.press("Escape");
    const before = await h.refs.count();
    await h.dropFiles([jpeg(0, "dropped.jpg")]);
    await settled("drop");
    if ((await h.refs.count()) !== before + 1) ev.fail("a dropped image should be added");
    ev.note("GPT Image 2: + and a drop both attached references");

    // GPT Image 2 keeps its references in Blob; sent with a Higgsfield model they are deleted when the row ends.
    await pickModel(SEEDANCE, "video");
    await expectChip(SEEDANCE, "back to Seedance");
    await expectMode("r2v", "the image references carried to Seedance");
    await prompt.fill(`[composer] ${stamp} 마지막 장면`);
    const three = await submit("blob references");
    if (three.thread.id !== one.thread.id) ev.fail(`the third generation went to thread ${three.thread.id}`);
    await box.getByText(await ta("playground.note.spent", { count: before + 1 })).waitFor({ timeout: 10_000 });
    if ((await h.refs.count()) !== 0) ev.fail("the Blob references should leave the composer after a Higgsfield send");
    ev.note(`spent: ${before + 1} Blob references left the composer after the Seedance send`);

    for (let i = 0; ; i++) {
      const read = await ev.api(`/api/generations?ids=${one.item.id},${two.item.id},${three.item.id}`, undefined, a);
      if ((read.body?.items ?? []).every((x) => x.status === "completed")) break;
      if (i === 60) ev.fail("the three generations did not complete");
      await a.waitForTimeout(1000);
    }
    const result = await ta("generation.video");
    await turnOne.getByLabel(result, { exact: true }).waitFor({ timeout: 20_000 });
    await stream.locator(`article[data-id="${three.item.id}"]`).getByLabel(result, { exact: true }).waitFor({ timeout: 20_000 });
    await review("stream", a);

    await sql`
      insert into generations (user_id, thread_id, model_id, prompt, params, status, result_url, duration_s, cost_usd, created_at, completed_at, expires_at)
      select ${memberId}, ${one.thread.id}, ${`${SEEDANCE}/text-to-video`}, ${`[composer] ${stamp} older `} || n, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })},
        'completed', '/mock/result-landscape.webm', 5, 0.4925, now() - make_interval(hours => 2, mins => n), now() - make_interval(hours => 2, mins => n - 1), now() + interval '6 days'
      from generate_series(1, 14) n`;
    await a.reload({ waitUntil: "networkidle" });
    if (threadOf() !== one.thread.id) ev.fail(`reload left the thread for ${threadOf()}`);
    const articles = stream.locator("article[data-id]");
    await a.waitForFunction(() => document.querySelectorAll("article[data-id]").length === 12, null, { timeout: 20_000 }).catch(() => ev.fail("a reload should show the newest 12 turns"));
    if ((await articles.last().getAttribute("data-id")) !== three.item.id) ev.fail("the newest turn should be at the bottom");
    const atBottom = await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (!atBottom) ev.fail("the stream should open at the newest turn");
    ev.note("reload kept the thread and opened at the newest turn");
    let release;
    const held = new Promise((r) => (release = r));
    const olderPage = (url) => url.pathname === "/api/generations" && url.searchParams.has("before");
    await a.route(olderPage, async (route) => {
      await held;
      await route.continue();
    });
    const topId = await articles.first().getAttribute("data-id");
    await stream.evaluate((el) => (el.scrollTop = 0));
    await stream.getByText(await ta("playground.older.loading")).waitFor({ timeout: 10_000 });
    await review("older-loading", a);
    const topBefore = await stream.locator(`article[data-id="${topId}"]`).evaluate((el) => el.getBoundingClientRect().top);
    release();
    await a.waitForFunction(() => document.querySelectorAll("article[data-id]").length === 17, null, { timeout: 20_000 }).catch(() => ev.fail("scrolling up should load the five older turns"));
    await a.unroute(olderPage);
    const topAfter = await stream.locator(`article[data-id="${topId}"]`).evaluate((el) => el.getBoundingClientRect().top);
    if (Math.abs(topAfter - topBefore) > 4) ev.fail(`the turn at the top moved from ${topBefore} to ${topAfter} when older turns loaded`);
    await stream.getByText(await ta("playground.older.start")).waitFor();
    ev.note(`older turns: 12 → 17, the top turn stayed at ${Math.round(topBefore)} px`);
    await a.getByRole("button", { name: await ta("playground.latest") }).click();
    for (let i = 0; !(await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80)); i++) {
      if (i === 25) ev.fail("the jump-to-latest button should scroll to the newest turn");
      await a.waitForTimeout(200);
    }

    if (sideways.length) ev.fail(`horizontal overflow: ${sideways.join(", ")}`);
    ev.note(`no surface scrolls sideways (${viewport})`);
  } finally {
    await a?.screenshot({ path: join(ev.dir, "98-member-last.png") }).catch(() => {});
    await sql`delete from generations where user_id in (select id from users where username = ${member})`;
    const gone = await sql`delete from users where username = ${member} and username like 'vgs-cmp-%' returning id`;
    for (const item of savedRates ?? []) {
      if (item.modelId in RATES) await ev.api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId: item.modelId, pricePerSecUsd: item.pricePerSecUsd }) });
    }
    ev.note(`cleanup: deleted ${gone.length} member with its rows and threads, rates restored`);
    await sql.end();
  }
}
