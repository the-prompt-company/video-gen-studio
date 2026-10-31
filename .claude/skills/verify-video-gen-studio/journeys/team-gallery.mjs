import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Feature: team gallery — 내 것 / 팀 / 전체 for a member, 내 것 / 전체 for an admin, refusals on other members' rows. See features/gallery.md. */
export default async function teamGallery({ page, ev, base, env, webDir, local }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, teams and generation rows, so .env.local must point at a local database");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "team-2");
  mkdirSync(reviewDir, { recursive: true });

  const stamp = Date.now().toString(36);
  const prefix = `vgs-tg-${stamp}-`;
  const login = { a1: `${prefix}a1@example.test`, a2: `${prefix}a2@example.test`, b1: `${prefix}b1@example.test`, solo: `${prefix}solo@example.test` };
  const teamName = { A: `${prefix}A`, B: `${prefix}B` };
  const nickname = { a2: `민지 ${stamp}`, b1: `Bora ${stamp}` };
  const prompt = (who, n) => `TG ${who} ${n} ${stamp}`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });

  const userId = {};
  const teamId = {};
  const rows = {};

  const review = async (surface, p) => {
    await ev.shot(surface, { page: p });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`) });
  };
  const fitsWidth = async (p, what) => {
    const { scroll, inner } = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    if (scroll !== inner) ev.fail(`${what}: scrollWidth ${scroll} differs from innerWidth ${inner}`);
  };
  const tilePrompts = async (p) => {
    const [before, after] = (await ev.t("gallery.openDetail", { prompt: "<<prompt>>" }, p)).split("<<prompt>>");
    const names = await p.getByRole("button", { name: new RegExp(`^${literal(before)}[\\s\\S]*${literal(after)}$`) }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    return names.map((n) => n.slice(before.length, n.length - after.length)).filter((n) => n.endsWith(stamp)).sort();
  };
  const expectPrompts = async (p, want, what) => {
    const got = await tilePrompts(p);
    const expected = [...want].sort();
    if (JSON.stringify(got) !== JSON.stringify(expected)) ev.fail(`${what}: expected tiles ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    ev.note(`${what}: exactly ${got.length} tile(s) of this run, as expected`);
  };
  const noLoginEmails = async (p, who, what) => {
    const html = await p.content();
    for (const w of who) if (html.includes(login[w])) ev.fail(`${what}: the page carries ${w}'s login ID`);
  };
  const filterLink = async (p, filter) =>
    p.getByRole("navigation", { name: await ev.t("gallery.scope.label", undefined, p), exact: true }).locator(`a[href="${filter === "mine" ? "/gallery" : `/gallery?scope=${filter}`}"]`);
  const choose = async (p, filter) => {
    await (await filterLink(p, filter)).click();
    await p.waitForURL(`**/gallery?scope=${filter}`);
    await p.waitForLoadState("networkidle");
    if ((await (await filterLink(p, filter)).getAttribute("aria-current")) !== "page") ev.fail(`the ${filter} link is not marked aria-current="page" after choosing it`);
  };
  const offered = async (p) => {
    const nav = p.getByRole("navigation", { name: await ev.t("gallery.scope.label", undefined, p), exact: true });
    if (!(await nav.count())) return [];
    const links = await nav.getByRole("link").evaluateAll((els) => els.map((el) => ({ href: el.getAttribute("href"), text: el.textContent.trim() })));
    const out = [];
    for (const { href, text } of links) {
      const filter = href === "/gallery" ? "mine" : new URLSearchParams(href.split("?")[1] ?? "").get("scope");
      if (text !== (await ev.t(`gallery.scope.${filter}`, undefined, p))) ev.fail(`the ${filter} link reads "${text}"`);
      out.push(filter);
    }
    return out;
  };
  const expectOffered = async (p, want, what) => {
    const got = await offered(p);
    if (JSON.stringify(got) !== JSON.stringify(want)) ev.fail(`${what}: expected the switch to offer ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const signIn = async (who) => {
    const p = await ev.newPage();
    await p.goto(`${base}/login?next=${encodeURIComponent("/gallery")}`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(login[who]);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(INITIAL);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
    await p.waitForURL("**/gallery", { timeout: 30_000 });
    await p.waitForLoadState("networkidle");
    return p;
  };
  const skipFirstPasswordChange = () => sql`update users set must_change_password = false where username like ${`${prefix}%`}`;
  const insertRow = (who, n, status) => sql`
    insert into generations (user_id, model_id, prompt, params, status, result_url, duration_s, cost_usd, created_at, completed_at, expires_at)
    values (${userId[who]}, 'minimax/hailuo-2.3/standard/image-to-video', ${prompt(who, n)}, ${sql.json({ duration: 6 })}, ${status},
      ${status === "completed" ? "/mock/result-landscape.webm" : null}, 6, '0.0100', now() - ${`${n} minutes`}::interval,
      ${status === "completed" ? sql`now()` : null}, now() + interval '7 days')
    returning id`.then(([r]) => r.id);

  try {
    await ev.login("/gallery");
    if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail("precondition: run as an admin (VGS_USER/VGS_PASS)");

    for (const who of Object.keys(login)) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: login[who], password: INITIAL }) });
      if (made.status !== 201) ev.fail(`creating ${who} answered ${made.status}: ${JSON.stringify(made.body?.error)}`);
    }
    const all = (await ev.api("/api/admin/users")).body.items;
    for (const who of Object.keys(login)) userId[who] = all.find((u) => u.username === login[who]).id;
    for (const t of ["A", "B"]) {
      const made = await ev.api("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: teamName[t] }) });
      if (made.status !== 201) ev.fail(`creating team ${t} answered ${made.status}`);
      teamId[t] = made.body.id;
    }
    const assign = async (who, team) => {
      const r = await ev.api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userIds: who.map((w) => userId[w]), teamId: team && teamId[team] }) });
      if (r.status !== 200) ev.fail(`assigning ${who.join(", ")} to ${team} answered ${r.status}`);
    };
    await assign(["a1", "a2"], "A");
    await assign(["b1"], "B");
    for (const who of Object.keys(nickname)) {
      const r = await ev.api(`/api/admin/users/${userId[who]}`, { method: "PATCH", body: JSON.stringify({ nickname: nickname[who] }) });
      if (r.status !== 200) ev.fail(`nickname for ${who} answered ${r.status}`);
    }
    await skipFirstPasswordChange();
    rows.a1 = [await insertRow("a1", 1, "completed"), await insertRow("a1", 2, "completed")];
    rows.a2 = [await insertRow("a2", 1, "completed"), await insertRow("a2", 2, "completed")];
    rows.a2live = await insertRow("a2", 3, "queued");
    rows.a2failed = await insertRow("a2", 4, "failed");
    rows.b1 = [await insertRow("b1", 1, "completed"), await insertRow("b1", 2, "completed")];
    rows.solo = [await insertRow("solo", 1, "completed")];
    ev.note(`fixtures: team A = a1, a2 (nickname), team B = b1, solo has no team; 7 completed rows, a2 also has a queued and a failed row`);

    const done = { a1: [prompt("a1", 1), prompt("a1", 2)], a2: [prompt("a2", 1), prompt("a2", 2)], b1: [prompt("b1", 1), prompt("b1", 2)], solo: [prompt("solo", 1)] };

    const a1 = await signIn("a1");
    await expectPrompts(a1, done.a1, "a1 under mine (the default)");
    await expectOffered(a1, ["mine", "team", "all"], "a1, a member of team A");
    await fitsWidth(a1, "a1 mine");
    await review("gallery-mine", a1);
    await choose(a1, "team");
    await expectPrompts(a1, done.a2, "a1 under team");
    const teammateTile = a1.getByRole("listitem").filter({ hasText: prompt("a2", 1) });
    if (!(await teammateTile.getByText(nickname.a2, { exact: true }).isVisible())) ev.fail("a teammate's tile does not show the teammate's nickname");
    await fitsWidth(a1, "a1 team");
    await review("gallery-team", a1);
    await choose(a1, "all");
    await expectPrompts(a1, [...done.a1, ...done.a2], "a1 under all");
    await fitsWidth(a1, "a1 all");
    await review("gallery-all", a1);
    await noLoginEmails(a1, ["a2", "b1", "solo"], "a1's gallery");

    await choose(a1, "team");
    await a1.getByRole("button", { name: await ev.t("gallery.openDetail", { prompt: prompt("a2", 1) }, a1), exact: true }).click();
    const dialog = a1.getByRole("dialog", { name: await ev.t("gallery.detail.title", undefined, a1), exact: true });
    await dialog.waitFor({ timeout: 5_000 });
    const video = dialog.getByLabel(await ev.t("generation.video", undefined, a1), { exact: true });
    await video.evaluate((v) => new Promise((res, rej) => { if (v.readyState >= 1) return res(); v.onloadedmetadata = res; v.onerror = () => rej(new Error("video failed to load")); setTimeout(() => rej(new Error("video metadata timeout")), 15_000); }));
    if (!(await dialog.getByText(nickname.a2, { exact: true }).isVisible())) ev.fail("the teammate's detail does not name the teammate");
    const href = await dialog.getByRole("link", { name: await ev.t("generation.download", undefined, a1), exact: true }).getAttribute("href");
    const fetched = await a1.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, type: r.headers.get("content-type") }; }, href);
    if (fetched.status !== 200 || !/^video\//.test(fetched.type ?? "")) ev.fail(`the teammate's download answered ${fetched.status} ${fetched.type}`);
    ev.note(`teammate detail: video loaded, download ${href} answered ${fetched.status} ${fetched.type}`);
    await fitsWidth(a1, "teammate detail");
    await review("teammate-detail", a1);
    await a1.keyboard.press("Escape");

    const read = await ev.api(`/api/generations/${rows.a2[0]}`, undefined, a1);
    if (read.status !== 200 || read.body?.item?.id !== rows.a2[0]) ev.fail(`GET a teammate's row answered ${read.status}`);
    if (JSON.stringify(read.body).includes(login.a2)) ev.fail("GET a teammate's row carries the teammate's login ID");
    const hiddenLive = await ev.api(`/api/generations/${rows.a2live}`, undefined, a1);
    if (hiddenLive.status !== 404) ev.fail(`GET a teammate's queued row answered ${hiddenLive.status}; a teammate reads finished rows only`);
    const cancelDone = await ev.api(`/api/generations/${rows.a2[0]}`, { method: "DELETE" }, a1);
    if (cancelDone.status !== 403 || cancelDone.body?.error?.code !== "notYourGeneration") ev.fail(`DELETE a teammate's finished row answered ${cancelDone.status} ${JSON.stringify(cancelDone.body?.error)}`);
    const cancelLive = await ev.api(`/api/generations/${rows.a2live}`, { method: "DELETE" }, a1);
    if (cancelLive.status !== 404 || cancelLive.body?.error?.code !== "noSuchGeneration") ev.fail(`DELETE a teammate's queued row answered ${cancelLive.status} ${JSON.stringify(cancelLive.body?.error)}`);
    const after = await sql`select id, status from generations where id in ${sql([rows.a2[0], rows.a2live])}`;
    const statusOf = Object.fromEntries(after.map((r) => [r.id, r.status]));
    if (statusOf[rows.a2[0]] !== "completed" || statusOf[rows.a2live] !== "queued") ev.fail(`the teammate's rows changed: ${JSON.stringify(statusOf)}`);
    for (const id of [rows.b1[0], rows.solo[0]]) {
      const crafted = await ev.api(`/api/generations/${id}`, undefined, a1);
      if (crafted.status !== 404) ev.fail(`GET another team's row answered ${crafted.status}`);
      const crafteDelete = await ev.api(`/api/generations/${id}`, { method: "DELETE" }, a1);
      if (crafteDelete.status !== 404) ev.fail(`DELETE another team's row answered ${crafteDelete.status}`);
    }
    const poll = await ev.api(`/api/generations?ids=${rows.a2live},${rows.b1[0]}`, undefined, a1);
    if (poll.status !== 200 || poll.body.items.length !== 0) ev.fail(`the poll answered ${poll.status} with ${poll.body?.items?.length} row(s) of other members`);
    await a1.goto(`${base}/gallery?scope=everyone`, { waitUntil: "networkidle" });
    await expectPrompts(a1, done.a1, "a1 asking for everyone gets mine");
    await a1.goto(`${base}/gallery?scope=team&teamId=${teamId.B}`, { waitUntil: "networkidle" });
    await expectPrompts(a1, done.a2, "a1 asking for team B's id still gets team A");
    ev.note("refusals: a teammate's finished row GET 200 and DELETE 403, a teammate's queued row GET and DELETE 404, both rows unchanged; another team's and a teamless member's rows GET and DELETE 404; poll 0 rows; crafted scopes fall back to mine");

    const a2 = await signIn("a2");
    await choose(a2, "team");
    await expectPrompts(a2, done.a1, "a2 under team");
    if (!(await a2.getByRole("listitem").filter({ hasText: prompt("a1", 1) }).getByText(await ev.t("gallery.owner.teammate", undefined, a2), { exact: true }).isVisible())) ev.fail("a teammate without a nickname is not shown as gallery.owner.teammate");
    await noLoginEmails(a2, ["a1", "b1", "solo"], "a2's gallery");

    const b1 = await signIn("b1");
    await choose(b1, "team");
    await expectPrompts(b1, [], "b1 under team");
    if (!(await b1.getByText(await ev.t("gallery.emptyTeam", undefined, b1), { exact: true }).isVisible())) ev.fail("an empty team view does not show gallery.emptyTeam");
    await choose(b1, "all");
    await expectPrompts(b1, done.b1, "b1 under all");

    const solo = await signIn("solo");
    await expectPrompts(solo, done.solo, "solo under mine");
    await expectOffered(solo, [], "solo, a member without a team");
    if (!(await solo.getByText(await ev.t("gallery.scope.noTeam", undefined, solo), { exact: true }).isVisible())) ev.fail("a member without a team does not see gallery.scope.noTeam");
    await fitsWidth(solo, "solo");
    await review("gallery-teamless", solo);
    await solo.goto(`${base}/gallery?scope=all`, { waitUntil: "networkidle" });
    await expectPrompts(solo, done.solo, "solo asking for all gets mine");

    await page.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    await expectOffered(page, ["mine", "everyone"], "the admin");
    await (await filterLink(page, "everyone")).click();
    await page.waitForURL("**/gallery?scope=everyone");
    await page.waitForLoadState("networkidle");
    await expectPrompts(page, [...done.a1, ...done.a2, ...done.b1, ...done.solo], "admin under everyone");
    if (!(await page.getByRole("listitem").filter({ hasText: prompt("b1", 1) }).getByText(login.b1, { exact: true }).isVisible())) ev.fail("the admin's everyone view no longer shows the member's ID");
    await fitsWidth(page, "admin everyone");
    await review("admin-everyone", page);

    await assign(["a2"], "B");
    await a1.reload({ waitUntil: "networkidle" });
    await choose(a1, "team");
    await expectPrompts(a1, [], "a1 under team after a2 moved to B");
    await b1.reload({ waitUntil: "networkidle" });
    await choose(b1, "team");
    await expectPrompts(b1, done.a2, "b1 under team after a2 moved to B");
    const moved = await ev.api(`/api/generations/${rows.a2[0]}`, undefined, a1);
    if (moved.status !== 404) ev.fail(`after the move, a1's GET of a2's row answered ${moved.status}`);
    ev.note("team change: a2's rows left team A's view and joined team B's at once");
  } finally {
    try {
      await sql`delete from generations where user_id in (select id from users where username like ${`${prefix}%`})`;
      const gone = await sql`delete from users where username like ${`${prefix}%`} and username like 'vgs-tg-%' returning id`;
      const dropped = await sql`delete from teams where name like ${`${prefix}%`} and name like 'vgs-tg-%' returning id`;
      const [left] = await sql`select (select count(*) from users where username like ${`${prefix}%`})::int as users, (select count(*) from teams where name like ${`${prefix}%`})::int as teams`;
      ev.note(`cleanup: deleted ${gone.length} member(s) and ${dropped.length} team(s); ${left.users} member(s) and ${left.teams} team(s) left`);
      if (left.users || left.teams) ev.fail(`cleanup left ${left.users} member(s) and ${left.teams} team(s) under ${prefix}`);
    } finally {
      await sql.end();
    }
  }
}
