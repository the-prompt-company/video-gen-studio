/** Feature: reuse — a member's own results as references and frames, by 레퍼런스로 and by "@". See features/reuse.md. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { composerHandles } from "../composer-handles.mjs";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const SEEDANCE = "bytedance/seedance-2.0";
const GPT = "openai/gpt-image-2";

export default async function reuse({ page, ev, base, env, webDir, local }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, threads and rows, so .env.local must point at a local database");
  const fake = env.VGS_FAKE_HF;
  if (!fake) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; the journey generates through it and reads what it was sent");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "reuse");
  mkdirSync(reviewDir, { recursive: true });
  const sideways = [];
  const review = async (surface, p) => {
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await p.waitForTimeout(300);
    await ev.shot(surface, { page: p });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`) });
    const [scroll, inner] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (scroll !== inner) sideways.push(`${surface} ${scroll}>${inner}`);
    const inside = await p.evaluate(() => [...document.querySelectorAll("[role=region], [role=listbox]")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute("aria-label") ?? el.id));
    if (inside.length) sideways.push(`${surface} inside ${inside.join(", ")}`);
  };

  const stamp = Date.now().toString(36);
  const member = `vgs-reuse-${stamp}@example.test`;
  const teammate = `vgs-reuse-${stamp}-b@example.test`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const stats = async () => (await fetch(`${fake}/_stats`)).json();
  let a = null;

  try {
    await ev.login("/gallery", page);
    for (const username of [member, teammate]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password: INITIAL, apiKey: "fake-id:fake-secret" }) });
      if (made.status !== 201) ev.fail(`creating ${username} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    const [{ id: memberId }] = await sql`select id from users where username = ${member}`;
    const [{ id: teammateId }] = await sql`select id from users where username = ${teammate}`;

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
    const { box, prompt, status } = h;
    const listbox = a.getByRole("listbox", { name: await ta("playground.picker.label") });
    const panel = listbox.locator("xpath=..");
    const attachButton = async (id) => h.turn(id).getByRole("button", { name: await ta("playground.actions.attach"), exact: true });
    const submit = async (label) => {
      const { status: code, body } = await h.submit();
      if (!body?.item || !body?.thread || code >= 400) ev.fail(`${label}: POST answered ${code} ${JSON.stringify(body)}`);
      return body;
    };
    const readRows = async (ids) => (await ev.api(`/api/generations?ids=${ids.join(",")}`, undefined, a)).body?.items ?? [];
    const settle = async (ids, why) => {
      for (let i = 0; ; i++) {
        const rows = await readRows(ids);
        if (rows.length === ids.length && rows.every((r) => r.status === "completed" && r.ref && (r.video === null || r.video.kind === "stored"))) return ids.map((id) => rows.find((r) => r.id === id));
        if (i === 90) ev.fail(`${why}: rows did not complete with a stored result: ${JSON.stringify(rows.map((r) => [r.status, r.video?.kind, r.ref]))}`);
        await a.waitForTimeout(1000);
      }
    };
    const sentFor = async (id) => {
      for (let i = 0; i < 50; i++) {
        const sent = (await stats()).submits.find((s) => s.idempotencyKey === id);
        if (sent) return sent;
        await a.waitForTimeout(200);
      }
      ev.fail(`the fake saw no submit for row ${id}`);
    };
    const typeMention = async (text) => {
      await prompt.focus();
      await a.keyboard.press("End");
      await a.keyboard.type(text);
      await listbox.waitFor({ state: "attached", timeout: 10_000 });
      await panel.getByText(await ta("playground.picker.loading")).waitFor({ state: "detached", timeout: 15_000 });
    };
    const optionNames = async () => (await listbox.getByRole("option").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());

    const V = `[reuse] ${stamp} 비 오는 다리`;
    const A = `[reuse] ${stamp} 등대 beacon-a`;
    const B = `[reuse] ${stamp} 등대 beacon-b`;
    await prompt.fill(V);
    const { item: v, thread: { id: thread } } = await submit("text→video");
    await h.pickModel(GPT, "image");
    await prompt.fill(A);
    const imgA = (await submit("image A")).item;
    await prompt.fill(B);
    const imgB = (await submit("image B")).item;
    const [rowV, rowA, rowB] = await settle([v.id, imgA.id, imgB.id], "the three results");
    const stored = { v: rowV.video.url, a: rowA.image.url, b: rowB.image.url };
    for (const [k, url] of Object.entries(stored)) if (!url.startsWith(`${fake}/blob/${k === "v" ? "videos" : "images"}/`)) ev.fail(`result ${k} should be stored in Blob, is ${url}`);
    if (rowV.ref.url !== stored.v || rowV.ref.kind !== "video" || rowV.ref.seconds !== 5 || rowA.ref.url !== stored.a) ev.fail(`ref should name the stored copy: ${JSON.stringify([rowV.ref, rowA.ref])}`);
    await (await attachButton(imgB.id)).waitFor({ timeout: 20_000 });
    await review("turn-actions", a);
    ev.note(`results: video ${stored.v} (5 s), images ${stored.a} and ${stored.b}, each turn offers ${await ta("playground.actions.attach")}`);

    await h.pickModel(SEEDANCE, "video");
    await (await attachButton(v.id)).click();
    await (await attachButton(imgA.id)).click();
    for (let i = 0; (await h.refs.count()) !== 2; i++) {
      if (i === 50) ev.fail(`two results should be attached, found ${await h.refs.count()}`);
      await a.waitForTimeout(100);
    }
    if ((await h.chipText()) !== (await h.modeLabel(SEEDANCE, "r2v"))) ev.fail(`attaching in text mode should switch to references, chip reads ${await h.chipText()}`);
    if (!(await box.getByText(await ta("playground.fact.inputVideo", { seconds: "5.0" })).isVisible())) ev.fail("the estimate should count the reused video's stored 5 s");
    await review("attached", a);
    await (await attachButton(imgA.id)).click();
    await box.getByRole("alert").filter({ hasText: await ta("playground.upload.attached") }).waitFor({ timeout: 10_000 });
    if ((await h.refs.count()) !== 2) ev.fail("attaching the same result again should change nothing");
    await review("duplicate", a);

    await prompt.fill(`[reuse] ${stamp} 같은 다리, 더 넓게`);
    const r2v = (await submit("reference→video")).item;
    const sentR2v = await sentFor(r2v.id);
    if (sentR2v.endpoint !== `${SEEDANCE}/reference-to-video` || JSON.stringify(sentR2v.body.image_urls) !== JSON.stringify([stored.a]) || JSON.stringify(sentR2v.body.video_urls) !== JSON.stringify([stored.v])) {
      ev.fail(`reference→video sent ${sentR2v.endpoint} ${JSON.stringify(sentR2v.body)}`);
    }
    if ((await h.refs.count()) !== 2 || (await box.getByText(await ta("playground.note.spent", { count: 2 })).count()) > 0) ev.fail("reused results are not uploads and should stay attached after a Higgsfield send");
    const r2vTurn = h.turn(r2v.id);
    const thumbs = r2vTurn.getByRole("list", { name: await ta("playground.feed.refsLabel", { images: 1, videos: 1 }) }).getByRole("listitem");
    if ((await thumbs.count()) !== 2) ev.fail(`the new turn should show two reference thumbnails, shows ${await thumbs.count()}`);
    ev.note(`r2v: image_urls ${JSON.stringify(sentR2v.body.image_urls)}, video_urls ${JSON.stringify(sentR2v.body.video_urls)}; both stayed in the composer`);
    await review("sent", a);

    const [r2vRow] = await settle([r2v.id], "the reference→video row");
    const deleted = (await stats()).storage.deleted ?? [];
    if (deleted.some((p) => p.startsWith("videos/") || p.startsWith("images/"))) ev.fail(`ref cleanup deleted a result: ${JSON.stringify(deleted)}`);
    for (const url of [stored.v, stored.a]) if ((await fetch(url)).status !== 200) ev.fail(`${url} should still be served after the row that used it ended`);
    const thumb = thumbs.first().locator("img");
    await thumb.scrollIntoViewIfNeeded();
    await a.waitForFunction((el) => el.complete && el.naturalWidth > 0, await thumb.elementHandle(), { timeout: 10_000 }).catch(() => ev.fail("the finished turn's reference thumbnail should still load"));
    ev.note(`cleanup: the reference→video row ended ${r2vRow.status}; the store deleted ${JSON.stringify(deleted)}, both results still serve 200`);

    await h.pickMode("text", "t2v");
    await h.pickMode("firstFrame", "i2v");
    await prompt.fill("");
    await typeMention("@");
    const hidden = await ta("playground.picker.hidden", { reason: "frames", model: "Seedance 2.0" });
    if (!(await panel.getByText(hidden).isVisible())) ev.fail("frames should say video results are hidden");
    const offered = await optionNames();
    if (offered.some((s) => s.includes(V)) || !offered[0]?.includes(B) || !offered[1]?.includes(A)) ev.fail(`frames should offer this thread's images newest first and no video, offered ${JSON.stringify(offered)}`);
    const groupName = await ta("playground.picker.thread");
    if (!(await listbox.getByRole("group", { name: groupName }).isVisible())) ev.fail(`this thread's results should come under ${groupName}`);
    await review("picker", a);
    await a.keyboard.type("beacon-b");
    for (let i = 0; (await listbox.getByRole("option").count()) !== 1; i++) {
      if (i === 30) ev.fail(`typing beacon-b should leave one option, has ${await listbox.getByRole("option").count()}`);
      await a.waitForTimeout(100);
    }
    const only = listbox.getByRole("option");
    await (viewport === "mobile" ? only.tap() : only.click());
    await listbox.waitFor({ state: "detached" });
    if ((await prompt.inputValue()) !== "") ev.fail(`the picked @ word should leave the prompt, it reads "${await prompt.inputValue()}"`);
    if (!(await prompt.evaluate((el) => el === document.activeElement))) ev.fail("a pointer pick should leave focus in the prompt");
    await typeMention(" @");
    if (!(await listbox.getByRole("option").first().getByText(await ta("playground.picker.attached")).isVisible())) ev.fail("the picked image should be marked as added");
    await a.keyboard.press("ArrowDown");
    const active = await prompt.getAttribute("aria-activedescendant");
    if (!active || !(await a.locator(`[id="${active}"]`).innerText()).includes(A)) ev.fail(`ArrowDown should make image A the active option, active is ${active}`);
    await a.keyboard.press("Enter");
    await listbox.waitFor({ state: "detached" });
    for (const [slot, name] of [["start", B], ["end", A]]) {
      if (!(await box.getByRole("button", { name: await ta("playground.frames.remove", { slot, name }), exact: true }).isVisible())) ev.fail(`the ${slot} frame should hold ${name}`);
    }
    await prompt.fill(`[reuse] ${stamp} 등대 사이를 지나가는 카메라`);
    await review("frames", a);
    const i2v = (await submit("frames")).item;
    const sentI2v = await sentFor(i2v.id);
    if (sentI2v.endpoint !== `${SEEDANCE}/image-to-video` || sentI2v.body.image_url !== stored.b || sentI2v.body.end_image_url !== stored.a) ev.fail(`frames sent ${sentI2v.endpoint} ${JSON.stringify(sentI2v.body)}`);
    ev.note(`i2v by @: image_url ${sentI2v.body.image_url}, end_image_url ${sentI2v.body.end_image_url}`);

    await h.pickModel(GPT, "image");
    if ((await h.chipText()) !== (await h.modeLabel(GPT, "r2i"))) ev.fail(`frames should become GPT Image 2 references, chip reads ${await h.chipText()}`);
    const editPrompt = `[reuse] ${stamp} 두 등대를 한 장면으로`;
    await prompt.fill(editPrompt);
    await submit("reference→image");
    const sentEdit = (await stats()).openai.requests.filter((r) => r.body.prompt === editPrompt);
    if (sentEdit.length !== 1 || sentEdit[0].op !== "edits" || JSON.stringify(sentEdit[0].body.images) !== JSON.stringify([{ image_url: stored.b }, { image_url: stored.a }])) {
      ev.fail(`the OpenAI edit received ${JSON.stringify(sentEdit.map((r) => [r.op, r.body.images]))}`);
    }
    ev.note(`r2i: OpenAI edits received images ${JSON.stringify(sentEdit[0].body.images)}`);

    const theirs = randomUUID();
    const expired = randomUUID();
    await sql`insert into generations (id, user_id, model_id, prompt, params, status, storage_path, duration_s, cost_usd, created_at, completed_at)
      values (${theirs}, ${teammateId}, ${`${GPT}/generations`}, ${`[reuse] ${stamp} teammate`}, ${sql.json({ aspect_ratio: "1:1", output_format: "png" })}, 'completed', ${`images/${theirs}.png`}, 0, 0, now(), now())`;
    await sql`insert into generations (id, user_id, thread_id, model_id, prompt, params, status, result_url, expires_at, duration_s, cost_usd, created_at, completed_at)
      values (${expired}, ${memberId}, ${thread}, ${`${SEEDANCE}/text-to-video`}, ${`[reuse] ${stamp} expired-clip`}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })}, 'completed',
        ${`${fake}/files/expired-${stamp}.mp4`}, now() - interval '1 hour', 5, 0, now() - interval '8 days', now() - interval '8 days')`;
    const post = (images, videos) => ev.api("/api/generations", { method: "POST", body: JSON.stringify({ family: SEEDANCE, mode: "r2v", prompt: "x", params: {}, images, videos, endImage: null, thread }) }, a);
    const notYours = await post([`${fake}/blob/images/${theirs}.png`], []);
    if (notYours.status !== 400 || notYours.body?.error?.code !== "refNotYours") ev.fail(`a teammate's result answered ${notYours.status} ${JSON.stringify(notYours.body)}`);
    const gone = await post([], [{ url: `${fake}/files/expired-${stamp}.mp4`, seconds: 5 }]);
    if (gone.status !== 400 || gone.body?.error?.code !== "resultGone") ev.fail(`an expired result answered ${gone.status} ${JSON.stringify(gone.body)}`);
    const upload = await post([`${fake}/blob/refs/${teammateId}/1-a.jpg`], []);
    if (upload.status !== 400 || upload.body?.error?.code !== "refNotYours") ev.fail(`a teammate's upload answered ${upload.status} ${JSON.stringify(upload.body)}`);
    ev.note(`server: teammate result ${JSON.stringify(notYours.body.error)}, teammate upload ${JSON.stringify(upload.body.error)}, expired result ${JSON.stringify(gone.body.error)}`);

    await a.reload({ waitUntil: "networkidle" });
    const expiredTurn = h.turn(expired);
    await expiredTurn.waitFor({ timeout: 20_000 });
    if ((await expiredTurn.getByRole("button", { name: await ta("playground.actions.attach"), exact: true }).count()) !== 0) ev.fail("a result whose media is gone should not offer 레퍼런스로");
    await prompt.fill("");
    await expiredTurn.scrollIntoViewIfNeeded();
    await typeMention("@expired-clip");
    if (!(await panel.getByRole("status").getByText(await ta("playground.picker.noMatch", { query: "expired-clip" })).isVisible())) ev.fail(`the picker should not offer the expired result, offers ${JSON.stringify(await optionNames())}`);
    await review("gone", a);
    await a.keyboard.press("Escape");
    await listbox.waitFor({ state: "detached" });
    if ((await status.allInnerTexts()).some((s) => s.includes("undefined"))) ev.fail("a status line rendered undefined");

    if (sideways.length) ev.fail(`horizontal overflow: ${sideways.join(", ")}`);
    ev.note(`no surface scrolls sideways (${viewport})`);
  } finally {
    await a?.screenshot({ path: join(ev.dir, "98-member-last.png") }).catch(() => {});
    await sql`delete from generations where user_id in (select id from users where username in (${member}, ${teammate}))`;
    const gone = await sql`delete from users where username in (${member}, ${teammate}) and username like 'vgs-reuse-%' returning id`;
    ev.note(`cleanup: deleted ${gone.length} members with their rows and threads`);
    await sql.end();
  }
}
