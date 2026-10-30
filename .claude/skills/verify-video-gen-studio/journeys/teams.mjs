import { createRequire } from "node:module";
import { join } from "node:path";

const INITIAL = "oooooooo";

/** Feature: teams — the 팀 tab, the users table's team column, filter and 팀 지정, the editor's team select, a member's team in 설정. See features/teams.md. */
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
  const tab = (name) => page.getByRole("button", { name, exact: true });
  const tableRows = () => page.locator("tbody tr");

  const createTeam = async (name) => {
    await page.getByRole("button", { name: "팀 만들기", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "팀 만들기" });
    await dialog.waitFor({ timeout: 10_000 });
    const field = dialog.getByLabel(/^팀 이름/);
    if (!(await field.evaluate((el) => el === document.activeElement))) ev.fail("opening 팀 만들기 should focus 팀 이름");
    await field.fill(name);
    await dialog.getByRole("button", { name: "만들기", exact: true }).click();
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
    await p.getByRole("heading", { level: 1, name: "설정" }).waitFor({ timeout: 30_000 });
    passwords[id] = chosen;
  };
  const shownTeam = async (p) => {
    const account = p.getByRole("region", { name: "계정" });
    return (await account.locator("dl > div").filter({ has: p.locator("dt", { hasText: /^팀$/ }) }).locator("dd").innerText()).trim();
  };

  try {
    await ev.login("/admin");
    if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail(`${creds.username} is not an admin: run with VGS_USER/VGS_PASS of an admin account`);
    for (const username of [memberA, memberB]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password: INITIAL }) });
      if (made.status !== 201) ev.fail(`creating ${username} answered ${made.status}: ${made.body?.error}`);
    }
    ev.note(`members ${memberA} and ${memberB} created through the admin API`);

    await tab("팀").click();
    let dialog = await createTeam(alpha);
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, `팀을 만들었습니다: ${alpha}`).waitFor({ timeout: 10_000 });
    dialog = await createTeam(beta);
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await page.getByRole("button", { name: `${beta} 편집`, exact: true }).waitFor({ timeout: 10_000 });
    await ev.shot("teams-created");

    dialog = await createTeam(alpha.toUpperCase());
    await dialog.getByRole("alert").filter({ hasText: "이미 있는 팀 이름입니다" }).waitFor({ timeout: 10_000 });
    await ev.shot("team-duplicate");
    await dialog.getByLabel(/^팀 이름/).fill("팀".repeat(31));
    await dialog.getByRole("button", { name: "만들기", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "팀 이름은 30자까지입니다 (지금 31자)" }).waitFor({ timeout: 10_000 });
    await dialog.getByLabel(/^팀 이름/).fill("");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    if ((await teamList()).some((t) => t.name.toLowerCase() === alpha.toLowerCase() && t.name !== alpha)) ev.fail("a name differing only in case was stored");
    ev.note(`adm-teams: created ${alpha} and ${beta}; ${alpha.toUpperCase()} answered 이미 있는 팀 이름입니다 and 31 characters answered the 30-character limit`);

    await page.getByRole("button", { name: `${alpha} 편집`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: `${alpha} 편집` });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel(/^팀 이름/).fill(`  ${red} `);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    dialog = page.getByRole("dialog", { name: `${red} 편집` });
    await dialog.waitFor({ timeout: 10_000 });
    const redTeam = await teamNamed(red);
    const betaTeam = await teamNamed(beta);
    if (!redTeam || (await teamNamed(alpha))) ev.fail(`renaming ${alpha} to ${red} did not persist trimmed`);
    await ev.shot("team-renamed");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-teams: ${alpha} renamed to ${red} (typed with spaces, stored trimmed), team ${redTeam.id}`);

    await tab("사용자 · API 키").click();
    const checkA = page.getByRole("checkbox", { name: `${memberA} 선택`, exact: true });
    const checkB = page.getByRole("checkbox", { name: `${memberB} 선택`, exact: true });
    await checkA.waitFor({ timeout: 15_000 });
    if (!(await page.getByRole("columnheader", { name: "팀", exact: true }).isVisible())) ev.fail("the users table should have a 팀 column");
    const before = await users();
    await checkA.check();
    await checkB.check();
    await page.getByText("2명 선택", { exact: true }).waitFor({ timeout: 5_000 });
    if (await page.getByRole("dialog").count()) ev.fail("a checkbox click should not open the member editor");
    await page.getByRole("button", { name: "팀 지정", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "팀 지정" });
    await dialog.waitFor({ timeout: 10_000 });
    const listed = (await dialog.getByRole("region", { name: "고른 사용자" }).getByRole("listitem").allInnerTexts()).map((t) => t.split("\n")[0].trim()).sort();
    if (JSON.stringify(listed) !== JSON.stringify([memberA, memberB].sort())) ev.fail(`팀 지정 must list exactly this run's two members before it changes anything, it lists ${JSON.stringify(listed)}`);
    const submit = dialog.getByRole("button", { name: "2명 지정", exact: true });
    if (await submit.isEnabled()) ev.fail("2명 지정 should wait until a team is chosen");
    await dialog.getByLabel(/^팀/).selectOption({ label: red });
    await until(async () => (await submit.isEnabled()) && (await submit.evaluate((el) => getComputedStyle(el).opacity)) === "1", "2명 지정 should turn on once a team is chosen");
    await ev.shot("bulk-dialog");
    await submit.click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, `2명을 ${red}에 지정했습니다`).waitFor({ timeout: 10_000 });
    const after = await users();
    const moved = after.filter((u) => u.teamId === redTeam.id).map((u) => u.username).sort();
    if (JSON.stringify(moved) !== JSON.stringify([memberA, memberB].sort())) ev.fail(`after 팀 지정 the team holds ${JSON.stringify(moved)}`);
    const others = (rows) => JSON.stringify(rows.filter((u) => !u.username.startsWith(prefix)).map((u) => [u.id, u.teamId]));
    if (others(before) !== others(after)) ev.fail("팀 지정 changed a user outside this run");
    await ev.shot("bulk-assigned");
    ev.note(`adm-teams-assign: ${memberA} and ${memberB} → ${red}; the other ${after.length - 2} users kept their team`);

    await page.getByRole("button", { name: `${memberB} 편집`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: `${memberB} 편집` });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByRole("combobox", { name: /^팀/ }).selectOption({ label: beta });
    await until(async () => (await userRow(memberB))?.teamId === betaTeam.id, `${memberB} did not move to ${beta}`);
    await until(async () => (await dialog.getByRole("combobox", { name: /^팀/ }).inputValue()) === String(betaTeam.id), "the editor's 팀 select did not show the new team");
    await ev.shot("editor-team");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    ev.note(`adm-user-team: ${memberB} moved to ${beta} from the editor`);

    const filter = page.getByRole("combobox", { name: "팀으로 거르기" });
    const shows = async (expected, what) =>
      until(async () => {
        const names = await tableRows().evaluateAll((rows) => rows.map((r) => r.querySelector("td button")?.textContent?.replace(/ 편집$/, "").trim()));
        return JSON.stringify(names) === JSON.stringify(expected);
      }, async () => `${what}: the table shows ${JSON.stringify(await tableRows().evaluateAll((rows) => rows.map((r) => r.querySelector("td button")?.textContent)))}`);
    await filter.selectOption(String(redTeam.id));
    await shows([memberA], `filter ${red}`);
    await page.getByRole("checkbox", { name: "보이는 사용자 모두 선택" }).check();
    await page.getByText("1명 선택", { exact: true }).waitFor({ timeout: 5_000 });
    if (!(await checkA.isChecked())) ev.fail("보이는 사용자 모두 선택 should check the visible row");
    await ev.shot("filter-team");
    await page.getByRole("checkbox", { name: "보이는 사용자 모두 선택" }).uncheck();
    await page.getByText("0명 선택", { exact: true }).waitFor({ timeout: 5_000 });
    await filter.selectOption(String(betaTeam.id));
    await shows([memberB], `filter ${beta}`);
    await filter.selectOption("none");
    await until(async () => (await checkA.count()) + (await checkB.count()) === 0, "미소속 should hide members who are in a team");
    await filter.selectOption("");
    ev.note(`adm-teams-filter: ${red} shows only ${memberA}, ${beta} only ${memberB}, 미소속 neither; 보이는 사용자 모두 선택 picked the one visible row`);

    await tab("팀").click();
    await page.getByRole("button", { name: `${beta} 편집`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: `${beta} 편집` });
    await dialog.waitFor({ timeout: 10_000 });
    if (!(await dialog.getByRole("region", { name: "팀원" }).getByText(memberB).isVisible())) ev.fail(`${beta} 편집 should list ${memberB} as a member`);
    await dialog.getByRole("button", { name: "팀 삭제", exact: true }).click();
    const confirm = dialog.getByRole("group", { name: "팀 삭제" });
    const warning = await confirm.innerText();
    if (!warning.includes("팀원 1명은 미소속이 되고")) ev.fail(`the delete confirm should say its 1 member becomes 미소속, it says "${warning}"`);
    await ev.shot("delete-confirm");
    await confirm.getByRole("button", { name: "삭제", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await status(page, `팀을 삭제했습니다: ${beta}. 팀원 1명이 미소속이 됐습니다`).waitFor({ timeout: 10_000 });
    if (await teamNamed(beta)) ev.fail(`${beta} is still listed after 삭제`);
    if ((await userRow(memberB))?.teamId !== null) ev.fail(`${memberB} should be 미소속 after ${beta} was deleted`);
    if ((await userRow(memberA))?.teamId !== redTeam.id) ev.fail(`deleting ${beta} should leave ${memberA} in ${red}`);
    await ev.shot("team-deleted");
    await tab("사용자 · API 키").click();
    const rowB = tableRows().filter({ has: checkB });
    await rowB.getByText("미소속", { exact: true }).waitFor({ timeout: 10_000 });
    await ev.shot("member-unassigned");
    ev.note(`adm-teams-delete: deleting ${beta} made ${memberB} 미소속 and kept ${memberA} in ${red}`);

    const pageA = await ev.newPage();
    await signInFirstTime(pageA, memberA);
    if ((await shownTeam(pageA)) !== red) ev.fail(`${memberA}'s 설정 should show ${red}, it shows "${await shownTeam(pageA)}"`);
    await ev.shot("member-settings-team", { page: pageA });
    const listAsMember = await ev.api("/api/admin/teams", undefined, pageA);
    const bulkAsMember = await ev.api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userIds: [(await userRow(memberA)).id], teamId: null }) }, pageA);
    if (listAsMember.status !== 403 || bulkAsMember.status !== 403) ev.fail(`a member reached admin team routes: GET /api/admin/teams ${listAsMember.status}, PATCH /api/admin/users ${bulkAsMember.status}`);
    if ((await userRow(memberA))?.teamId !== redTeam.id) ev.fail(`${memberA}'s own PATCH changed their team`);
    const pageB = await ev.newPage();
    await signInFirstTime(pageB, memberB);
    if ((await shownTeam(pageB)) !== "미소속") ev.fail(`${memberB}'s 설정 should show 미소속, it shows "${await shownTeam(pageB)}"`);
    await ev.shot("member-settings-unassigned", { page: pageB });
    ev.note(`settings-team: ${memberA} reads ${red}, ${memberB} reads 미소속; as a member GET /api/admin/teams and PATCH /api/admin/users answered 403`);
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
