import { createRequire } from "node:module";
import { join } from "node:path";

const INITIAL = "oooooooo";
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Feature: teams — the teams tab, the users table's team column, filter and team assignment, the editor's team select, a member's team in settings. See features/teams.md. */
export default async function teams({ page, ev, base, creds, webDir, local }) {
  const stamp = Date.now().toString(36);
  const prefix = `vgs-team-${stamp}-`;
  const memberA = `${prefix}a@example.test`;
  const memberB = `${prefix}b@example.test`;
  const red = `${prefix}red`;
  const alpha = `${prefix}alpha`;
  const beta = `${prefix}beta`;
  const passwords = { [memberA]: INITIAL, [memberB]: INITIAL };
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  // One connection, one query at a time: the transaction pooler cannot answer pipelined queries.
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });

  const until = async (check, what, timeout = 15_000) => {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) ev.fail(typeof what === "function" ? await what() : what);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const users = async () => {
    const r = await ev.api("/api/admin/users");
    if (r.status !== 200) ev.fail(`/api/admin/users answered ${r.status}`);
    return r.body.items;
  };
  const userRow = async (username) => (await users()).find((u) => u.username === username);
  const teamList = async () => {
    const r = await ev.api("/api/admin/teams");
    if (r.status !== 200) ev.fail(`/api/admin/teams answered ${r.status}`);
    return r.body.items;
  };
  const teamNamed = async (name) => (await teamList()).find((t) => t.name === name);
  const status = (p, text) => p.getByRole("status").filter({ hasText: text });
  /** A field's label, which its hint follows in the accessible name. */
  const label = async (key, p = page) => new RegExp(`^${literal(await ev.t(key, undefined, p))}`);
  const openTab = async (tab) => page.getByRole("button", { name: await ev.t(`admin.tabs.${tab}`), exact: true }).click();
  const button = async (key, values) => page.getByRole("button", { name: await ev.t(key, values), exact: true });
  const tableRows = () => page.locator("tbody tr");

  const createTeam = async (name) => {
    await (await button("teams.create.title")).click();
    const dialog = page.getByRole("dialog", { name: await ev.t("teams.create.title") });
    await dialog.waitFor({ timeout: 10_000 });
    const field = dialog.getByLabel(await label("teams.name.label"));
    if (!(await field.evaluate((el) => el === document.activeElement))) ev.fail("opening teams.create.title should focus teams.name.label");
    await field.fill(name);
    await dialog.getByRole("button", { name: await ev.t("teams.create.submit"), exact: true }).click();
    return dialog;
  };

  const signInFirstTime = async (p, id) => {
    await p.goto(`${base}/login?next=${encodeURIComponent("/settings")}`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(passwords[id]);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
    await p.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, p) }).waitFor({ timeout: 20_000 });
    const chosen = `team-${stamp}-${id === memberA ? "a" : "b"}-1`;
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(chosen);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(chosen);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
    await p.waitForURL("**/settings", { timeout: 30_000 });
    await p.getByRole("heading", { level: 1, name: await ev.t("pages.settings", undefined, p) }).waitFor({ timeout: 30_000 });
    passwords[id] = chosen;
  };
  const shownTeam = async (p) => {
    const account = p.getByRole("region", { name: await ev.t("settings.account.title", undefined, p) });
    const term = new RegExp(`^${literal(await ev.t("settings.account.team", undefined, p))}$`);
    return (await account.locator("dl > div").filter({ has: p.locator("dt", { hasText: term }) }).locator("dd").innerText()).trim();
  };

  try {
    await ev.login("/admin");
    if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail(`${creds.username} is not an admin: run with VGS_USER/VGS_PASS of an admin account`);
    for (const username of [memberA, memberB]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password: INITIAL }) });
      if (made.status !== 201) ev.fail(`creating ${username} answered ${made.status}: ${JSON.stringify(made.body?.error)}`);
    }
    ev.note(`members ${memberA} and ${memberB} created through the admin API`);
    const noTeam = await ev.t("teams.none");

    await openTab("teams");
    let dialog = await createTeam(alpha);
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, await ev.t("teams.notice.created", { name: alpha })).waitFor({ timeout: 10_000 });
    dialog = await createTeam(beta);
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await (await button("teams.edit", { name: beta })).waitFor({ timeout: 10_000 });
    await ev.shot("teams-created");

    dialog = await createTeam(alpha.toUpperCase());
    await dialog.getByRole("alert").filter({ hasText: await ev.t("errors.duplicateTeamName") }).waitFor({ timeout: 10_000 });
    await ev.shot("team-duplicate");
    await dialog.getByLabel(await label("teams.name.label")).fill("팀".repeat(31));
    await dialog.getByRole("button", { name: await ev.t("teams.create.submit"), exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: await ev.t("errors.nameTooLong", { kind: "teamName", max: 30, length: 31 }) }).waitFor({ timeout: 10_000 });
    await dialog.getByLabel(await label("teams.name.label")).fill("");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    if ((await teamList()).some((t) => t.name.toLowerCase() === alpha.toLowerCase() && t.name !== alpha)) ev.fail("a name differing only in case was stored");
    ev.note(`adm-teams: created ${alpha} and ${beta}; ${alpha.toUpperCase()} answered duplicateTeamName and 31 characters answered nameTooLong`);

    await (await button("teams.edit", { name: alpha })).click();
    dialog = page.getByRole("dialog", { name: await ev.t("teams.edit", { name: alpha }) });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel(await label("teams.name.label")).fill(`  ${red} `);
    await dialog.getByRole("button", { name: await ev.t("common.save"), exact: true }).click();
    dialog = page.getByRole("dialog", { name: await ev.t("teams.edit", { name: red }) });
    await dialog.waitFor({ timeout: 10_000 });
    const redTeam = await teamNamed(red);
    const betaTeam = await teamNamed(beta);
    if (!redTeam || (await teamNamed(alpha))) ev.fail(`renaming ${alpha} to ${red} did not persist trimmed`);
    await ev.shot("team-renamed");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-teams: ${alpha} renamed to ${red} (typed with spaces, stored trimmed), team ${redTeam.id}`);

    await openTab("users");
    const checkA = page.getByRole("checkbox", { name: await ev.t("members.select", { username: memberA }), exact: true });
    const checkB = page.getByRole("checkbox", { name: await ev.t("members.select", { username: memberB }), exact: true });
    const selected = async (count) => page.getByText(await ev.t("members.selected", { count }), { exact: true });
    await checkA.waitFor({ timeout: 15_000 });
    if (!(await page.getByRole("columnheader", { name: await ev.t("members.field.team"), exact: true }).isVisible())) ev.fail("the users table should have a members.field.team column");
    const before = await users();
    await checkA.check();
    await checkB.check();
    await (await selected(2)).waitFor({ timeout: 5_000 });
    if (await page.getByRole("dialog").count()) ev.fail("a checkbox click should not open the member editor");
    await (await button("members.assign.title")).click();
    dialog = page.getByRole("dialog", { name: await ev.t("members.assign.title") });
    await dialog.waitFor({ timeout: 10_000 });
    const listed = (await dialog.getByRole("region", { name: await ev.t("members.assign.chosenLabel") }).getByRole("listitem").allInnerTexts()).map((t) => t.split("\n")[0].trim()).sort();
    if (JSON.stringify(listed) !== JSON.stringify([memberA, memberB].sort())) ev.fail(`members.assign.title must list exactly this run's two members before it changes anything, it lists ${JSON.stringify(listed)}`);
    const submitName = await ev.t("members.assign.submit", { count: 2 });
    const submit = dialog.getByRole("button", { name: submitName, exact: true });
    if (await submit.isEnabled()) ev.fail(`"${submitName}" should wait until a team is chosen`);
    await dialog.getByLabel(await label("members.field.team")).selectOption({ label: red });
    await until(async () => (await submit.isEnabled()) && (await submit.evaluate((el) => getComputedStyle(el).opacity)) === "1", `"${submitName}" should turn on once a team is chosen`);
    await ev.shot("bulk-dialog");
    await submit.click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, await ev.t("members.notice.assigned", { count: 2, team: red })).waitFor({ timeout: 10_000 });
    const after = await users();
    const moved = after.filter((u) => u.teamId === redTeam.id).map((u) => u.username).sort();
    if (JSON.stringify(moved) !== JSON.stringify([memberA, memberB].sort())) ev.fail(`after the assignment the team holds ${JSON.stringify(moved)}`);
    const others = (rows) => JSON.stringify(rows.filter((u) => !u.username.startsWith(prefix)).map((u) => [u.id, u.teamId]));
    if (others(before) !== others(after)) ev.fail("the assignment changed a user outside this run");
    await ev.shot("bulk-assigned");
    ev.note(`adm-teams-assign: ${memberA} and ${memberB} → ${red}; the other ${after.length - 2} users kept their team`);

    await (await button("members.edit", { username: memberB })).click();
    dialog = page.getByRole("dialog", { name: await ev.t("members.edit", { username: memberB }) });
    await dialog.waitFor({ timeout: 10_000 });
    const teamSelect = dialog.getByRole("combobox", { name: await label("members.field.team") });
    await teamSelect.selectOption({ label: beta });
    await until(async () => (await userRow(memberB))?.teamId === betaTeam.id, `${memberB} did not move to ${beta}`);
    await until(async () => (await teamSelect.inputValue()) === String(betaTeam.id), "the editor's team select did not show the new team");
    await ev.shot("editor-team");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-user-team: ${memberB} moved to ${beta} from the editor`);

    const filter = page.getByRole("combobox", { name: await ev.t("members.filter.label") });
    const shows = async (expected, what) =>
      until(async () => {
        const names = await tableRows().evaluateAll((rows) => rows.map((r) => r.querySelector("td button")?.textContent?.trim()));
        return JSON.stringify(names) === JSON.stringify(expected);
      }, async () => `${what}: the table shows ${JSON.stringify(await tableRows().evaluateAll((rows) => rows.map((r) => r.querySelector("td button")?.textContent)))}`);
    const selectAll = page.getByRole("checkbox", { name: await ev.t("members.selectAll") });
    await filter.selectOption(String(redTeam.id));
    await shows([memberA], `filter ${red}`);
    await selectAll.check();
    await (await selected(1)).waitFor({ timeout: 5_000 });
    if (!(await checkA.isChecked())) ev.fail("members.selectAll should check the visible row");
    await ev.shot("filter-team");
    await selectAll.uncheck();
    await (await selected(0)).waitFor({ timeout: 5_000 });
    await filter.selectOption(String(betaTeam.id));
    await shows([memberB], `filter ${beta}`);
    await filter.selectOption("none");
    await until(async () => (await checkA.count()) + (await checkB.count()) === 0, "the no-team filter should hide members who are in a team");
    await filter.selectOption("");
    ev.note(`adm-teams-filter: ${red} shows only ${memberA}, ${beta} only ${memberB}, "${noTeam}" neither; members.selectAll picked the one visible row`);

    await openTab("teams");
    await (await button("teams.edit", { name: beta })).click();
    dialog = page.getByRole("dialog", { name: await ev.t("teams.edit", { name: beta }) });
    await dialog.waitFor({ timeout: 10_000 });
    if (!(await dialog.getByRole("region", { name: await ev.t("teams.members.label") }).getByText(memberB).isVisible())) ev.fail(`${beta}'s editor should list ${memberB} as a member`);
    await dialog.getByRole("button", { name: await ev.t("teams.delete.title"), exact: true }).click();
    const confirm = dialog.getByRole("group", { name: await ev.t("teams.delete.title") });
    const warning = await confirm.innerText();
    const wantWarning = await ev.t("teams.delete.confirm", { count: 1 });
    if (!warning.includes(wantWarning)) ev.fail(`the delete confirm should say "${wantWarning}", it says "${warning}"`);
    await ev.shot("delete-confirm");
    await confirm.getByRole("button", { name: await ev.t("teams.delete.submit"), exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, await ev.t("teams.notice.deleted", { name: beta, released: 1 })).waitFor({ timeout: 10_000 });
    if (await teamNamed(beta)) ev.fail(`${beta} is still listed after the delete`);
    if ((await userRow(memberB))?.teamId !== null) ev.fail(`${memberB} should have no team after ${beta} was deleted`);
    if ((await userRow(memberA))?.teamId !== redTeam.id) ev.fail(`deleting ${beta} should leave ${memberA} in ${red}`);
    await ev.shot("team-deleted");
    await openTab("users");
    const rowB = tableRows().filter({ has: checkB });
    await rowB.getByText(noTeam, { exact: true }).waitFor({ timeout: 10_000 });
    await ev.shot("member-unassigned");
    ev.note(`adm-teams-delete: deleting ${beta} made ${memberB} "${noTeam}" and kept ${memberA} in ${red}`);

    const pageA = await ev.newPage();
    await signInFirstTime(pageA, memberA);
    if ((await shownTeam(pageA)) !== red) ev.fail(`${memberA}'s settings should show ${red}, it shows "${await shownTeam(pageA)}"`);
    await ev.shot("member-settings-team", { page: pageA });
    const listAsMember = await ev.api("/api/admin/teams", undefined, pageA);
    const bulkAsMember = await ev.api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userIds: [(await userRow(memberA)).id], teamId: null }) }, pageA);
    if (listAsMember.status !== 403 || bulkAsMember.status !== 403) ev.fail(`a member reached admin team routes: GET /api/admin/teams ${listAsMember.status}, PATCH /api/admin/users ${bulkAsMember.status}`);
    if ((await userRow(memberA))?.teamId !== redTeam.id) ev.fail(`${memberA}'s own PATCH changed their team`);
    const pageB = await ev.newPage();
    await signInFirstTime(pageB, memberB);
    const noTeamB = await ev.t("teams.none", undefined, pageB);
    if ((await shownTeam(pageB)) !== noTeamB) ev.fail(`${memberB}'s settings should show "${noTeamB}", it shows "${await shownTeam(pageB)}"`);
    await ev.shot("member-settings-unassigned", { page: pageB });
    ev.note(`settings-team: ${memberA} reads ${red}, ${memberB} reads "${noTeamB}"; as a member GET /api/admin/teams and PATCH /api/admin/users answered 403`);
  } finally {
    try {
      const gone = await sql`delete from users where username like ${`${prefix}%`} and username like 'vgs-team-%' returning id`;
      const dropped = await sql`delete from teams where btrim(name) ilike ${`${prefix}%`} and btrim(name) ilike 'vgs-team-%' returning id`;
      const [left] = await sql`select (select count(*) from users where username like ${`${prefix}%`})::int as users, (select count(*) from teams where name ilike ${`%${prefix}%`})::int as teams`;
      ev.note(`cleanup: deleted ${gone.length} member row(s) and ${dropped.length} team row(s); ${left.users} member(s) and ${left.teams} team(s) of this run left`);
      if (left.users || left.teams) ev.fail(`cleanup left ${left.users} member(s) and ${left.teams} team(s) under ${prefix}`);
    } finally {
      await sql.end();
    }
  }
}
