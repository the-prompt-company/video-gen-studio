/**
 * Feature: threads — the playground's threads. A member starts two threads from the new-thread state, switches between
 * them and sees only each one's results, reloads and goes back on a thread, opens the earlier history (rows written
 * with no thread, as master's code writes them), deletes the thread on the stage and finds its results still in the
 * gallery with the dashboard unchanged, and is refused another member's thread, as is an admin. Saves the review images
 * to .impeccable/review/threads/<surface>-<lang>-<viewport>.png. Creates and deletes two vgs-thr-* members and their
 * rows and threads, so it runs on a local database only, with VGS_FAKE_HF naming the fake the app talks to.
 * See features/threads.md.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const T2V = "bytedance/seedance-2.0/text-to-video";

/** The title rule as the operator wrote it: whitespace collapsed, cut after 30 graphemes with an ellipsis. */
function titleOf(prompt) {
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(prompt.replace(/\s+/g, " ").trim()), (s) => s.segment);
  return graphemes.length <= 30 ? graphemes.join("") : `${graphemes.slice(0, 30).join("").trimEnd()}…`;
}

export default async function threads({ page, ev, base, env, webDir, local }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, threads and rows, so .env.local must point at a local database");
  if (!env.VGS_FAKE_HF) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; the journey generates through it");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const mobile = env.VGS_MOBILE === "1";
  const viewport = mobile ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "threads");
  mkdirSync(reviewDir, { recursive: true });
  const sideways = [];
  const review = async (surface, p) => {
    // next dev's corner badge covers the thread column in review images; it is not part of the app.
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await ev.shot(surface, { page: p });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`) });
    const [scroll, inner] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (scroll !== inner) sideways.push(`${surface} ${scroll}>${inner}`);
  };

  const stamp = Date.now().toString(36);
  const [memberA, memberB] = ["a", "b"].map((x) => `vgs-thr-${stamp}-${x}@example.test`);
  const prompts = {
    one: `[threads] ${stamp} 비 오는 밤 한강 다리 위를 지나는 드론 샷, 네온이 젖은 노면에 번진다`,
    oneAgain: `[threads] ${stamp} 같은 다리, 카메라를 더 낮게`,
    two: `[threads] ${stamp} 세로 숏폼 카페 창가 라떼 아트`,
    earlier: [`[threads] ${stamp} 스레드 전에 만든 첫 행`, `[threads] ${stamp} 스레드 전에 만든 둘째 행`],
    foreign: `[threads] ${stamp} B만 아는 프롬프트`,
  };
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });

  try {
    await ev.login("/gallery", page);
    for (const [id, apiKey] of [[memberA, "fake-id:fake-secret"], [memberB, ""]]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL, apiKey }) });
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    const [{ id: aId }] = await sql`select id from users where username = ${memberA}`;
    const [{ id: bId }] = await sql`select id from users where username = ${memberB}`;
    // A's earlier history: two finished rows inserted the way master's code inserts, naming no thread.
    const earlierRows = await sql`
      insert into generations (user_id, model_id, prompt, params, status, result_url, duration_s, cost_usd, created_at, completed_at, expires_at)
      values
        (${aId}, ${T2V}, ${prompts.earlier[0]}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })}, 'completed', '/mock/result-landscape.webm', 5, 0.5,
          now() - interval '3 hours', now() - interval '179 minutes', now() + interval '6 days'),
        (${aId}, ${T2V}, ${prompts.earlier[1]}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "9:16" })}, 'completed', '/mock/result-portrait.webm', 5, 0.5,
          now() - interval '2 hours', now() - interval '119 minutes', now() + interval '6 days')
      returning id`;
    const earlierIds = earlierRows.map((r) => r.id).reverse();
    // B's own thread with one row: the thread A, and the admin, must not reach.
    const foreignId = randomUUID();
    await sql`insert into threads (id, user_id, kind, title) values (${foreignId}, ${bId}, 'chat', ${prompts.foreign})`;
    await sql`
      insert into generations (user_id, thread_id, model_id, prompt, status, result_url, duration_s, cost_usd, completed_at)
      values (${bId}, ${foreignId}, ${T2V}, ${prompts.foreign}, 'completed', '/mock/result-landscape.webm', 5, 0.5, now())`;
    ev.note(`created ${memberA} (fake key, two rows with no thread) and ${memberB} (thread ${foreignId} with one row)`);

    const a = await ev.newPage();
    const ta = (key, values) => ev.t(key, values, a);
    await a.goto(`${base}/login`, { waitUntil: "networkidle" });
    await a.getByLabel("ID").fill(memberA);
    await a.getByLabel(await ta("auth.password")).fill(INITIAL);
    await a.getByRole("button", { name: await ta("auth.signIn"), exact: true }).click();
    await a.getByRole("heading", { level: 1, name: await ta("auth.heading.temporary.title") }).waitFor({ timeout: 30_000 });
    await a.getByLabel(await ta("auth.newPassword")).first().fill(`${memberA}-chosen`);
    await a.getByLabel(await ta("auth.confirmPassword")).fill(`${memberA}-chosen`);
    await a.getByRole("button", { name: await ta("auth.changePassword"), exact: true }).click();
    await a.waitForURL("**/playground", { timeout: 30_000 });
    await a.waitForLoadState("networkidle");

    const drawer = a.getByRole("complementary", { name: await ta("playground.drawer") });
    const stage = a.getByRole("region", { name: await ta("playground.stage") });
    const earlierName = await ta("threads.earlier");
    const threadOf = () => new URL(a.url()).searchParams.get("thread");
    const stageIds = () => stage.locator("article[data-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
    const expectStage = async (ids, why) => {
      try {
        await a.waitForFunction((want) => JSON.stringify([...document.querySelectorAll("section article[data-id]")].map((e) => e.dataset.id)) === JSON.stringify(want), ids, { timeout: 20_000 });
      } catch {
        ev.fail(`${why}: the stage should hold ${JSON.stringify(ids)}, got ${JSON.stringify(await stageIds())} at ${a.url()}`);
      }
    };
    // Desktop shows the list as a column; at 390 px the bar's button opens it in a sheet.
    const openList = async () => {
      if (!mobile) return a.getByRole("navigation", { name: await ta("threads.label") });
      await a.getByRole("button", { name: await ta("threads.picker") }).click();
      const sheet = a.getByRole("dialog", { name: await ta("threads.label") });
      await sheet.waitFor();
      return sheet;
    };
    const closeList = async (list) => {
      if (mobile) await list.getByRole("button", { name: await ta("common.close") }).click();
    };
    const listNames = async () => {
      const list = await openList();
      const names = (await list.getByRole("link").allInnerTexts()).map((s) => s.trim());
      await closeList(list);
      return names;
    };
    const pick = async (name) => {
      const list = await openList();
      await list.getByRole("link", { name, exact: true }).click();
    };
    const waitDone = async (ids) => {
      for (let i = 0; ; i++) {
        const read = await ev.api(`/api/generations?ids=${ids.join(",")}`, undefined, a);
        if ((read.body?.items ?? []).filter((x) => x.status === "completed").length === ids.length) return;
        if (i === 60) ev.fail(`generations did not complete: ${JSON.stringify(read.body?.items?.map((x) => x.status))}`);
        await a.waitForTimeout(1000);
      }
    };
    /** Generate from the drawer as it stands, after typing `prompt` when one is given. */
    const generate = async (prompt) => {
      if (prompt !== undefined) await drawer.getByLabel(await ta("playground.prompt")).fill(prompt);
      const answer = a.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/generations", { timeout: 30_000 });
      await drawer.getByRole("button", { name: await ta("playground.generate"), exact: true }).click();
      const res = await answer;
      const body = await res.json().catch(() => null);
      if (!body?.item || !body?.thread) ev.fail(`POST /api/generations answered ${res.status()}: ${JSON.stringify(body)}`);
      return body;
    };

    // New-thread state: no thread in the URL, the earlier history listed, the stage inviting a first generation.
    if (threadOf() !== null) ev.fail(`the playground opened on thread ${threadOf()} instead of a new thread`);
    await stage.getByText(await ta("threads.fresh.title"), { exact: true }).waitFor({ timeout: 15_000 });
    if (JSON.stringify(await listNames()) !== JSON.stringify([earlierName])) ev.fail(`before any generation the list should hold only ${earlierName}, got ${JSON.stringify(await listNames())}`);
    await review("new-thread", a);

    // The first generation creates the thread, titled by its prompt, and the URL names it.
    const one = await generate(prompts.one);
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === one.thread.id, { timeout: 15_000 });
    if (one.thread.title !== titleOf(prompts.one)) ev.fail(`thread title "${one.thread.title}", expected "${titleOf(prompts.one)}"`);
    await expectStage([one.item.id], "after the first generation");
    const oneAgain = await generate(prompts.oneAgain);
    if (oneAgain.thread.id !== one.thread.id) ev.fail(`the second generation went to thread ${oneAgain.thread.id}, not ${one.thread.id}`);
    if (threadOf() !== one.thread.id) ev.fail("the second generation moved the URL off its thread");
    await expectStage([oneAgain.item.id, one.item.id], "two generations in thread one");
    ev.note(`thread one ${one.thread.id} "${one.thread.title}" holds ${one.item.id} and ${oneAgain.item.id}`);

    await a.getByRole("button", { name: await ta("threads.new"), exact: true }).click();
    await a.waitForURL((u) => !new URL(u).searchParams.has("thread"));
    await stage.getByText(await ta("threads.fresh.title"), { exact: true }).waitFor();
    await expectStage([], "a new thread");
    const two = await generate(prompts.two);
    if (two.thread.id === one.thread.id) ev.fail("the new thread's first generation went into thread one");
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === two.thread.id, { timeout: 15_000 });
    await expectStage([two.item.id], "thread two");

    const made = [one.item.id, oneAgain.item.id, two.item.id];
    await waitDone(made);
    ev.note("the three generations completed against the fake");

    // Latest activity first: thread two, thread one, then the earlier history.
    const order = await listNames();
    const want = [two.thread.title, one.thread.title, earlierName];
    if (JSON.stringify(order) !== JSON.stringify(want)) ev.fail(`list order ${JSON.stringify(order)}, expected ${JSON.stringify(want)}`);
    ev.note(`list: ${order.join(" | ")}`);
    if (mobile) {
      await openList();
      await review("thread-picker", a);
      await closeList(a.getByRole("dialog", { name: await ta("threads.label") }));
    } else {
      await review("thread-list", a);
    }

    // Switching shows only the picked thread's results.
    await pick(one.thread.title);
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === one.thread.id);
    await expectStage([oneAgain.item.id, one.item.id], "picking thread one");
    await stage.locator("video").first().waitFor({ timeout: 20_000 });
    await review("thread-feed", a);

    // Reuse fills the drawer from the result on the stage, and the next generation stays in this thread.
    await stage.getByRole("button", { name: await ta("playground.rail.reuse") }).click();
    const reusedPrompt = await drawer.getByLabel(await ta("playground.prompt")).inputValue();
    if (reusedPrompt !== prompts.oneAgain) ev.fail(`reuse filled the prompt with "${reusedPrompt}"`);
    const reused = await generate();
    if (reused.thread.id !== one.thread.id || threadOf() !== one.thread.id) ev.fail(`the generation after reuse went to thread ${reused.thread.id}`);
    await expectStage([reused.item.id, oneAgain.item.id, one.item.id], "after reuse in thread one");
    made.push(reused.item.id);
    await waitDone(made);
    ev.note(`reuse refilled "${reusedPrompt}" and generated ${reused.item.id} into thread one`);

    await pick(two.thread.title);
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === two.thread.id);
    await expectStage([two.item.id], "picking thread two");

    // Reload keeps the thread; Back returns to the one before.
    await a.reload({ waitUntil: "networkidle" });
    if (threadOf() !== two.thread.id) ev.fail(`reload left thread two for ${threadOf()}`);
    await expectStage([two.item.id], "thread two after reload");
    // The rail still follows the stage: the download glyph links the result, the gallery glyph counts every finished one.
    const download = stage.getByRole("link", { name: await ta("generation.download") });
    if (!(await download.getAttribute("href"))) ev.fail("the download glyph has no link for the finished result");
    const finished = ((await ev.api("/api/generations?limit=50", undefined, a)).body?.items ?? []).filter((x) => x.status === "completed").length;
    const galleryGlyph = stage.getByRole("link", { name: await ta("pages.gallery") });
    const counter = (await galleryGlyph.locator("xpath=following-sibling::span[1]").textContent())?.trim();
    if (counter !== String(finished)) ev.fail(`the gallery glyph counts ${counter}, the member has ${finished} finished results`);
    ev.note(`rail: download links the result, gallery glyph ${counter}`);
    if (!mobile) {
      const current = await a.getByRole("navigation", { name: await ta("threads.label") }).locator('a[aria-current="page"]').innerText();
      if (current.trim() !== two.thread.title) ev.fail(`after reload the list marks "${current}" current`);
    } else if ((await a.locator("#thread-bar-title").innerText()).trim() !== two.thread.title) ev.fail("after reload the bar does not name thread two");
    await a.goBack();
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === one.thread.id);
    await expectStage([reused.item.id, oneAgain.item.id, one.item.id], "Back to thread one");
    ev.note("reload kept thread two; Back returned to thread one");

    // The earlier history holds the rows made with no thread.
    await pick(earlierName);
    await a.waitForURL((u) => new URL(u).searchParams.get("thread") === "earlier");
    await expectStage(earlierIds, "the earlier history");
    await review("earlier-history", a);

    // Deleting thread one, on the stage, after a confirmation: the list drops it, the stage becomes a new thread.
    const statValue = async (key) => {
      const label = a.getByText(await ta(key), { exact: true }).first();
      return ((await label.locator("xpath=following-sibling::div[1]").textContent()) ?? "").trim();
    };
    const dashboard = async () => {
      await a.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
      return [await statValue("dashboard.stats.generations"), await statValue("dashboard.stats.totalSpend")];
    };
    const before = await dashboard();
    await a.goto(`${base}/playground?thread=${one.thread.id}`, { waitUntil: "networkidle" });
    await expectStage([reused.item.id, oneAgain.item.id, one.item.id], "thread one before its delete");
    const list = await openList();
    const row = list.getByRole("listitem").filter({ has: a.getByRole("link", { name: one.thread.title, exact: true }) });
    if (!mobile) await row.hover();
    await row.getByRole("button", { name: await ta("threads.delete.label", { title: one.thread.title }) }).click();
    const confirm = a.getByRole("dialog", { name: await ta("threads.delete.title") });
    await confirm.waitFor();
    if (!(await confirm.innerText()).includes(await ta("threads.delete.body", { title: one.thread.title }))) ev.fail("the confirmation does not name the thread");
    await review("delete-confirm", a);
    const deleted = a.waitForResponse((r) => r.request().method() === "DELETE" && new URL(r.url()).pathname === `/api/threads/${one.thread.id}`);
    await confirm.getByRole("button", { name: await ta("threads.delete.confirm"), exact: true }).click();
    if ((await deleted).status() !== 200) ev.fail(`DELETE /api/threads/${one.thread.id} answered ${(await deleted).status()}`);
    await confirm.waitFor({ state: "detached" });
    await a.waitForURL((u) => !new URL(u).searchParams.has("thread"));
    await stage.getByText(await ta("threads.fresh.title"), { exact: true }).waitFor();
    const afterDelete = await listNames();
    if (JSON.stringify(afterDelete) !== JSON.stringify([two.thread.title, earlierName])) ev.fail(`after the delete the list reads ${JSON.stringify(afterDelete)}`);
    ev.note(`deleted thread one; the stage is a new thread and the list reads ${afterDelete.join(" | ")}`);

    // Its results stay: the gallery shows both, the feed of all rows keeps them, the dashboard does not move.
    const gone = await ev.api(`/api/generations?thread=${one.thread.id}`, undefined, a);
    if (gone.status !== 404 || gone.body?.error?.code !== "noSuchThread") ev.fail(`the deleted thread's feed answered ${gone.status} ${JSON.stringify(gone.body)}`);
    const all = (await ev.api("/api/generations?limit=50", undefined, a)).body?.items?.map((x) => x.id) ?? [];
    if (!made.every((id) => all.includes(id))) ev.fail("a generation of the deleted thread left the member's rows");
    const after = await dashboard();
    if (JSON.stringify(after) !== JSON.stringify(before)) ev.fail(`the dashboard moved from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
    ev.note(`dashboard generations and spend unchanged: ${before.join(" · ")}`);
    await a.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    for (const prompt of [prompts.one, prompts.oneAgain]) {
      const tile = a.getByRole("button", { name: await ta("gallery.openDetail", { prompt }), exact: true });
      if (!(await tile.count())) ev.fail(`the gallery lost "${prompt}" with its thread`);
    }
    ev.note("both results of the deleted thread are still in the gallery");

    // Another member's thread: the page shows the same not-found state as a deleted one, and every route answers 404.
    for (const [who, p] of [["member", a], ["admin", page]]) {
      await p.goto(`${base}/playground?thread=${foreignId}`, { waitUntil: "networkidle" });
      await p.getByRole("region", { name: await ev.t("playground.stage", undefined, p) }).getByText(await ev.t("threads.missing.title", undefined, p), { exact: true }).waitFor();
      if ((await p.content()).includes(prompts.foreign)) ev.fail(`the ${who}'s page carries the other member's prompt`);
      const feed = await ev.api(`/api/generations?thread=${foreignId}`, undefined, p);
      const del = await ev.api(`/api/threads/${foreignId}`, { method: "DELETE" }, p);
      const post = await ev.api("/api/generations", { method: "POST", body: JSON.stringify({ family: "bytedance/seedance-2.0", mode: "t2v", prompt: "into someone else's thread", params: {}, images: [], videos: [], startFromImage: false, thread: foreignId }) }, p);
      for (const [route, r] of [["GET feed", feed], ["DELETE", del], ["POST", post]]) {
        if (r.status !== 404 || r.body?.error?.code !== "noSuchThread") ev.fail(`the ${who}'s ${route} of a foreign thread answered ${r.status} ${JSON.stringify(r.body)}`);
      }
      ev.note(`${who}: the foreign thread reads ${await ev.t("threads.missing.title", undefined, p)}, and GET feed, DELETE and POST answer 404 noSuchThread`);
      if (who === "member") await review("missing-thread", p);
    }
    const [{ deleted_at: foreignDeleted }] = await sql`select deleted_at from threads where id = ${foreignId}`;
    if (foreignDeleted !== null) ev.fail("the foreign thread was deleted by someone else's request");

    if (sideways.length) ev.fail(`horizontal overflow: ${sideways.join(", ")}`);
    ev.note(`no surface scrolls sideways (${viewport})`);
  } finally {
    const ids = [memberA, memberB];
    await sql`delete from generations where user_id in (select id from users where username in ${sql(ids)} and username like 'vgs-thr-%')`;
    const gone = await sql`delete from users where username in ${sql(ids)} and username like 'vgs-thr-%' returning id`;
    ev.note(`cleanup: deleted ${gone.length} members with their rows and threads`);
    await sql.end();
  }
}
