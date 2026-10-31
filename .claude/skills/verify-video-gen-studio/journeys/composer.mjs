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
  };
  const file = (name) => join(webDir, "public", "mock", name);
  const LANDSCAPE = [file("ref-landscape-1.jpg"), file("ref-landscape-2.jpg")];
  const SQUARE = file("ref-square.jpg");
  const jpeg = (i) => ({ name: `ref-${i}.jpg`, mimeType: "image/jpeg", buffer: readFileSync(LANDSCAPE[i % 2]) });
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
    const expectChip = async (family, mode, why) => {
      const want = await h.modeLabel(family, mode);
      const got = await h.chipText();
      if (got !== want) ev.fail(`${why}: the model chip reads "${got}", expected "${want}"`);
    };
    const pickMode = async (kind, mode, { keyboard = false } = {}) => {
      if (!keyboard) return h.pickMode(kind, mode);
      const menu = await openMenu();
      await menu.getByRole("button", { name: new RegExp(`^${await ta(`playground.kind.${kind}`)} · ${await ta(`mode.${mode}`)}`) }).focus();
      await a.keyboard.press("Enter");
      await menu.waitFor({ state: "detached" });
    };
    const expectBlocked = async (key, values, why) => {
      if (!(await status.filter({ hasText: await ta(key, values) }).isVisible()) || (await generate.isEnabled())) ev.fail(`${why}: expected the blocker ${key} with 생성하기 off, got status "${(await status.allInnerTexts()).join(" | ")}"`);
    };
    const settled = (why) => h.waitForUploads(why);
    const pickFile = async (button, files) => {
      const [chooser] = await Promise.all([a.waitForEvent("filechooser"), button.click()]);
      await chooser.setFiles(files);
    };
    const attachRefs = (files) => h.imageInput.setInputFiles(files);
    const attachVideo = (files) => h.videoInput.setInputFiles(files);
    const counter = async () => (await box.getByText(new RegExp(`^${(await ta("playground.refs.imageCount", { count: "9", max: "9" })).replace("9/9", "\\d+/\\d+")}`)).innerText()).trim();
    const refList = async () => h.refs;
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

    await stream.getByText(await ta("playground.empty.title"), { exact: true }).waitFor({ timeout: 15_000 });
    await expectChip(SEEDANCE, "t2v", "a member with a key starts on Seedance text");
    await review("new-thread", a);
    await prompt.fill(`[composer] ${stamp} 비 오는 밤 한강 다리, 우산을 펼치는 순간 클로즈업`);
    if (!(await generate.isEnabled())) ev.fail("text mode with a prompt should be ready");
    await review("composer-text", a);

    const menu = await openMenu();
    const modeOptions = (await menu.getByRole("button", { name: new RegExp(`· (${[await ta("mode.t2v"), await ta("mode.i2v"), await ta("mode.r2v")].join("|")})`) }).allInnerTexts()).length;
    if (modeOptions !== 3) ev.fail(`Seedance should list 3 modes, found ${modeOptions}`);
    for (const f of [SEEDANCE, H3]) if (!(await menu.getByRole("button", { name: new RegExp(`^${FAMILY_NAME[f]} · `) }).isVisible())) ev.fail(`the model menu does not list ${FAMILY_NAME[f]}`);
    if (!(await menu.getByText(await ta("playground.rateHint", { basis: await ta("prices.basis.seedance"), rate: await ta("prices.rate", { usd: "$0.0985", unit: "second" }) }))).isVisible()) ev.fail("the Seedance row does not show its rate");
    await review("model-menu", a);
    await a.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    if (!(await h.chip.evaluate((el) => el === document.activeElement))) ev.fail("Esc should return focus to the model chip");

    await pickMode("firstFrame", "i2v", { keyboard: true });
    await expectChip(SEEDANCE, "i2v", "picking 프레임 with Enter");
    await expectBlocked("errors.startFrameRequired", undefined, "frames with no start frame");
    await review("blocker", a);
    await pickFile(box.getByRole("button", { name: new RegExp(await ta("playground.frames.add", { slot: "end" })) }), LANDSCAPE[1]);
    await pickFile(box.getByRole("button", { name: new RegExp(await ta("playground.frames.add", { slot: "start" })) }), LANDSCAPE[0]);
    await settled("frames");
    const startLabel = await ta("playground.frames.remove", { slot: "start", name: "ref-landscape-1.jpg" });
    const endLabel = await ta("playground.frames.remove", { slot: "end", name: "ref-landscape-2.jpg" });
    for (const label of [startLabel, endLabel]) if (!(await box.getByRole("button", { name: label, exact: true }).isVisible())) ev.fail(`the frame slots should hold ${label}`);
    if (!(await generate.isEnabled())) ev.fail(`start and end frames should be ready, status: ${(await status.allInnerTexts()).join(" | ")}`);
    await review("composer-frames", a);

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
    const summaryNow = (await settingsChip.innerText()).trim();
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
    if (sentOne.body.duration !== 8 || sentOne.body.resolution !== "720p" || "aspect_ratio" in sentOne.body) ev.fail(`frames settings ${JSON.stringify(sentOne.body)}`);
    if (usd(one.estimatedCostUsd) !== costAfter) ev.fail(`the composer showed ${costAfter}, the row was quoted ${one.estimatedCostUsd}`);
    const turnOne = stream.locator(`article[data-id="${one.item.id}"]`);
    await turnOne.waitFor({ timeout: 10_000 });
    const frameLabels = (await turnOne.getByRole("list").getByRole("listitem").allInnerTexts()).map((s) => s.trim());
    const wantLabels = [await ta("playground.feed.frame", { slot: "start" }), await ta("playground.feed.frame", { slot: "end" })];
    if (JSON.stringify(frameLabels) !== JSON.stringify(wantLabels)) ev.fail(`the turn labels its frames ${JSON.stringify(frameLabels)}`);
    ev.note(`end frame: ${sentOne.endpoint} ← image_url ${startUrl}, end_image_url ${endUrl}; row ${one.item.id} in new thread ${one.thread.id}`);

    await pickMode("reference", "r2v");
    if ((await (await refList()).count()) !== 2) ev.fail("frames should become two references");
    await pickMode("text", "t2v");
    const removed = box.getByText(await ta("playground.note.removed", { to: "text", count: 2 }));
    if (!(await removed.isVisible())) ev.fail("choosing text should say the references were removed");
    await box.getByRole("button", { name: await ta("playground.note.undo"), exact: true }).click();
    await expectChip(SEEDANCE, "r2v", "되돌리기");
    if ((await (await refList()).count()) !== 2) ev.fail("되돌리기 should restore both references");

    await attachRefs([0, 1, 2, 3, 4].map(jpeg));
    const tooMany = await ta("playground.upload.tooMany", { kind: "image", max: 6 });
    await box.getByRole("alert").filter({ hasText: tooMany }).waitFor({ timeout: 10_000 }).catch(() => ev.fail(`a seventh image should be refused with "${tooMany}"`));
    await attachVideo(CLIP);
    await settled("references");
    const count = await counter();
    const wantCount = `${await ta("playground.refs.imageCount", { count: "6", max: "6" })}`;
    if (!count.startsWith(wantCount) || (await (await refList()).count()) !== 7) ev.fail(`the counter reads "${count}" with ${await (await refList()).count()} items`);
    if (!(await box.getByText(await ta("playground.fact.inputVideo", { seconds: "3.0" })).isVisible())) ev.fail("the cost line should count the 3 s video");
    await review("composer-references", a);
    await pickModel(H3);
    await expectChip(H3, "r2v", "switching to H3 keeps the mode");
    await expectBlocked("errors.tooManyImages", { model: "MiniMax H3", max: 5 }, "six images on H3");
    await box.getByRole("button", { name: await ta("playground.refs.removeLabel", { kind: "image", tag: "6", name: "ref-3.jpg" }), exact: true }).click();
    if (!(await generate.isEnabled())) ev.fail(`five images on H3 should be ready, status: ${(await status.allInnerTexts()).join(" | ")}`);

    await prompt.fill(`[composer] ${stamp} 같은 다리, 카메라를 더 낮게`);
    const two = await submit("references", "keyboard");
    if (two.thread.id !== one.thread.id || threadOf() !== one.thread.id) ev.fail(`the second generation went to thread ${two.thread.id}`);
    const sentTwo = await sentFor(two.item.id);
    if (sentTwo.endpoint !== `${H3}/reference-to-video` || sentTwo.body.image_urls?.length !== 5 || sentTwo.body.video_urls?.length !== 1) ev.fail(`references sent ${sentTwo.endpoint} ${JSON.stringify(sentTwo.body)}`);
    ev.note(`references: ${sentTwo.endpoint} with 5 images and 1 video into the same thread by Ctrl+Enter`);

    await pickModel(GPT, "image");
    await expectChip(GPT, "r2i", "the image tab");
    await expectBlocked("errors.noVideoRefs", { model: "GPT Image 2" }, "a video on the image model");
    await pickMode("text", "t2i");
    await box.getByRole("button", { name: await ta("playground.refs.add"), exact: true }).click();
    const addMenu = a.getByRole("dialog", { name: await ta("playground.refs.add") });
    await addMenu.waitFor();
    const [chooser] = await Promise.all([a.waitForEvent("filechooser"), addMenu.getByRole("button", { name: new RegExp(await ta("playground.refs.uploadImages")) }).click()]);
    await chooser.setFiles(SQUARE);
    await box.getByText(await ta("playground.note.switched", { mode: "r2i" })).waitFor();
    if (!(await addMenu.isVisible())) ev.fail("the add menu should stay open for more files");
    await a.keyboard.press("Escape");
    await expectChip(GPT, "r2i", "adding a reference in text mode");

    const dropped = await a.evaluateHandle(async (b64) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "dropped.jpg", { type: "image/jpeg" }));
      return dt;
    }, readFileSync(LANDSCAPE[0]).toString("base64"));
    const before = await (await refList()).count();
    await box.locator(":scope > div").first().dispatchEvent("drop", { dataTransfer: dropped });
    await settled("drop");
    if ((await (await refList()).count()) !== before + 1) ev.fail("a dropped image should be added");
    ev.note("drag and drop added a reference");

    for (let i = 0; ; i++) {
      const read = await ev.api(`/api/generations?ids=${one.item.id},${two.item.id}`, undefined, a);
      if ((read.body?.items ?? []).every((x) => x.status === "completed")) break;
      if (i === 60) ev.fail("the two generations did not complete");
      await a.waitForTimeout(1000);
    }
    const result = await ta("generation.video");
    await turnOne.getByLabel(result, { exact: true }).waitFor({ timeout: 20_000 });
    await stream.locator(`article[data-id="${two.item.id}"]`).getByLabel(result, { exact: true }).waitFor({ timeout: 20_000 });
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
    if ((await articles.last().getAttribute("data-id")) !== two.item.id) ev.fail("the newest turn should be at the bottom");
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
    await a.waitForFunction(() => document.querySelectorAll("article[data-id]").length === 16, null, { timeout: 20_000 }).catch(() => ev.fail("scrolling up should load the four older turns"));
    await a.unroute(olderPage);
    const topAfter = await stream.locator(`article[data-id="${topId}"]`).evaluate((el) => el.getBoundingClientRect().top);
    if (Math.abs(topAfter - topBefore) > 4) ev.fail(`the turn at the top moved from ${topBefore} to ${topAfter} when older turns loaded`);
    await stream.getByText(await ta("playground.older.start")).waitFor();
    ev.note(`older turns: 12 → 16, the top turn stayed at ${Math.round(topBefore)} px`);
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
