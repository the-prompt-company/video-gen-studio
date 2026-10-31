/**
 * Feature: screens — the gallery, the dashboard and the playground in the browser's language. Saves each surface to
 * .impeccable/review/i18n-3/<surface>-<lang>-<viewport>.png and checks plurals, the Korean particles, the first-frame
 * note, that prompts and nicknames stay as written, and at 390 px that no surface scrolls sideways. Creates and deletes
 * two vgs-loc-* members and their rows and sets the Seedance rate for the run, so it runs on a local database only.
 * See features/screens.md.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { composerHandles, FAMILY_NAME } from "../composer-handles.mjs";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const SEEDANCE = "bytedance/seedance-2.0";
const H3 = "minimax/h3";
const GPT = "openai/gpt-image-2";
const SEEDANCE_RATE = 0.0985;
const NICKNAME = "검증용 한글닉";

export default async function screens({ page, ev, base, env, webDir, local, creds }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, rows and a model rate, so .env.local must point at a local database");
  const fake = env.VGS_FAKE_HF;
  if (!fake) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; references upload to it and GPT Image 2 generates against it");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "i18n-3");
  mkdirSync(reviewDir, { recursive: true });
  const sideways = [];
  const review = async (surface, p, focus, opts = {}) => {
    if (focus) await focus.scrollIntoViewIfNeeded();
    // next dev's corner badge covers the cost bar in review images; it is not part of the app.
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await ev.shot(surface, { page: p, fullPage: opts.fullPage });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`), fullPage: Boolean(opts.fullPage) });
    const [scroll, inner] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (scroll !== inner) sideways.push(`${surface} ${scroll}>${inner}`);
  };
  const expectText = async (locator, want, what) => {
    try {
      await locator.filter({ hasText: want }).first().waitFor({ timeout: 30_000 });
    } catch {
      ev.fail(`${what}: expected "${want}", got "${(await locator.allTextContents()).join(" | ")}"`);
    }
  };
  const plain = (c) => c;

  const stamp = Date.now().toString(36);
  const [memberA, memberB] = ["a", "b"].map((x) => `vgs-loc-i18n3-${stamp}-${x}@example.test`);
  const promptKo = `[목업] i18n3 ${stamp} 비 오는 밤 한강 다리 위를 지나는 드론 샷`;
  const imagePrompt = `[목업] i18n3 ${stamp} 안개 낀 새벽 등대`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const [{ locale: adminLocale }] = await sql`select locale from users where username = ${creds.username}`;
  const [{ price: seedancePrice }] = await sql`select price_per_sec_usd as price from models where model_id = ${SEEDANCE}`;
  const signIn = async (p, id, password) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(password);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };
  const firstSignIn = async (p, id) => {
    await signIn(p, id, INITIAL);
    await p.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, p) }).waitFor({ timeout: 30_000 });
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(`${id}-chosen`);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(`${id}-chosen`);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
    await p.waitForURL("**/playground", { timeout: 30_000 });
  };

  try {
    await ev.login("/gallery", page);
    for (const [id, apiKey] of [[memberA, "fake-id:fake-secret"], [memberB, ""]]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL, apiKey }) });
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    const [{ id: aId }] = await sql`select id from users where username = ${memberA}`;
    const nick = await ev.api(`/api/admin/users/${aId}`, { method: "PATCH", body: JSON.stringify({ nickname: NICKNAME }) });
    if (nick.status !== 200) ev.fail(`setting the nickname answered ${nick.status}: ${JSON.stringify(nick.body)}`);
    const rate = await ev.api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId: SEEDANCE, pricePerSecUsd: SEEDANCE_RATE }) });
    if (rate.status !== 200) ev.fail(`setting the Seedance rate answered ${rate.status}: ${JSON.stringify(rate.body)}`);
    // Two Seedance rows and one H3 row, so the dashboard counts 2 and 1. The newest asks for 20 s, which Seedance refuses.
    await sql`
      insert into generations (user_id, model_id, prompt, params, image_refs, video_refs, status, result_url, duration_s, cost_usd, created_at, completed_at, expires_at)
      values
        (${aId}, ${`${SEEDANCE}/reference-to-video`}, ${promptKo}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9", generate_audio: true })},
          ${["/mock/ref-landscape-1.jpg", "/mock/ref-landscape-2.jpg"]}, ${["/mock/ref-video.webm"]}, 'completed', '/mock/result-landscape.webm', 5, 0.5,
          now() - interval '2 hours', now() - interval '119 minutes', now() + interval '6 days 1 hour'),
        (${aId}, ${`${H3}/text-to-video`}, ${`[목업] i18n3 ${stamp} H3 portrait`}, ${sql.json({ duration: 10, aspect_ratio: "9:16", aigc_watermark: false })},
          ${[]}, ${[]}, 'completed', '/mock/result-portrait.webm', 10, 0.65, now() - interval '1 hour', now() - interval '59 minutes', now() + interval '6 days 1 hour'),
        (${aId}, ${`${SEEDANCE}/text-to-video`}, ${`[목업] i18n3 ${stamp} reuse me`}, ${sql.json({ duration: 20, resolution: "480p", aspect_ratio: "16:9", generate_audio: false })},
          ${[]}, ${[]}, 'completed', '/mock/result-landscape.webm', 20, 0.25, now() - interval '5 minutes', now() - interval '4 minutes', now() + interval '6 days 1 hour')`;
    ev.note(`created ${memberA} (API key, nickname ${NICKNAME}, three rows) and ${memberB} (no key, no rows); Seedance rate ${SEEDANCE_RATE} for the run`);

    const a = await ev.newPage();
    const b = await ev.newPage();
    await firstSignIn(a, memberA);
    await firstSignIn(b, memberB);
    const t = (p) => (key, values) => ev.t(key, values, p);
    const ta = t(a);
    const tb = t(b);

    // Gallery tiles: the Korean prompt and nickname stay as written in every language.
    await a.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    await a.getByRole("heading", { level: 1, name: await ta("pages.gallery") }).waitFor();
    await expectText(a.locator("p"), await ta("gallery.lead", { count: 3, expiring: "yes" }), "gallery lead");
    const tile = a.getByRole("button", { name: await ta("gallery.openDetail", { prompt: promptKo }), exact: true });
    await tile.waitFor({ timeout: 10_000 });
    const tileCard = a.getByRole("listitem").filter({ has: tile });
    const keep = await ta("gallery.retention.line", { value: await ta("gallery.retention.days", { days: 6 }) });
    if (!(await tileCard.innerText()).includes(promptKo)) ev.fail("the tile does not show the Korean prompt as written");
    await expectText(tileCard.locator("div"), keep, "tile retention line");
    if (!(await a.getByRole("link", { name: new RegExp(NICKNAME) }).first().isVisible())) ev.fail(`the header does not show the nickname ${NICKNAME}`);
    ev.note(`gallery: tile "${await ta("gallery.openDetail", { prompt: promptKo })}", ${keep}, header nickname ${NICKNAME}`);
    await review("gallery-tiles", a, tile);

    // Gallery detail: dialog name, reference counts, parameter rows and Download in the page language; the prompt as written.
    await tile.click();
    const detail = a.getByRole("dialog", { name: await ta("gallery.detail.title") });
    await detail.waitFor({ timeout: 10_000 });
    await expectText(detail.locator("h3"), await ta("gallery.detail.refs", { images: 2, videos: 1 }), "detail reference counts");
    const terms = (await detail.locator("dt").allTextContents()).map((s) => s.trim());
    for (const key of ["params.duration", "params.resolution", "params.aspect_ratio", "params.generate_audio", "gallery.detail.created", "gallery.detail.completed", "gallery.retention.label"]) {
      if (!terms.includes(await ta(key))) ev.fail(`detail has no "${await ta(key)}" row: ${terms.join(" | ")}`);
    }
    if (!(await detail.locator("dd").allTextContents()).map((s) => s.trim()).includes(await ta("gallery.detail.on"))) ev.fail("generate_audio true should read gallery.detail.on");
    if (!(await detail.getByRole("link", { name: await ta("generation.download") }).isVisible())) ev.fail("detail has no download link");
    if (!(await detail.innerText()).includes(promptKo)) ev.fail("the detail does not show the Korean prompt as written");
    ev.note(`gallery-detail: ${terms.join(" · ")}`);
    await review("gallery-detail", a);
    await a.keyboard.press("Escape");

    // Dashboard plurals: two Seedance generations, one H3, none failed.
    await a.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    const usage = (await a.locator("li").allInnerTexts()).join(" | ");
    for (const [count, cost] of [[2, "$0.7500"], [1, "$0.6500"]]) {
      const want = await ta("dashboard.modelUsage", { count, cost });
      if (!usage.includes(want)) ev.fail(`dashboard by model should read "${want}": ${usage}`);
    }
    await expectText(a.locator("div"), await ta("dashboard.stats.outcomes", { completed: 3, failed: 0 }), "dashboard outcomes");
    ev.note(`dashboard plurals: "${await ta("dashboard.modelUsage", { count: 2, cost: "$0.7500" })}", "${await ta("dashboard.modelUsage", { count: 1, cost: "$0.6500" })}", "${await ta("dashboard.stats.outcomes", { completed: 3, failed: 0 })}"`);
    await ev.shot("dashboard-plurals", { page: a, fullPage: true });

    // Empty gallery: the sentence and its link to the playground.
    await b.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    const empty = b.getByText(await tb("gallery.empty", { link: plain }));
    await empty.waitFor({ timeout: 10_000 });
    const link = empty.getByRole("link", { name: await tb("pages.playground") });
    if ((await link.getAttribute("href")) !== "/playground") ev.fail(`the empty gallery links to ${await link.getAttribute("href")}`);
    await review("gallery-empty", b, empty);

    await b.goto(`${base}/playground`, { waitUntil: "networkidle" });
    const hb = await composerHandles(ev, b);
    // The composer opens on a model the member can use, GPT Image 2 here, so pick the Higgsfield model that needs the key.
    await hb.pickModel(SEEDANCE, "video");
    const banner = hb.status.filter({ hasText: await tb("errors.noKey") });
    await banner.first().waitFor({ timeout: 10_000 });
    if (await hb.generate.isEnabled()) ev.fail("생성하기 must stay disabled without an API key");
    await review("no-key-banner", b, banner.first());

    // Admin scope links switch scope; the admin's stored language does not move.
    await page.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    // The member's newest row is minutes old, so it is among the first tiles of 전체 however many rows the admin has.
    const memberTile = page.getByRole("button", { name: await ev.t("gallery.openDetail", { prompt: `[목업] i18n3 ${stamp} reuse me` }), exact: true });
    if (await memberTile.count()) ev.fail(`${await ev.t("gallery.scope.mine")} shows the member's row`);
    await page.getByRole("link", { name: await ev.t("gallery.scope.everyone"), exact: true }).click();
    await page.waitForURL("**/gallery?scope=everyone");
    await page.waitForLoadState("networkidle");
    if (!(await memberTile.count())) ev.fail(`${await ev.t("gallery.scope.everyone")} does not show the member's row`);
    await review("admin-scope", page);
    await page.getByRole("link", { name: await ev.t("gallery.scope.mine"), exact: true }).click();
    await page.waitForURL(/\/gallery$/);
    if (await memberTile.count()) ev.fail(`back on ${await ev.t("gallery.scope.mine")}, the member's row still shows`);
    ev.note(`admin-scope: the member's row shows under ${await ev.t("gallery.scope.everyone")} only`);

    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    for (const key of ["totalSpend", "generations", "videoLength", "apiKey"]) {
      if (!(await page.getByText(await ev.t(`dashboard.stats.${key}`), { exact: true }).first().isVisible())) ev.fail(`dashboard stat ${key} missing`);
    }
    await review("dashboard", page, undefined, { fullPage: true });

    // The seeded rows have no thread, so they are in the earlier history.
    await a.goto(`${base}/playground?thread=earlier`, { waitUntil: "networkidle" });
    const h = await composerHandles(ev, a);
    await h.turns.first().waitFor({ timeout: 15_000 });

    await h.turns.filter({ hasText: `[목업] i18n3 ${stamp} reuse me` }).getByRole("button", { name: await ta("playground.actions.reuse"), exact: true }).click();
    // The row asks for 20 s, which Seedance refuses, so 다시 falls back to the default length.
    const summary = await ta("playground.settings.open", { summary: "" });
    const chip = h.box.getByRole("button", { name: new RegExp(`^${summary}`) });
    if (!(await chip.getAttribute("aria-label")).includes(await ta("playground.summary.duration", { seconds: "5" }))) ev.fail(`다시 should fall back to 5 s, the chip reads "${await chip.getAttribute("aria-label")}"`);
    await h.prompt.fill("");
    const blockerText = await ta("errors.promptRequired", { model: "Seedance 2.0", mode: "t2v" });
    const blocker = h.status.filter({ hasText: blockerText });
    await blocker.waitFor({ timeout: 10_000 });
    ev.note(`blocker: "${blockerText}"; 다시 dropped the stored 20 s for 5 s`);
    await review("blocker", a, blocker);

    for (const [family, output, surface] of [[H3, "video", "model-menu-h3"], [GPT, "image", "model-menu-gpt-image-2"], [SEEDANCE, "video", "model-menu-seedance"]]) {
      await h.pickModel(family, output);
      const menu = await h.openMenu();
      const name = FAMILY_NAME[family];
      const row = menu.getByRole("button", { name: new RegExp(`^${name} · `) });
      if ((await row.getAttribute("aria-pressed")) !== "true") ev.fail(`the ${name} row should be the chosen one`);
      const key = { [SEEDANCE]: "seedance", [H3]: "h3", [GPT]: "gptImage2" }[family];
      await expectText(menu.locator("p"), await ta(`families.${key}.note`), `${name} note`);
      await review(surface, a);
      await a.keyboard.press("Escape");
      if (family === GPT) {
        const settings = await h.openSettings();
        for (const param of ["quality", "output_format", "background"]) {
          const pills = (await settings.getByRole("group", { name: await ta(`params.${param}`) }).getByRole("button").allInnerTexts()).map((s) => s.trim());
          const values = { quality: ["low", "medium", "high"], output_format: ["png", "jpeg", "webp"], background: ["auto", "opaque", "transparent"] }[param];
          const want = await Promise.all(values.map((value) => ta(`paramValues.${param}`, { value })));
          if (pills.join("|") !== want.join("|")) ev.fail(`${param} pills read ${pills.join("|")}, want ${want.join("|")}`);
        }
        await review("settings-gpt-image-2", a);
        await a.keyboard.press("Escape");
      }
    }

    await h.prompt.fill(promptKo);
    await h.pickMode("reference", "r2v");
    await h.imageInput.setInputFiles(["ref-landscape-1.jpg", "ref-landscape-2.jpg"].map((f) => join(webDir, "public", "mock", f)));
    const clip = { name: "clip-3s.mp4", mimeType: "video/mp4", buffer: readFileSync(join(webDir, ".claude", "skills", "verify-video-gen-studio", "fixtures", "clip-3s.webm")) };
    await h.videoInput.setInputFiles(clip);
    await h.waitForUploads("two images and a video");
    const count = [await ta("playground.refs.imageCount", { count: "2", max: "6" }), await ta("playground.refs.videoCount", { count: "1", max: "3" })];
    for (const part of count) await expectText(h.box.locator("p"), part, "reference counter");
    const removeName = await ta("playground.refs.removeLabel", { kind: "image", tag: "1", name: "ref-landscape-1.jpg" });
    if (!(await h.box.getByRole("button", { name: removeName, exact: true }).count())) ev.fail(`no remove button named "${removeName}"`);
    await review("references", a);

    const inputVideo = await ta("playground.fact.inputVideo", { seconds: "3.0" });
    const facts = h.box.getByText(inputVideo, { exact: false });
    await facts.waitFor({ timeout: 5_000 });
    const factLine = (await facts.innerText()).trim();
    if (!factLine.includes(await ta("playground.cost.rate", { rate: await ta("prices.rate", { usd: "$0.0985", unit: "second" }) }))) ev.fail(`the estimate line reads "${factLine}"`);
    ev.note(`cost line: ${factLine}`);
    await review("cost-bar", a, facts);

    await h.pickMode("text", "t2v");
    const removed = await ta("playground.note.removed", { to: "text", count: 3 });
    if (lang === "ko" && !removed.includes("레퍼런스 3개를")) ev.fail(`the Korean note reads "${removed}"`);
    const removedEl = h.box.getByText(removed, { exact: true });
    await removedEl.waitFor({ timeout: 5_000 });
    if (/장를|개을/.test(await h.box.innerText())) ev.fail("a Korean particle disagrees with its noun in the composer");
    await review("particles", a, removedEl);

    await h.pickMode("firstFrame", "i2v");
    await h.imageInput.setInputFiles(join(webDir, "public", "mock", "ref-square.jpg"));
    await h.waitForUploads("the square start frame");
    const settings = await h.openSettings();
    const shape = await ta("generation.shape", { shape: "square" });
    const noteWords = { ko: "정사각으로", en: "square", "zh-CN": "方形" }[lang];
    const note = settings.locator("p").filter({ hasText: noteWords }).filter({ hasText: "×" });
    await note.first().waitFor({ timeout: 5_000 });
    const noteText = (await note.first().innerText()).trim();
    if (lang === "ko" && (!noteText.includes("정사각으로") || noteText.includes("정사각로"))) ev.fail(`the Korean note reads "${noteText}"`);
    ev.note(`orientation note (${shape}): ${noteText}`);
    await review("orientation-note", a, note.first());
    await a.keyboard.press("Escape");

    // GPT Image 2 against the fake: translated labels around an untranslated model name.
    await h.pickModel(GPT, "image");
    await h.pickMode("text", "t2i");
    await h.prompt.fill(imagePrompt);
    const { status, body: made } = await h.submit();
    if (status !== 201) ev.fail(`GPT Image 2 POST answered ${status} ${JSON.stringify(made?.error ?? "")}`);
    const item = h.turn(made.item.id);
    const img = item.getByRole("img", { name: await ta("generation.image") });
    await img.waitFor({ timeout: 90_000 });
    await a.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 15_000 });
    await expectText(item.locator("span"), `GPT Image 2 · ${await ta("mode.t2i")}`, "image caption");
    await review("image-model", a, item);

    if (sideways.length) ev.fail(`horizontal overflow: ${sideways.join(", ")}`);
    ev.note(`no surface scrolls sideways (${viewport})`);
    const [{ locale: after }] = await sql`select locale from users where username = ${creds.username}`;
    if (after !== adminLocale) ev.fail(`the admin's users.locale moved from ${adminLocale} to ${after}`);
    ev.note(`the admin's users.locale stayed ${adminLocale}`);
  } finally {
    const ids = [memberA, memberB];
    await sql`delete from generations where user_id in (select id from users where username in ${sql(ids)} and username like 'vgs-loc-%')`;
    const gone = await sql`delete from users where username in ${sql(ids)} and username like 'vgs-loc-%' returning id`;
    await sql`update models set price_per_sec_usd = ${seedancePrice} where model_id = ${SEEDANCE}`;
    ev.note(`cleanup: deleted ${gone.length} members and their rows, Seedance rate back to ${seedancePrice}`);
    await sql.end();
  }
}
