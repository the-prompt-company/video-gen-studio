import { createRequire } from "node:module";
import { join } from "node:path";

const INITIAL = "oooooooo";

export default async function password({ page, ev, base, creds, webDir, local }) {
  const stamp = Date.now().toString(36);
  const typedId = `VGS-PW-${stamp}@Example.TEST`;
  const storedId = typedId.toLowerCase();
  const first = `first-${stamp}-pw`;
  const second = `second-${stamp}-pw`;
  const admin = await ev.newPage();
  const other = await ev.newPage();

  const expectAlert = async (p, want, what) => {
    const alert = p.locator("form").getByRole("alert");
    try {
      await alert.filter({ hasText: want }).waitFor({ timeout: 20_000 });
    } catch {
      ev.fail(`${what}: expected the alert "${want}", got "${(await alert.allTextContents()).join(" | ")}"`);
    }
  };
  const signIn = async (p, id, pw) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(pw);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };
  const fillChange = async (p, { id, current, next, confirm = next }) => {
    if (id !== undefined) await p.getByLabel("ID").fill(id);
    if (current !== undefined) await p.getByLabel(await ev.t("auth.currentPassword", undefined, p)).fill(current);
    // The confirm label contains the new-password label in every language; the new-password field comes first.
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(next);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(confirm);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
  };
  const submitChangeForStatus = async (p, fields) => {
    const [res] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith("/api/auth/password") && r.request().method() === "POST", { timeout: 30_000 }),
      fillChange(p, fields),
    ]);
    return res.status();
  };
  const expectSignedIn = async (p, what) => {
    await p.waitForURL("**/playground", { timeout: 30_000 });
    await p.waitForLoadState("networkidle");
    if (!(await p.locator("header").getByText(storedId, { exact: true }).isVisible())) ev.fail(`${what}: header does not show ${storedId}`);
  };
  const expectSignedOut = async (p, path, what) => {
    await p.goto(`${base}${path}`, { waitUntil: "networkidle" });
    if (!new URL(p.url()).pathname.startsWith("/login")) ev.fail(`${what}: ${path} should end on /login, got ${p.url()}`);
    if (!(await p.getByRole("heading", { level: 1, name: await ev.t("auth.heading.login.title", undefined, p) }).isVisible())) ev.fail(`${what}: /login did not render its form`);
  };
  const member = async () => {
    const list = await ev.api("/api/admin/users", undefined, admin);
    const row = list.body?.items?.find((u) => u.username === storedId);
    if (!row) ev.fail(`member ${storedId} not in /api/admin/users`);
    return (await ev.api(`/api/admin/users/${row.id}`, undefined, admin)).body;
  };

  try {
    await ev.login("/admin", admin);
    if (!(await admin.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail(`${creds.username} is not an admin: run with an admin's VGS_USER/VGS_PASS`);
    const addTitle = await ev.t("members.add.title", undefined, admin);
    await admin.getByRole("button", { name: addTitle, exact: true }).click();
    const addForm = admin.getByRole("dialog", { name: addTitle });
    await addForm.getByLabel("ID", { exact: true }).fill(typedId);
    await addForm.getByLabel(await ev.t("members.add.password", undefined, admin)).fill(INITIAL);
    await addForm.getByRole("button", { name: await ev.t("members.add.submit", undefined, admin), exact: true }).click();
    await addForm.waitFor({ state: "hidden", timeout: 15_000 });
    await admin.getByRole("status").filter({ hasText: await ev.t("members.notice.added", { id: storedId }, admin) }).waitFor({ timeout: 10_000 });
    await admin.getByRole("row").filter({ hasText: storedId }).waitFor({ timeout: 15_000 });
    const fresh = await member();
    if (fresh.mustChangePassword !== true) ev.fail("a member the admin creates must have mustChangePassword");
    ev.note(`admin created ${typedId} in the "${addTitle}" modal, which closed and said so; stored as ${storedId} with mustChangePassword=true`);

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await ev.shot("login-form");
    await signIn(page, typedId, INITIAL);
    await page.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title") }).waitFor({ timeout: 20_000 });
    if ((await page.context().cookies()).some((c) => c.name === "vgs_session")) ev.fail("a temporary-password sign-in must not set a session cookie");
    if ((await page.getByLabel("ID").inputValue()) !== typedId) ev.fail("the change form should keep the ID from the sign-in");
    if (await page.getByLabel(await ev.t("auth.currentPassword")).count()) ev.fail("the forced change must not ask for the current password again");
    ev.note("temporary password: change form shown, no vgs_session cookie");
    await ev.shot("temporary");

    await fillChange(page, { next: first, confirm: first + "x" });
    await expectAlert(page, await ev.t("auth.mismatch"), "mismatched confirmation");
    await ev.shot("temporary-mismatch");
    if ((await submitChangeForStatus(page, { next: INITIAL })) !== 400) ev.fail("the initial password as the new one should be a 400");
    await expectAlert(page, await ev.t("errors.passwordIsInitial"), "initial password as the new one");
    await ev.shot("temporary-initial-refused");
    await fillChange(page, { next: first });
    await expectSignedIn(page, "forced change");
    if ((await member()).mustChangePassword !== false) ev.fail("mustChangePassword should be false after the change");
    await ev.shot("forced-change-signed-in");

    await page.getByRole("button", { name: await ev.t("nav.logout") }).click();
    await page.waitForURL("**/login", { timeout: 20_000 });
    await signIn(page, typedId, INITIAL);
    await expectAlert(page, await ev.t("errors.wrongCredentials"), "old password after the change");
    await ev.shot("old-password-refused");

    await signIn(page, typedId, first);
    await expectSignedIn(page, "mixed-case email ID");
    ev.note(`signed in with "${typedId}" as ${storedId}`);
    await ev.shot("mixed-case-id-signed-in");

    await other.goto(`${base}/login`, { waitUntil: "networkidle" });
    await other.getByRole("button", { name: await ev.t("auth.changePassword", undefined, other), exact: true }).click();
    await other.getByRole("heading", { level: 1, name: await ev.t("auth.heading.change.title", undefined, other) }).waitFor({ timeout: 10_000 });
    await ev.shot("change-form", { page: other });
    if ((await submitChangeForStatus(other, { id: typedId, current: first, next: first })) !== 400) ev.fail("the current password as the new one should be a 400");
    await expectAlert(other, await ev.t("errors.passwordUnchanged", undefined, other), "new password equal to the current one");
    await ev.shot("change-same-refused", { page: other });
    await fillChange(other, { id: typedId, current: first, next: second });
    await expectSignedIn(other, "change from the login screen");
    await other.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    if (!other.url().endsWith("/dashboard")) ev.fail(`the session the change set should stay valid, /dashboard went to ${other.url()}`);
    ev.note("the browser that changed the password stays signed in across pages");
    await ev.shot("change-signed-in", { page: other });

    await expectSignedOut(page, "/gallery", "session from before the change");
    await ev.shot("revoked-session");

    const row = admin.getByRole("row").filter({ hasText: storedId });
    await row.click();
    const edit = admin.getByRole("dialog", { name: await ev.t("members.edit", { username: storedId }, admin) });
    await edit.waitFor({ timeout: 10_000 });
    await edit.getByPlaceholder(await ev.t("members.password.temporary", { min: 8 }, admin)).fill(INITIAL);
    await edit.getByRole("button", { name: await ev.t("members.password.change", undefined, admin), exact: true }).click();
    await edit.getByText(await ev.t("members.editor.temporaryNote", undefined, admin)).waitFor({ timeout: 15_000 });
    const reset = await member();
    if (reset.mustChangePassword !== true) ev.fail("an admin reset must set mustChangePassword");
    await ev.shot("admin-reset", { page: admin });
    await expectSignedOut(other, "/playground", "session from before the admin reset");
    await signIn(other, storedId, INITIAL);
    await other.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, other) }).waitFor({ timeout: 20_000 });
    ev.note("after the admin reset the member's session ended and the reset password asks for a change");
    await ev.shot("reset-forces-change", { page: other });

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: await ev.t("auth.changePassword"), exact: true }).click();
    for (let attempt = 1; attempt <= 10; attempt++) {
      const status = await submitChangeForStatus(page, { id: typedId, current: `wrong-${attempt}-pw`, next: second });
      if (status !== 401) ev.fail(`wrong current password #${attempt} should be a 401, got ${status}`);
    }
    await expectAlert(page, await ev.t("errors.wrongCredentials"), "wrong current password");
    const lockedStatus = await submitChangeForStatus(page, { id: typedId, current: INITIAL, next: second });
    if (lockedStatus !== 423) ev.fail(`the right current password after 10 failures should be a 423, got ${lockedStatus}`);
    await expectAlert(page, await ev.t("errors.locked", { minutes: 15 }), "right current password after 10 failures");
    const locked = await member();
    if (!locked.lockedUntil || locked.failedAttempts < 10) ev.fail(`expected a lock after 10 failures, got ${JSON.stringify({ lockedUntil: locked.lockedUntil, failedAttempts: locked.failedAttempts })}`);
    ev.note(`locked after ${locked.failedAttempts} failures until ${locked.lockedUntil}; the right password is refused while locked`);
    await ev.shot("lockout");
  } finally {
    const postgres = createRequire(join(webDir, "package.json"))("postgres");
    // One connection, one query at a time: the transaction pooler cannot answer pipelined queries.
    const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
    try {
      const gone = await sql`delete from users where username = ${storedId} and username like 'vgs-pw-%' returning id`;
      ev.note(`cleanup: deleted ${gone.length} member row(s) for ${storedId}`);
    } finally {
      await sql.end();
    }
  }
}
