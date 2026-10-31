/**
 * Feature: screens-admin — 설정 and the admin's members, teams, member import, model rates and logs in the browser's
 * language. Saves each surface to .impeccable/review/i18n-4/<surface>-<lang>-<viewport>.png, finds every element by
 * message key, keeps Korean nicknames and team names as typed, and at every surface checks that the page does not
 * scroll sideways. Creates and deletes two vgs-loc-i18n4-* members, their rows and two teams, and round-trips the
 * Seedance rate, so it runs on a local database only. See features/screens-admin.md.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const SEEDANCE = "bytedance/seedance-2.0";
const NICKNAME = "검증용 닉네임";

/** The three model cards: the unit line's basis and unit, and the published figures each card offers as a fill button. */
const FAMILIES = [
  { id: SEEDANCE, name: "Seedance 2.0", key: "seedance", unit: "second", published: [{ preset: "higgsfieldTable", discount: 30, usd: 0.0985 }, { preset: "list", usd: 0.1406 }] },
  { id: "minimax/h3", name: "MiniMax H3", key: "h3", unit: "second", published: [{ preset: "higgsfieldTable", discount: 50, usd: 0.065 }, { preset: "list", usd: 0.13 }] },
  { id: "openai/gpt-image-2", name: "GPT Image 2", key: "gptImage2", unit: "mTokens", published: [{ preset: "openaiList", usd: 30 }] },
];

/** mixed.xlsx (scripts/import-fixtures.mjs) as the dry run must judge it for a fresh stamp: sheet row → badge and detail. */
const MIXED = {
  4: ["create", "import.detail.nickname", { nickname: "최유나" }],
  6: ["create", "import.detail.nickname", { nickname: "한지호" }],
  7: ["duplicate", "import.detail.duplicate", { row: "4" }],
  8: ["create", "import.detail.nickname", { nickname: "이미 있음" }],
  9: ["invalid", "errors.emailInvalid", undefined],
  10: ["invalid", "errors.nameBlank", { kind: "nickname" }],
  11: ["invalid", "errors.nameTooLong", { kind: "nickname", max: 30, length: 31 }],
  12: ["invalid", "errors.nameControl", { kind: "nickname" }],
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startsWith = (s) => new RegExp(`^${escape(s)}`);

export default async function screensAdmin({ page, ev, base, env, webDir, local, creds }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes users, teams, rows and a model rate, so .env.local must point at a local database");
  if (!env.VGS_FAKE_HF) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; the profile photo is stored in its Blob store");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "i18n-4");
  mkdirSync(reviewDir, { recursive: true });
  const saved = [];
  const sideways = [];
  const review = async (surface, p, focus, opts = {}) => {
    if (focus) await focus.scrollIntoViewIfNeeded();
    // next dev's corner badge covers the bottom of the page in review images; it is not part of the app.
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await ev.shot(surface, { page: p, fullPage: opts.fullPage });
    const file = join(reviewDir, `${surface}-${lang}-${viewport}.png`);
    await p.screenshot({ path: file, fullPage: Boolean(opts.fullPage) });
    saved.push(file);
    const [scroll, inner] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (scroll !== inner) sideways.push(`${surface} ${scroll}>${inner}`);
  };
  const shows = async (locator, what) => {
    try {
      await locator.first().waitFor({ timeout: 30_000 });
    } catch {
      ev.fail(`${what} never showed`);
    }
  };
  // Journeys running at the same time share this database and add and remove members, teams and rows, so a count the
  // page read can be one change behind the API. Reopen the view until one read of each agrees.
  const agree = async (what, onPage, fromApi, reopen) => {
    let got = "";
    let want = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await reopen();
      got = await onPage();
      want = await fromApi();
      if (got === want) return got;
    }
    ev.fail(`${what}: the page reads "${got}", the API gives "${want}"`);
  };

  const stamp = Date.now().toString(36);
  const [memberA, memberB] = ["a", "b"].map((x) => `vgs-loc-i18n4-${stamp}-${x}@example.test`);
  const team = `검증팀 ${stamp}`;
  const scratchTeam = `검증 임시팀 ${stamp}`;
  const renamedTeam = `검증 새이름팀 ${stamp}`;
  const donePrompt = `[목업] i18n4 ${stamp} 노을 진 바닷가를 걷는 강아지`;
  const failedPrompt = `[목업] i18n4 ${stamp} 마감을 넘긴 요청`;
  const fixtureDir = mkdtempSync(join(tmpdir(), "vgs-i18n4-"));
  const { writeImportFixtures } = await import(pathToFileURL(join(webDir, "scripts", "import-fixtures.mjs")).href);
  const fixtures = await writeImportFixtures(fixtureDir, stamp);
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const [{ locale: adminLocale }] = await sql`select locale from users where username = ${creds.username}`;
  const [{ price: seedancePrice }] = await sql`select price_per_sec_usd as price from models where model_id = ${SEEDANCE}`;
  let seedanceSet = null;
  let a = null;

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
  const apiUsers = async () => (await ev.api("/api/admin/users")).body?.items ?? [];
  const apiTeams = async () => (await ev.api("/api/admin/teams")).body?.items ?? [];
  const importedNobody = async (what) => {
    const made = (await apiUsers()).filter((u) => u.username.startsWith(`vgs-imp-${stamp}-`));
    if (made.length) ev.fail(`${what} created ${made.map((u) => u.username).join(", ")}`);
  };

  try {
    await ev.login("/admin", page);
    for (const id of [memberA, memberB]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL, apiKey: "" }) });
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    const madeTeam = await ev.api("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: team }) });
    if (madeTeam.status !== 201) ev.fail(`creating the team ${team} answered ${madeTeam.status}: ${JSON.stringify(madeTeam.body)}`);
    const [{ id: aId }] = await sql`select id from users where username = ${memberA}`;
    await sql`
      insert into generations (user_id, model_id, prompt, params, status, result_url, duration_s, cost_usd, error_code, error_params, created_at, completed_at, expires_at)
      values
        (${aId}, ${`${SEEDANCE}/text-to-video`}, ${donePrompt}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })}, 'completed',
          '/mock/result-landscape.webm', 5, 0.5, ${null}, ${null}, now() - interval '3 minutes', now() - interval '2 minutes', now() + interval '6 days'),
        (${aId}, ${`${SEEDANCE}/text-to-video`}, ${failedPrompt}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })}, 'failed',
          ${null}, 5, 0, 'submitDeadline', ${sql.json({ minutes: 30 })}, now() - interval '1 minute', now() - interval '1 minute', ${null})`;
    ev.note(`created ${memberA}, ${memberB}, team ${team}, and for ${memberA} a completed row and a failed submitDeadline row (30 minutes)`);

    a = await ev.newPage();
    const b = await ev.newPage();
    await firstSignIn(a, memberA);
    await firstSignIn(b, memberB);
    const ta = (key, values) => ev.t(key, values, a);
    const tb = (key, values) => ev.t(key, values, b);
    const t = (key, values) => ev.t(key, values, page);

    await b.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await b.getByRole("heading", { level: 1, name: await tb("pages.settings") }).waitFor();
    for (const key of ["settings.profile.title", "settings.account.title", "language.label", "settings.password.title"]) {
      if (!(await b.getByRole("region", { name: await tb(key) }).isVisible())) ev.fail(`설정 has no region "${await tb(key)}"`);
    }
    const account = b.getByRole("region", { name: await tb("settings.account.title") });
    const valueOf = async (term) => (await account.locator("dt").filter({ hasText: new RegExp(`^${escape(term)}$`) }).locator("xpath=following-sibling::dd[1]").innerText()).trim();
    if ((await valueOf("ID")) !== memberB) ev.fail(`설정's ID reads "${await valueOf("ID")}"`);
    const noTeam = await valueOf(await tb("settings.account.team"));
    if (noTeam !== (await tb("teams.none"))) ev.fail(`B's team reads "${noTeam}", want "${await tb("teams.none")}"`);
    ev.note(`settings: ${await tb("settings.account.team")} = ${noTeam}`);
    await review("settings", b, undefined, { fullPage: true });

    await a.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const profile = a.getByRole("region", { name: await ta("settings.profile.title") });
    if (await profile.getByRole("status").filter({ hasText: await ta("profile.photo.storageOff") }).count()) ev.fail("precondition: the photo store is off; point BLOB_* in .env.local at the fake");
    const pickPhoto = async (button, file) => {
      const [chooser] = await Promise.all([a.waitForEvent("filechooser"), profile.getByRole("button", { name: await ta(button), exact: true }).click()]);
      await chooser.setFiles(file);
    };
    await pickPhoto("profile.photo.choose", join(webDir, "public", "mock", "ref-square.jpg"));
    await profile.getByRole("img", { name: await ta("profile.avatar.preview") }).waitFor({ timeout: 30_000 });
    const [put] = await Promise.all([
      a.waitForResponse((r) => new URL(r.url()).pathname === "/api/me/avatar" && r.request().method() === "PUT", { timeout: 60_000 }),
      profile.getByRole("button", { name: await ta("profile.photo.save"), exact: true }).click(),
    ]);
    if (put.status() !== 200) ev.fail(`saving the photo answered ${put.status()}: ${await put.text()}`);
    await shows(profile.getByRole("status").filter({ hasText: await ta("profile.done.photoSaved") }), `status "${await ta("profile.done.photoSaved")}"`);
    const nicknameField = profile.getByLabel(startsWith(await ta("profile.nickname.label")));
    await nicknameField.fill(NICKNAME);
    await profile.getByRole("button", { name: await ta("profile.nickname.save"), exact: true }).click();
    await shows(profile.getByRole("status").filter({ hasText: await ta("profile.done.nicknameSaved") }), `status "${await ta("profile.done.nicknameSaved")}"`);
    const identity = a.getByRole("banner").getByRole("link", { name: new RegExp(` ${escape(await ta("pages.settings"))}$`) });
    await shows(identity.getByText(NICKNAME, { exact: true }), `the header link with ${NICKNAME}`);
    if (!(await identity.locator("img").count())) ev.fail("the header link shows no photo after saving one");
    const [stored] = await sql`select nickname, avatar_key from users where id = ${aId}`;
    if (stored.nickname !== NICKNAME || !stored.avatar_key) ev.fail(`users row after saving: ${JSON.stringify(stored)}`);
    ev.note(`profile-saved: ${await ta("profile.done.photoSaved")} / ${await ta("profile.done.nicknameSaved")}; users.nickname ${stored.nickname}, avatar_key ${stored.avatar_key}`);
    await review("profile-saved", a, profile);

    await nicknameField.fill("가".repeat(31));
    await profile.getByRole("button", { name: await ta("profile.nickname.save"), exact: true }).click();
    const tooLong = await ta("errors.nameTooLong", { kind: "nickname", max: 30, length: 31 });
    await shows(profile.getByRole("alert").filter({ hasText: tooLong }), `alert "${tooLong}"`);
    if ((await sql`select nickname from users where id = ${aId}`)[0].nickname !== NICKNAME) ev.fail("a refused nickname changed users.nickname");
    ev.note(`profile-errors: ${tooLong}`);
    await review("profile-errors", a, profile);

    await nicknameField.fill(NICKNAME);
    await pickPhoto("profile.photo.change", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
    await shows(profile.getByRole("alert").filter({ hasText: await ta("profile.photo.unreadable") }), `alert "${await ta("profile.photo.unreadable")}"`);
    await review("profile-photo-error", a, profile);

    await page.reload({ waitUntil: "networkidle" });
    const filter = page.getByRole("combobox", { name: await t("members.filter.label") });
    const usersCard = page.locator("section").filter({ has: filter });
    const usersHeading = usersCard.getByRole("heading", { level: 2 });
    const usersView = await agree(
      "users title and filter",
      async () => {
        await filter.waitFor({ timeout: 30_000 });
        await filter.locator("option", { hasText: team }).waitFor({ state: "attached", timeout: 30_000 });
        return [await usersHeading.innerText(), ...(await filter.locator("option").allTextContents())].map((s) => s.trim()).join(" | ");
      },
      async () => {
        const users = await apiUsers();
        const teams = await apiTeams();
        const count = (id) => users.filter((u) => u.teamId === id).length;
        const options = [await t("members.filter.all", { count: users.length }), await t("members.filter.team", { team: await t("teams.none"), count: count(null) })];
        for (const x of teams) options.push(await t("members.filter.team", { team: x.name, count: count(x.id) }));
        return [await t("members.title", { count: users.length }), ...options].join(" | ");
      },
      () => page.reload({ waitUntil: "networkidle" }),
    );
    ev.note(`users: ${usersView}`);
    await review("users", page, usersHeading);

    await page.getByRole("button", { name: await t("members.add.title"), exact: true }).click();
    const add = page.getByRole("dialog", { name: await t("members.add.title") });
    await add.waitFor({ timeout: 10_000 });
    await add.getByLabel("ID", { exact: true }).fill(memberA);
    await add.getByLabel(startsWith(await t("members.add.password"))).fill(INITIAL);
    await add.getByRole("button", { name: await t("members.add.submit"), exact: true }).click();
    await shows(add.getByRole("alert").filter({ hasText: await t("errors.duplicateUsername") }), `alert "${await t("errors.duplicateUsername")}"`);
    await review("users-add", page);
    await add.getByRole("button", { name: await t("common.close"), exact: true }).click();
    await add.waitFor({ state: "hidden" });

    for (const id of [memberA, memberB]) await page.getByRole("checkbox", { name: await t("members.select", { username: id }), exact: true }).check();
    await shows(usersCard.getByText(await t("members.selected", { count: 2 }), { exact: true }), `"${await t("members.selected", { count: 2 })}"`);
    await usersCard.getByRole("button", { name: await t("members.assign.title"), exact: true }).click();
    const assign = page.getByRole("dialog", { name: await t("members.assign.title") });
    await assign.waitFor({ timeout: 10_000 });
    const chosen = assign.getByRole("region", { name: await t("members.assign.chosenLabel") });
    if (!(await chosen.getByRole("heading", { name: await t("members.assign.chosen", { count: 2 }) }).isVisible())) ev.fail(`the assign dialog does not read "${await t("members.assign.chosen", { count: 2 })}"`);
    const listed = (await chosen.getByRole("listitem").allTextContents()).map((s) => s.trim());
    if (listed.length !== 2 || !listed.some((s) => s.startsWith(memberA)) || !listed.some((s) => s.startsWith(memberB))) ev.fail(`the assign dialog lists ${listed.join(" | ")}`);
    await assign.getByRole("combobox").selectOption({ label: team });
    const assignButton = assign.getByRole("button", { name: await t("members.assign.submit", { count: 2 }), exact: true });
    if (!(await assignButton.isEnabled())) ev.fail(`"${await t("members.assign.submit", { count: 2 })}" stays disabled with ${team} chosen`);
    await review("users-assign", page);
    await assignButton.click();
    const assigned = await t("members.notice.assigned", { count: 2, team });
    await shows(usersCard.getByRole("status").filter({ hasText: assigned }), `status "${assigned}"`);
    const onTeam = ((await apiTeams()).find((x) => x.name === team)?.members ?? []).map((m) => m.username).sort();
    if (onTeam.join(",") !== [memberA, memberB].sort().join(",")) ev.fail(`/api/admin/teams lists ${team} with ${onTeam.join(", ")}`);
    ev.note(`users-assign: "${assigned}"; /api/admin/teams lists both on ${team}`);
    await ev.shot("users-assigned");

    await page.getByRole("button", { name: await t("members.edit", { username: memberA }), exact: true }).click();
    const editor = page.getByRole("dialog", { name: await t("members.edit", { username: memberA }) });
    await editor.waitFor({ timeout: 10_000 });
    await editor.getByRole("button", { name: await t("members.reset.title"), exact: true }).click();
    const reset = editor.getByRole("group", { name: await t("members.reset.title") });
    await reset.waitFor({ timeout: 5_000 });
    const clipped = await editor.evaluate((d) =>
      [...d.querySelectorAll("button, label")].filter((el) => el.scrollWidth > el.clientWidth).map((el) => `"${el.textContent.trim()}" ${el.scrollWidth}>${el.clientWidth}`),
    );
    if (clipped.length) ev.fail(`clipped inside the editor: ${clipped.join(", ")}`);
    const cutPlaceholders = await editor.evaluate((d) => {
      const ctx = document.createElement("canvas").getContext("2d");
      return [...d.querySelectorAll("input[placeholder]")]
        .filter((el) => {
          const cs = getComputedStyle(el);
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          return ctx.measureText(el.placeholder).width > el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        })
        .map((el) => `"${el.placeholder}"`);
    });
    if (cutPlaceholders.length) ev.fail(`placeholders cut off inside the editor: ${cutPlaceholders.join(", ")}`);
    ev.note(`users-edit: no button or label in "${await t("members.edit", { username: memberA })}" is wider than its box`);
    await review("users-edit", page, reset);
    await reset.getByRole("button", { name: await t("common.cancel"), exact: true }).click();
    await editor.getByRole("button", { name: await t("common.close"), exact: true }).click();
    await editor.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: await t("import.title"), exact: true }).click();
    const importer = page.getByRole("dialog", { name: await t("import.title") });
    await importer.waitFor({ timeout: 10_000 });
    if (!(await importer.getByRole("table", { name: await t("import.example.label") }).isVisible())) ev.fail(`the import dialog has no table "${await t("import.example.label")}"`);
    await review("users-import", page);

    const pickSheet = (name) => importer.locator('input[type="file"]').setInputFiles(fixtures[name]);
    const rows = importer.getByRole("list", { name: await t("import.rows") });
    const rowItem = async (n) => rows.getByRole("listitem").filter({ has: page.getByText(await t("import.row", { row: String(n) }), { exact: true }) });
    await pickSheet("mixed.xlsx");
    await rows.waitFor({ timeout: 30_000 });
    if ((await rows.getByRole("listitem").count()) !== Object.keys(MIXED).length) ev.fail(`mixed.xlsx previews ${await rows.getByRole("listitem").count()} rows, want ${Object.keys(MIXED).length}`);
    for (const [n, [outcome, key, values]] of Object.entries(MIXED)) {
      const item = await rowItem(n);
      const text = (await item.innerText()).replace(/\s+/g, " ");
      const badge = await t(`import.outcome.${outcome}`);
      const detail = await t(key, values);
      if (!text.includes(badge) || !text.includes(detail)) ev.fail(`row ${n} reads "${text}", want "${badge}" and "${detail}"`);
    }
    const creatable = await t("import.submit", { count: 3 });
    if (!(await importer.getByRole("button", { name: creatable, exact: true }).isVisible())) ev.fail(`the preview has no "${creatable}"`);
    ev.note(`import-results: ${Object.entries(MIXED).map(([n, [o]]) => `${n} ${o}`).join(", ")}; "${creatable}"`);
    await review("import-results", page);
    await importer.getByRole("button", { name: await t("common.cancel"), exact: true }).click();
    await rows.waitFor({ state: "hidden" });
    await importedNobody("cancelling the mixed.xlsx preview");

    await pickSheet("missing-column.xlsx");
    const headers = { nickname: "nickname", email: "email", nicknameAlias: "닉네임", emailAlias: "이메일" };
    const missing = await t("import.failure.missingColumns", { ...headers, row: "1", missing: "email", found: "이름, 메일, nickname" });
    await shows(importer.getByRole("alert").filter({ hasText: missing }), `alert "${missing}"`);
    await review("import-header-error", page);
    await pickSheet("korean-headers.xlsx");
    await rows.waitFor({ timeout: 30_000 });
    for (const [n, nickname] of [[2, "정하늘"], [3, "오세훈"]]) {
      const text = (await (await rowItem(n)).innerText()).replace(/\s+/g, " ");
      const want = [await t("import.outcome.create"), await t("import.detail.nickname", { nickname })];
      if (!want.every((w) => text.includes(w))) ev.fail(`korean-headers.xlsx row ${n} reads "${text}", want ${want.join(" and ")}`);
    }
    ev.note("import-header-error: missing email column named; korean-headers.xlsx previews rows 2 and 3 to create");
    await importer.getByRole("button", { name: await t("common.cancel"), exact: true }).click();
    await importer.getByRole("button", { name: await t("common.close"), exact: true }).click();
    await importer.waitFor({ state: "hidden" });
    await importedNobody("the import dialog");

    const openTeams = async () => {
      await page.getByRole("button", { name: await t("admin.tabs.teams"), exact: true }).click();
      await page.getByRole("button", { name: await t("teams.edit", { name: team }), exact: true }).waitFor({ timeout: 30_000 });
    };
    await openTeams();
    const createTeam = page.getByRole("button", { name: await t("teams.create.title"), exact: true });
    const teamsCard = page.locator("section").filter({ has: createTeam });
    const laneRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: await t("teams.edit", { name: team }), exact: true }) });
    const teamsView = await agree(
      "teams title and size",
      async () => [await teamsCard.getByRole("heading", { level: 2 }).innerText(), (await laneRow.locator("td").nth(1).innerText()).trim()].join(" | "),
      async () => {
        const teams = await apiTeams();
        return [await t("teams.count", { count: teams.length }), await t("teams.size", { count: teams.find((x) => x.name === team)?.members.length ?? -1 })].join(" | ");
      },
      async () => {
        await page.reload({ waitUntil: "networkidle" });
        await openTeams();
      },
    );
    if (!teamsView.endsWith(await t("teams.size", { count: 2 }))) ev.fail(`${team} should have 2 members: ${teamsView}`);
    const laneMembers = await laneRow.locator("td").nth(2).innerText();
    if (!laneMembers.includes(NICKNAME) || !laneMembers.includes(memberB)) ev.fail(`${team}'s members read "${laneMembers}"`);
    ev.note(`teams: ${teamsView}; members ${laneMembers.trim()}`);
    await review("teams", page, laneRow);

    await page.getByRole("button", { name: await t("teams.edit", { name: team }), exact: true }).click();
    const teamEditor = page.getByRole("dialog", { name: await t("teams.edit", { name: team }) });
    await teamEditor.waitFor({ timeout: 10_000 });
    const roster = teamEditor.getByRole("region", { name: await t("teams.members.label") });
    if (!(await roster.getByRole("heading", { name: await t("teams.members.count", { count: 2 }) }).isVisible())) ev.fail(`the team editor does not read "${await t("teams.members.count", { count: 2 })}"`);
    if (!(await roster.innerText()).includes(NICKNAME)) ev.fail(`the team editor does not list ${NICKNAME}`);
    await teamEditor.getByRole("button", { name: await t("teams.delete.title"), exact: true }).click();
    const confirm = teamEditor.getByRole("group", { name: await t("teams.delete.title") });
    await shows(confirm.getByText(await t("teams.delete.confirm", { count: 2 }), { exact: true }), `"${await t("teams.delete.confirm", { count: 2 })}"`);
    await review("teams-edit", page, confirm);
    await confirm.getByRole("button", { name: await t("common.cancel"), exact: true }).click();
    await confirm.waitFor({ state: "hidden" });
    await teamEditor.getByRole("button", { name: await t("common.close"), exact: true }).click();
    await teamEditor.waitFor({ state: "hidden" });
    if (!(await apiTeams()).some((x) => x.name === team)) ev.fail(`cancelling the delete removed ${team}`);

    const teamsStatus = teamsCard.getByRole("status");
    await createTeam.click();
    const creator = page.getByRole("dialog", { name: await t("teams.create.title") });
    await creator.waitFor({ timeout: 10_000 });
    await creator.getByLabel(startsWith(await t("teams.name.label"))).fill(scratchTeam);
    await creator.getByRole("button", { name: await t("teams.create.submit"), exact: true }).click();
    await shows(teamsStatus.filter({ hasText: await t("teams.notice.created", { name: scratchTeam }) }), `status "${await t("teams.notice.created", { name: scratchTeam })}"`);
    if (!(await apiTeams()).some((x) => x.name === scratchTeam)) ev.fail(`/api/admin/teams has no ${scratchTeam}`);
    await ev.shot("team-created");
    await page.getByRole("button", { name: await t("teams.edit", { name: scratchTeam }), exact: true }).click();
    await page.getByRole("dialog", { name: await t("teams.edit", { name: scratchTeam }) }).getByLabel(startsWith(await t("teams.name.label"))).fill(renamedTeam);
    await page.getByRole("dialog", { name: await t("teams.edit", { name: scratchTeam }) }).getByRole("button", { name: await t("common.save"), exact: true }).click();
    const renamed = page.getByRole("dialog", { name: await t("teams.edit", { name: renamedTeam }) });
    await shows(renamed, `dialog "${await t("teams.edit", { name: renamedTeam })}"`);
    const names = (await apiTeams()).map((x) => x.name);
    if (!names.includes(renamedTeam) || names.includes(scratchTeam)) ev.fail(`after the rename /api/admin/teams lists ${names.join(", ")}`);
    await renamed.getByRole("button", { name: await t("teams.delete.title"), exact: true }).click();
    const confirmScratch = renamed.getByRole("group", { name: await t("teams.delete.title") });
    await shows(confirmScratch.getByText(await t("teams.delete.confirm", { count: 0 }), { exact: true }), `"${await t("teams.delete.confirm", { count: 0 })}"`);
    await confirmScratch.getByRole("button", { name: await t("teams.delete.submit"), exact: true }).click();
    const deleted = await t("teams.notice.deleted", { name: renamedTeam, released: 0 });
    await shows(teamsStatus.filter({ hasText: deleted }), `status "${deleted}"`);
    if ((await apiTeams()).some((x) => x.name === renamedTeam)) ev.fail(`/api/admin/teams still lists ${renamedTeam}`);
    ev.note(`teams lane: "${await t("teams.notice.created", { name: scratchTeam })}", renamed to ${renamedTeam}, "${deleted}"`);
    await ev.shot("team-deleted");

    await page.getByRole("button", { name: await t("admin.tabs.models"), exact: true }).click();
    const modelList = page.getByRole("list", { name: await t("models.list") });
    await modelList.getByRole("listitem").first().waitFor({ timeout: 30_000 });
    const presetLabel = (p) => (p.preset === "higgsfieldTable" ? t("prices.preset.higgsfieldTable", { discount: String(p.discount) }) : t(`prices.preset.${p.preset}`));
    const fillName = async (p) => t("models.fill", { label: await presetLabel(p), rate: `$${p.usd}` });
    for (const family of FAMILIES) {
      const card = modelList.getByRole("listitem", { name: family.name, exact: true });
      if (!(await card.innerText()).startsWith(`${family.name} `)) ev.fail(`the ${family.id} card starts "${(await card.innerText()).slice(0, 30)}"`);
      const unit = await t("models.unit", { basis: await t(`prices.basis.${family.key}`), per: await t("prices.per", { unit: family.unit }) });
      if (!(await card.getByText(unit, { exact: true }).isVisible())) ev.fail(`the ${family.name} card has no unit line "${unit}"`);
      for (const p of family.published) {
        if (!(await card.getByRole("button", { name: await fillName(p), exact: true }).isVisible())) ev.fail(`the ${family.name} card has no button "${await fillName(p)}"`);
      }
    }
    ev.note(`models: ${(await Promise.all(FAMILIES.map(async (f) => `${f.name} → ${await t("models.unit", { basis: await t(`prices.basis.${f.key}`), per: await t("prices.per", { unit: f.unit }) })}`))).join("; ")}`);
    await review("models", page, undefined, { fullPage: true });

    const seedance = modelList.getByRole("listitem", { name: "Seedance 2.0", exact: true });
    const rateBox = seedance.getByRole("spinbutton", { name: await t("models.rateLabel", { model: "Seedance 2.0" }) });
    const apiRate = async () => (await ev.api("/api/admin/models")).body.items.find((m) => m.modelId === SEEDANCE).pricePerSecUsd;
    const saveRate = async () => {
      await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === "/api/admin/models" && r.request().method() === "PATCH"),
        seedance.getByRole("button", { name: await t("common.save"), exact: true }).click(),
      ]);
    };
    const before = await apiRate();
    const published = FAMILIES[0].published.find((p) => p.usd !== before);
    await seedance.getByRole("button", { name: await fillName(published), exact: true }).click();
    if (Number(await rateBox.inputValue()) !== published.usd) ev.fail(`"${await fillName(published)}" put ${await rateBox.inputValue()} in the rate box`);
    seedanceSet = published.usd;
    await saveRate();
    if ((await apiRate()) !== published.usd) ev.fail(`after saving ${published.usd}, /api/admin/models reads ${await apiRate()}`);
    await rateBox.fill(String(before));
    await saveRate();
    if ((await apiRate()) !== before) ev.fail(`restoring ${before}, /api/admin/models reads ${await apiRate()}`);
    seedanceSet = null;
    ev.note(`models: "${await fillName(published)}" saved ${published.usd} (read back), then ${before} restored (read back)`);

    const openLogs = async () => {
      await page.getByRole("button", { name: await t("admin.tabs.logs"), exact: true }).click();
      await page.getByRole("row").filter({ hasText: failedPrompt }).waitFor({ timeout: 30_000 });
    };
    await openLogs();
    const logsTable = page.getByRole("table").filter({ has: page.getByRole("row").filter({ hasText: failedPrompt }) });
    const logsCard = page.locator("section").filter({ has: logsTable });
    const logsHeading = logsCard.getByRole("heading", { level: 2 });
    const logsTitle = await agree(
      "logs title",
      async () => (await logsHeading.innerText()).trim(),
      async () => t("logs.title", { count: (await ev.api("/api/admin/generations?limit=1")).body.total }),
      async () => {
        await page.reload({ waitUntil: "networkidle" });
        await openLogs();
      },
    );
    const columns = (await logsTable.getByRole("columnheader").allTextContents()).map((s) => s.trim());
    const wantColumns = await Promise.all(["time", "member", "status", "model", "prompt", "duration", "cost"].map((k) => t(`logs.field.${k}`)));
    if (columns.join("|") !== wantColumns.join("|")) ev.fail(`logs columns read ${columns.join("|")}, want ${wantColumns.join("|")}`);
    const firstOptions = await logsCard.getByRole("combobox").evaluateAll((selects) => selects.map((s) => s.options[0].textContent.trim()));
    const wantFilters = await Promise.all(["allMembers", "allModels", "allStatuses"].map((k) => t(`logs.filter.${k}`)));
    if (firstOptions.join("|") !== wantFilters.join("|")) ev.fail(`logs filters read ${firstOptions.join("|")}, want ${wantFilters.join("|")}`);
    const modelCell = `Seedance 2.0 · ${await t("mode.t2v")}`;
    const fiveSeconds = await t("logs.seconds", { seconds: "5" });
    for (const [prompt, status] of [[donePrompt, "completed"], [failedPrompt, "failed"]]) {
      const cells = (await logsTable.getByRole("row").filter({ hasText: prompt }).getByRole("cell").allInnerTexts()).map((s) => s.trim());
      const want = [memberA, await t(`status.${status}`), modelCell, prompt, fiveSeconds];
      if (cells.slice(1, 6).join(" | ") !== want.join(" | ")) ev.fail(`the ${status} row reads ${cells.join(" | ")}, want ${want.join(" | ")}`);
    }
    const box = await logsTable.evaluate((table) => {
      const parent = table.parentElement;
      return { overflow: getComputedStyle(parent).overflowX, scroll: parent.scrollWidth, client: parent.clientWidth };
    });
    if (viewport === "mobile" && !(box.overflow === "auto" && box.scroll > box.client)) ev.fail(`at 390 px the logs table should scroll inside its box: ${JSON.stringify(box)}`);
    ev.note(`logs: ${logsTitle}; columns ${columns.join(" · ")}; ${await t("status.completed")} / ${await t("status.failed")} badges; table box ${JSON.stringify(box)}`);
    await review("logs", page, logsHeading);

    await logsTable.getByRole("row").filter({ hasText: failedPrompt }).click();
    const paramsTerm = await t("logs.field.params");
    const detail = page.locator("dl").filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${escape(paramsTerm)}$`) }) });
    await detail.waitFor({ timeout: 10_000 });
    const terms = (await detail.locator("dt").allTextContents()).map((s) => s.trim());
    const wantTerms = await Promise.all(["model", "prompt", "params", "images", "videos", "cost", "error"].map((k) => t(`logs.field.${k}`)));
    if (terms.join("|") !== wantTerms.join("|")) ev.fail(`the detail labels read ${terms.join("|")}, want ${wantTerms.join("|")}`);
    const reason = (await detail.locator("dd").last().innerText()).trim();
    const wantReason = await t("errors.submitDeadline", { minutes: 30 });
    if (reason !== wantReason) ev.fail(`the failed row's reason reads "${reason}", want "${wantReason}"`);
    if (!(await detail.innerText()).includes(failedPrompt)) ev.fail("the detail does not show the Korean prompt as written");
    const costLine = (await detail.locator("dd").nth(wantTerms.indexOf(await t("logs.field.cost"))).innerText()).trim();
    if (!costLine.endsWith(`(${fiveSeconds})`)) ev.fail(`the detail's cost reads "${costLine}", want it to end "(${fiveSeconds})"`);
    const spills = await detail.evaluate((dl) => {
      const panel = dl.parentElement;
      const out = [...dl.children].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `"${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
      if (panel.getBoundingClientRect().right > window.innerWidth + 1) out.push(`panel right ${Math.round(panel.getBoundingClientRect().right)}>${window.innerWidth}`);
      for (const dt of dl.querySelectorAll("dt")) {
        const text = document.createRange();
        text.selectNodeContents(dt);
        if (text.getClientRects().length > 1) out.push(`label "${dt.textContent.trim()}" wraps`);
      }
      return out;
    });
    if (spills.length) ev.fail(`the log detail does not fit: ${spills.join(", ")}`);
    ev.note(`logs-detail: ${terms.join(" · ")}; ${reason}`);
    await review("logs-detail", page);
    await page.getByRole("button", { name: await t("common.close"), exact: true }).click();
    await detail.waitFor({ state: "hidden" });

    if (sideways.length) ev.fail(`horizontal overflow: ${sideways.join(", ")}`);
    ev.note(`no surface scrolls sideways (${viewport})`);
    const consoleFile = join(ev.dir, "console.txt");
    const bad = existsSync(consoleFile) ? readFileSync(consoleFile, "utf8").split(/\r?\n/).filter((line) => /MISSING_MESSAGE|hydrat|did not match|server rendered/i.test(line)) : [];
    if (bad.length) ev.fail(`console: ${bad.join(" | ").slice(0, 600)}`);
    ev.note("console.txt has no MISSING_MESSAGE and no hydration warning");
    const [{ locale: after }] = await sql`select locale from users where username = ${creds.username}`;
    if (after !== adminLocale) ev.fail(`the admin's users.locale moved from ${adminLocale} to ${after}`);
    ev.note(`the admin's users.locale stayed ${adminLocale}`);
    ev.note(`review images: ${saved.map((f) => f.slice(webDir.length + 1)).join(", ")}`);
  } finally {
    try {
      if (a && (await sql`select avatar_key from users where username = ${memberA}`)[0]?.avatar_key) {
        const del = await ev.api("/api/me/avatar", { method: "DELETE" }, a).catch((e) => ({ status: String(e) }));
        ev.note(`cleanup: ${memberA}'s photo DELETE → ${del.status}`);
      }
      const ids = [memberA, memberB];
      await sql`delete from generations where user_id in (select id from users where username in ${sql(ids)} and username like 'vgs-loc-%')`;
      const gone = await sql`delete from users where (username in ${sql(ids)} and username like 'vgs-loc-%') or username like ${`vgs-imp-${stamp}-%`} returning id`;
      const teamsGone = await sql`delete from teams where name in ${sql([team, scratchTeam, renamedTeam])} returning id`;
      // Only undo a rate this run left behind; another journey may have set its own rate since.
      if (seedanceSet !== null) await sql`update models set price_per_sec_usd = ${seedancePrice} where model_id = ${SEEDANCE} and price_per_sec_usd = ${seedanceSet}`;
      ev.note(`cleanup: deleted ${gone.length} member(s), their rows and ${teamsGone.length} team(s); Seedance rate ${seedanceSet === null ? "already restored in the UI" : `put back to ${seedancePrice}`}`);
    } finally {
      await sql.end();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }
}
