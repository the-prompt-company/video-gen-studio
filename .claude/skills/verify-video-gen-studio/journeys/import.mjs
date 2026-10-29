import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INITIAL = "oooooooo";

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
  const card = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "엑셀로 회원 만들기" }) });
  const results = card.getByRole("list", { name: "행별 결과" });

  const users = async () => (await ev.api("/api/admin/users")).body?.items ?? [];
  const member = async (username) => (await users()).find((u) => u.username === username);
  const pick = async (name) => {
    await card.locator('input[type="file"]').setInputFiles(files[name]);
  };
  const expectAlert = async (pattern, what) => {
    const alert = card.getByRole("alert");
    try {
      await alert.filter({ hasText: pattern }).waitFor({ timeout: 30_000 });
    } catch {
      ev.fail(`${what}: expected an alert matching ${pattern}, got "${(await alert.allTextContents()).join(" | ")}"`);
    }
  };
  const outcomes = async () => {
    await results.waitFor({ timeout: 30_000 });
    const byRow = {};
    for (const text of await results.getByRole("listitem").allTextContents()) {
      const row = /(\d+)행/.exec(text)?.[1];
      if (row) byRow[row] = text;
    }
    return byRow;
  };
  const expectOutcome = (byRow, row, label, detail) => {
    const text = byRow[row];
    if (!text || !text.includes(label) || (detail && !detail.test(text))) ev.fail(`row ${row}: expected "${label}"${detail ? ` and ${detail}` : ""}, got "${text}"`);
  };
  const confirmCreate = async (count) => {
    const button = card.getByRole("button", { name: `${count}명 만들기` });
    await button.waitFor({ timeout: 10_000 });
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/admin/users/import") && r.request().method() === "POST", { timeout: 90_000 }),
      button.click(),
    ]);
    const timing = res.request().timing();
    await card.getByRole("status").filter({ hasText: `${count}명을 만들었습니다` }).waitFor({ timeout: 30_000 });
    return Math.round(timing.responseEnd);
  };
  const signIn = async (p, id, pw) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel("비밀번호").fill(pw);
    await p.getByRole("button", { name: "로그인", exact: true }).click();
  };

  try {
    await ev.login("/admin");
    if (!(await page.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail("run with an admin's VGS_USER/VGS_PASS");
    await card.waitFor({ timeout: 15_000 });
    if (!(await card.getByRole("table", { name: "엑셀 형식 예시" }).isVisible())) ev.fail("the card should show the expected format");
    await card.scrollIntoViewIfNeeded();
    await ev.shot("import-card");

    await pick("missing-column.xlsx");
    await expectAlert(/email\(또는 이메일\) 열이 없습니다.*찾은 제목: 이름, 메일, nickname/, "missing email column");
    await ev.shot("missing-column");

    await pick("too-many.xlsx");
    await expectAlert(/200명까지.*201명/, "201 rows");
    await ev.shot("too-many");

    await pick("english-headers.xlsx");
    const english = await outcomes();
    for (const row of ["2", "3", "4"]) expectOutcome(english, row, "만들 예정");
    if (await member(email(1))) ev.fail("a dry run must not create anyone");
    await ev.shot("english-preview");
    const englishMs = await confirmCreate(3);
    for (const [n, nickname] of [[1, "김민지"], [2, "Park Joon"], [3, "이서연"]]) {
      const u = await member(email(n));
      if (!u || u.nickname !== nickname || u.mustChangePassword !== true || u.role !== "user") ev.fail(`member ${email(n)} should exist as a user with nickname ${nickname} and a temporary password, got ${JSON.stringify(u)}`);
    }
    ev.note(`english-headers: 3 created in ${englishMs} ms, each a user with its nickname and mustChangePassword=true`);
    await ev.shot("english-created");
    const row1 = page.getByRole("row").filter({ hasText: email(1) });
    await row1.waitFor({ timeout: 15_000 });
    if (!(await row1.getByText("김민지", { exact: true }).isVisible()) || !(await row1.getByText("임시 비밀번호", { exact: true }).isVisible())) ev.fail("the users table should show the nickname and the 임시 비밀번호 badge");
    await row1.scrollIntoViewIfNeeded();
    await ev.shot("users-table-badge");

    await card.scrollIntoViewIfNeeded();
    await pick("mixed.xlsx");
    const mixed = await outcomes();
    expectOutcome(mixed, "4", "만들 예정", new RegExp(email(4)));
    expectOutcome(mixed, "6", "만들 예정");
    expectOutcome(mixed, "7", "파일 안 중복", /4행과 이메일이 같습니다/);
    expectOutcome(mixed, "8", "이미 있음");
    expectOutcome(mixed, "9", "확인 필요", /이메일 형식/);
    expectOutcome(mixed, "10", "확인 필요", /닉네임이 비어/);
    expectOutcome(mixed, "11", "확인 필요", /30자/);
    expectOutcome(mixed, "12", "확인 필요", /제어 문자/);
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
    expectOutcome(korean, "2", "만들 예정", /정하늘/);
    expectOutcome(korean, "3", "만들 예정", /오세훈/);
    await confirmCreate(2);
    ev.note("korean-headers: 2 created");

    await pick("two-hundred.xlsx");
    const full = await outcomes();
    if (Object.keys(full).length !== 200) ev.fail(`two-hundred.xlsx should preview 200 rows, got ${Object.keys(full).length}`);
    const fullMs = await confirmCreate(200);
    ev.note(`two-hundred.xlsx: 200 created in one request, ${fullMs} ms from request start to response end`);
    await ev.shot("two-hundred-created");

    const memberPage = await ev.newPage();
    watchErrors(memberPage);
    await signIn(memberPage, email(4).toUpperCase(), INITIAL);
    await memberPage.getByRole("heading", { level: 1, name: "새 비밀번호 정하기" }).waitFor({ timeout: 20_000 });
    ev.note(`imported member ${email(4)} signing in with ${INITIAL} gets the forced change`);
    await ev.shot("member-forced-change", { page: memberPage });
    const chosen = `chosen-${stamp}-pw`;
    await memberPage.getByLabel(/^새 비밀번호(?! 확인)/).fill(chosen);
    await memberPage.getByLabel("새 비밀번호 확인").fill(chosen);
    await memberPage.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
    await memberPage.waitForURL("**/playground", { timeout: 30_000 });
    if ((await member(email(4)))?.mustChangePassword !== false) ev.fail("mustChangePassword should clear after the member's change");
    await ev.shot("member-signed-in", { page: memberPage });

    await page.reload({ waitUntil: "networkidle" });
    const row4 = page.getByRole("row").filter({ hasText: email(4) });
    await row4.waitFor({ timeout: 15_000 });
    if (await row4.getByText("임시 비밀번호", { exact: true }).isVisible()) ev.fail("the badge should be gone after the member chose a password");
    await new Promise((r) => setTimeout(r, 1100));
    await row4.click();
    const edit = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: `${email(4)} 편집` }) });
    await edit.waitFor({ timeout: 10_000 });

    const nickname = edit.getByLabel(/^닉네임/);
    await nickname.fill("가".repeat(31));
    await edit.getByRole("button", { name: "저장" }).first().click();
    await page.getByText(/닉네임은 30자까지입니다/).waitFor({ timeout: 10_000 });
    await nickname.fill(`  새 이름 ${stamp} `);
    await edit.getByRole("button", { name: "저장" }).first().click();
    await row4.getByText(`새 이름 ${stamp}`, { exact: true }).waitFor({ timeout: 10_000 });
    if ((await member(email(4)))?.nickname !== `새 이름 ${stamp}`) ev.fail("the nickname edit should persist trimmed");
    ev.note("admin nickname edit: 31 characters refused, a padded name saved trimmed");
    await ev.shot("nickname-edited");

    await edit.getByRole("button", { name: "초기 비밀번호로 되돌리기" }).click();
    const confirmBox = edit.getByRole("group", { name: "초기 비밀번호로 되돌리기" });
    await confirmBox.waitFor({ timeout: 5_000 });
    await ev.shot("reset-confirm");
    await confirmBox.getByRole("button", { name: "되돌리기", exact: true }).click();
    await edit.getByText("임시 비밀번호 상태입니다").waitFor({ timeout: 15_000 });
    await row4.getByText("임시 비밀번호", { exact: true }).waitFor({ timeout: 10_000 });
    if ((await member(email(4)))?.mustChangePassword !== true) ev.fail("the reset must set mustChangePassword");
    await ev.shot("reset-done");

    await memberPage.goto(`${base}/playground`, { waitUntil: "networkidle" });
    if (!new URL(memberPage.url()).pathname.startsWith("/login")) ev.fail(`the member's session should end at the reset, /playground went to ${memberPage.url()}`);
    await signIn(memberPage, email(4), chosen);
    await memberPage.getByRole("alert").filter({ hasText: /맞지 않습니다/ }).waitFor({ timeout: 20_000 });
    await signIn(memberPage, email(4), INITIAL);
    await memberPage.getByRole("heading", { level: 1, name: "새 비밀번호 정하기" }).waitFor({ timeout: 20_000 });
    ev.note("after 초기 비밀번호로 되돌리기 the member was signed out, the chosen password stopped working, and oooooooo asks for a new one");
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
