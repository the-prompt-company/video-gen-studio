import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INITIAL = "oooooooo";
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The column headers an admin types in a sheet. Messages quote them as typed, in every language. */
const HEADERS = { nickname: "nickname", email: "email", nicknameAlias: "닉네임", emailAlias: "이메일" };

/** Feature: member import from .xlsx in admin, plus nickname and the reset to the initial password. See features/import.md. */
export default async function importJourney({ page, ev, base, webDir, local }) {
  const stamp = randomBytes(3).toString("hex");
  const prefix = `vgs-imp-${stamp}-`;
  const { writeImportFixtures, importEmail } = await import(pathToFileURL(join(webDir, "scripts", "import-fixtures.mjs")).href);
  const files = await writeImportFixtures(join(ev.dir, "fixtures"), stamp);
  const email = (n) => importEmail(stamp, n);
  ev.note(`fixtures for stamp ${stamp}: ${Object.keys(files).join(", ")}`);

  const appErrors = [];
  const watchErrors = (p) => {
    p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && appErrors.push(m.text()));
    p.on("pageerror", (e) => appErrors.push(String(e)));
  };
  watchErrors(page);
  const users = async () => (await ev.api("/api/admin/users")).body?.items ?? [];
  const member = async (username) => (await users()).find((u) => u.username === username);
  const signIn = async (p, id, pw) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(pw);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };

  try {
    await ev.login("/admin");
    if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail("run with an admin's VGS_USER/VGS_PASS");

    const title = await ev.t("import.title");
    const opener = page.getByRole("button", { name: title, exact: true });
    const importer = page.getByRole("dialog", { name: title });
    const results = importer.getByRole("list", { name: await ev.t("import.rows") });
    const sheetRow = new RegExp(literal(await ev.t("import.row", { row: "\u0001" })).replace("\u0001", "(\\d+)"));
    const temporary = await ev.t("members.temporary");
    const openImport = async () => {
      await opener.click();
      await importer.waitFor({ timeout: 10_000 });
    };
    const closeImport = async () => {
      await importer.getByRole("button", { name: await ev.t("common.close") }).click();
      await importer.waitFor({ state: "hidden", timeout: 5_000 });
    };
    const pick = async (name) => {
      await importer.locator('input[type="file"]').setInputFiles(files[name]);
    };
    const expectAlert = async (text, what) => {
      const alert = importer.getByRole("alert");
      try {
        await alert.filter({ hasText: text }).waitFor({ timeout: 30_000 });
      } catch {
        ev.fail(`${what}: expected the alert "${text}", got "${(await alert.allTextContents()).join(" | ")}"`);
      }
    };
    const outcomes = async () => {
      await results.waitFor({ timeout: 30_000 });
      const byRow = {};
      for (const text of await results.getByRole("listitem").allTextContents()) {
        const row = sheetRow.exec(text)?.[1];
        if (row) byRow[row] = text;
      }
      return byRow;
    };
    const expectOutcome = async (byRow, row, outcome, detail) => {
      const text = byRow[row];
      const label = await ev.t(`import.outcome.${outcome}`);
      const found = !detail || (typeof detail === "string" ? text?.includes(detail) : detail.test(text));
      if (!text || !text.includes(label) || !found) ev.fail(`row ${row}: expected "${label}"${detail ? ` and ${detail}` : ""}, got "${text}"`);
    };
    const confirmCreate = async (count) => {
      const button = importer.getByRole("button", { name: await ev.t("import.submit", { count }), exact: true });
      await button.waitFor({ timeout: 10_000 });
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith("/api/admin/users/import") && r.request().method() === "POST", { timeout: 90_000 }),
        button.click(),
      ]);
      const timing = res.request().timing();
      await importer.getByRole("status").filter({ hasText: await ev.t("import.done", { count }) }).waitFor({ timeout: 30_000 });
      return Math.round(timing.responseEnd);
    };

    await opener.waitFor({ timeout: 15_000 });
    await openImport();
    if (!(await importer.getByRole("table", { name: await ev.t("import.example.label") }).isVisible())) ev.fail("the modal should show the expected format");
    await ev.shot("import-modal");

    await pick("missing-column.xlsx");
    await expectAlert(await ev.t("import.failure.missingColumns", { ...HEADERS, row: "1", missing: "email", found: "이름, 메일, nickname" }), "missing email column");
    await ev.shot("missing-column");

    await pick("too-many.xlsx");
    await expectAlert(await ev.t("errors.importTooMany", { max: 200, count: 201 }), "201 rows");
    await ev.shot("too-many");

    await pick("english-headers.xlsx");
    const english = await outcomes();
    for (const row of ["2", "3", "4"]) await expectOutcome(english, row, "create");
    if (await member(email(1))) ev.fail("a dry run must not create anyone");
    await ev.shot("english-preview");
    const englishMs = await confirmCreate(3);
    for (const [n, nickname] of [[1, "김민지"], [2, "Park Joon"], [3, "이서연"]]) {
      const u = await member(email(n));
      if (!u || u.nickname !== nickname || u.mustChangePassword !== true || u.role !== "user") ev.fail(`member ${email(n)} should exist as a user with nickname ${nickname} and a temporary password, got ${JSON.stringify(u)}`);
    }
    ev.note(`english-headers: 3 created in ${englishMs} ms, each a user with its nickname and mustChangePassword=true`);
    await ev.shot("english-created");
    await new Promise((r) => setTimeout(r, 1000));
    if (!(await importer.getByRole("status").filter({ hasText: await ev.t("import.done", { count: 3 }) }).isVisible())) ev.fail("the import result should stay in the modal until it is dismissed");
    await closeImport();
    if (!(await opener.evaluate((el) => el === document.activeElement))) ev.fail(`closing the import modal should return focus to "${title}"`);
    ev.note(`the result stayed in the modal a second after creating; common.close dismissed it and returned focus to "${title}"`);
    const row1 = page.getByRole("row").filter({ hasText: email(1) });
    await row1.waitFor({ timeout: 15_000 });
    if (!(await row1.getByText("김민지", { exact: true }).isVisible()) || !(await row1.getByText(temporary, { exact: true }).isVisible())) ev.fail(`the users table should show the nickname and the "${temporary}" badge`);
    await row1.scrollIntoViewIfNeeded();
    await ev.shot("users-table-badge");

    await openImport();
    const pickFirst = await ev.t("import.pick.first");
    if ((await results.count()) || !(await importer.getByText(pickFirst, { exact: true }).isVisible())) ev.fail(`reopening the import modal should start from "${pickFirst}", not the dismissed result`);
    await pick("mixed.xlsx");
    const mixed = await outcomes();
    await expectOutcome(mixed, "4", "create", new RegExp(email(4)));
    await expectOutcome(mixed, "6", "create");
    await expectOutcome(mixed, "7", "duplicate", await ev.t("import.detail.duplicate", { row: "4" }));
    await expectOutcome(mixed, "8", "exists");
    await expectOutcome(mixed, "9", "invalid", await ev.t("errors.emailInvalid"));
    await expectOutcome(mixed, "10", "invalid", await ev.t("errors.nameBlank", { kind: "nickname" }));
    await expectOutcome(mixed, "11", "invalid", await ev.t("errors.nameTooLong", { kind: "nickname", max: 30, length: 31 }));
    await expectOutcome(mixed, "12", "invalid", await ev.t("errors.nameControl", { kind: "nickname" }));
    if (Object.keys(mixed).length !== 8) ev.fail(`mixed.xlsx should preview 8 rows (blank rows skipped), got ${Object.keys(mixed).join(",")}`);
    ev.note("mixed.xlsx preview: rows 4,6 create; 7 duplicate of 4; 8 exists; 9-12 invalid with their reasons; blank rows 5 and 13 skipped");
    await ev.shot("mixed-preview");
    await confirmCreate(2);
    const upper = await member(email(4));
    const spaced = await member(email(5));
    if (upper?.nickname !== "최유나" || spaced?.nickname !== "한지호") ev.fail(`trimmed, lowercased members expected, got ${JSON.stringify([upper, spaced])}`);
    for (const n of [6, 7, 8]) if (await member(email(n))) ev.fail(`invalid row ${email(n)} must not be created`);
    ev.note("mixed.xlsx: created the uppercase email as lowercase with a trimmed nickname, and nothing for invalid rows");
    await ev.shot("mixed-created");

    await pick("korean-headers.xlsx");
    const korean = await outcomes();
    await expectOutcome(korean, "2", "create", /정하늘/);
    await expectOutcome(korean, "3", "create", /오세훈/);
    await confirmCreate(2);
    ev.note("korean-headers: 2 created");

    await pick("two-hundred.xlsx");
    const full = await outcomes();
    if (Object.keys(full).length !== 200) ev.fail(`two-hundred.xlsx should preview 200 rows, got ${Object.keys(full).length}`);
    const create200 = await ev.t("import.submit", { count: 200 });
    const fit = await importer.evaluate((d, create200) => {
      const body = d.querySelector("footer")?.previousElementSibling;
      const box = d.getBoundingClientRect();
      const button = [...d.querySelectorAll("footer button")].find((b) => b.textContent === create200)?.getBoundingClientRect();
      return {
        scrollsInside: body ? body.scrollHeight > body.clientHeight : false,
        noSideways: d.scrollWidth <= d.clientWidth && (body ? body.scrollWidth <= body.clientWidth : false),
        inView: box.top >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
        buttonInView: Boolean(button && button.top >= 0 && button.bottom <= window.innerHeight),
        width: Math.round(box.width),
        pageScroll: Math.round(window.scrollY),
      };
    }, create200);
    if (!fit.scrollsInside || !fit.noSideways || !fit.inView || !fit.buttonInView) ev.fail(`the 200-row preview should scroll inside a modal that fits the viewport with "${create200}" in view: ${JSON.stringify(fit)}`);
    ev.note(`two-hundred.xlsx preview: the modal (${fit.width}px wide) fits the viewport, its body scrolls inside with no sideways overflow, and "${create200}" stays in view`);
    await ev.shot("two-hundred-preview");
    const fullMs = await confirmCreate(200);
    ev.note(`two-hundred.xlsx: 200 created in one request, ${fullMs} ms from request start to response end`);
    await ev.shot("two-hundred-created");
    await closeImport();

    const memberPage = await ev.newPage();
    watchErrors(memberPage);
    await signIn(memberPage, email(4).toUpperCase(), INITIAL);
    await memberPage.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, memberPage) }).waitFor({ timeout: 20_000 });
    ev.note(`imported member ${email(4)} signing in with ${INITIAL} gets the forced change`);
    await ev.shot("member-forced-change", { page: memberPage });
    const chosen = `chosen-${stamp}-pw`;
    await memberPage.getByLabel(await ev.t("auth.newPassword", undefined, memberPage)).first().fill(chosen);
    await memberPage.getByLabel(await ev.t("auth.confirmPassword", undefined, memberPage)).fill(chosen);
    await memberPage.getByRole("button", { name: await ev.t("auth.changePassword", undefined, memberPage), exact: true }).click();
    await memberPage.waitForURL("**/playground", { timeout: 30_000 });
    if ((await member(email(4)))?.mustChangePassword !== false) ev.fail("mustChangePassword should clear after the member's change");
    await ev.shot("member-signed-in", { page: memberPage });

    await page.reload({ waitUntil: "networkidle" });
    const row4 = page.getByRole("row").filter({ hasText: email(4) });
    await row4.waitFor({ timeout: 15_000 });
    if (await row4.getByText(temporary, { exact: true }).isVisible()) ev.fail("the badge should be gone after the member chose a password");
    await new Promise((r) => setTimeout(r, 1100));
    await row4.click();
    const edit = page.getByRole("dialog", { name: await ev.t("members.edit", { username: email(4) }) });
    await edit.waitFor({ timeout: 10_000 });

    const nickname = edit.getByLabel(new RegExp(`^${literal(await ev.t("members.field.nickname"))}`));
    const saveNickname = edit.getByRole("button", { name: await ev.t("common.save"), exact: true }).first();
    await nickname.fill("가".repeat(31));
    await saveNickname.click();
    await page.getByText(await ev.t("errors.nameTooLong", { kind: "nickname", max: 30, length: 31 })).waitFor({ timeout: 10_000 });
    await nickname.fill(`  새 이름 ${stamp} `);
    await saveNickname.click();
    await row4.getByText(`새 이름 ${stamp}`, { exact: true }).waitFor({ timeout: 10_000 });
    if ((await member(email(4)))?.nickname !== `새 이름 ${stamp}`) ev.fail("the nickname edit should persist trimmed");
    ev.note("admin nickname edit: 31 characters refused, a padded name saved trimmed");
    await ev.shot("nickname-edited");

    const resetTitle = await ev.t("members.reset.title");
    await edit.getByRole("button", { name: resetTitle }).click();
    const confirmBox = edit.getByRole("group", { name: resetTitle });
    await confirmBox.waitFor({ timeout: 5_000 });
    if (!(await confirmBox.innerText()).includes(INITIAL)) ev.fail(`the reset confirmation should name the initial password ${INITIAL}, it says "${await confirmBox.innerText()}"`);
    await ev.shot("reset-confirm");
    await confirmBox.getByRole("button", { name: await ev.t("members.reset.confirm"), exact: true }).click();
    await edit.getByText(await ev.t("members.editor.temporaryNote")).waitFor({ timeout: 15_000 });
    await row4.getByText(temporary, { exact: true }).waitFor({ timeout: 10_000 });
    if ((await member(email(4)))?.mustChangePassword !== true) ev.fail("the reset must set mustChangePassword");
    await ev.shot("reset-done");

    await memberPage.goto(`${base}/playground`, { waitUntil: "networkidle" });
    if (!new URL(memberPage.url()).pathname.startsWith("/login")) ev.fail(`the member's session should end at the reset, /playground went to ${memberPage.url()}`);
    await signIn(memberPage, email(4), chosen);
    await memberPage.getByRole("alert").filter({ hasText: await ev.t("errors.wrongCredentials", undefined, memberPage) }).waitFor({ timeout: 20_000 });
    await signIn(memberPage, email(4), INITIAL);
    await memberPage.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, memberPage) }).waitFor({ timeout: 20_000 });
    ev.note(`after "${resetTitle}" the member was signed out, the chosen password stopped working, and ${INITIAL} asks for a new one`);
    await ev.shot("reset-forces-change", { page: memberPage });
    if (appErrors.length) ev.fail(`browser errors other than HTTP statuses: ${appErrors.join(" | ").slice(0, 500)}`);
  } finally {
    const postgres = createRequire(join(webDir, "package.json"))("postgres");
    const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
    try {
      const gone = await sql`delete from users where username like ${`${prefix}%`} and username like 'vgs-imp-%' returning id`;
      ev.note(`cleanup: deleted ${gone.length} member row(s) with prefix ${prefix}`);
    } finally {
      await sql.end();
    }
  }
}
