/** Feature: login — form, wrong password, success, redirect guard, logout. See features/login.md. */
export default async function login({ page, ev, base, creds }) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  if (!(await page.getByRole("heading", { name: "로그인", level: 1 }).isVisible())) ev.fail("login page did not render its h1");
  await ev.shot("form");

  // login-wrong: one bad attempt (counts toward the 10-attempt lockout; reset by the success below).
  await page.getByLabel("ID").fill(creds.username);
  await page.getByLabel("비밀번호").fill(creds.password + "x");
  await page.getByRole("button", { name: "로그인" }).click();
  // Scoped to the form: the Next dev overlay mounts an empty role=alert of its own.
  const alert = page.locator("form").getByRole("alert");
  await alert.waitFor({ timeout: 20_000 });
  const text = (await alert.textContent()) ?? "";
  if (!text.includes("맞지 않습니다")) ev.fail(`unexpected error text: ${text}`);
  if (!page.url().endsWith("/login")) ev.fail("wrong password must stay on /login");
  await ev.shot("wrong-password");

  // login-ok: real form submit, lands on the playground with the nav identity.
  await page.getByLabel("비밀번호").fill(creds.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/playground", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const header = page.locator("header");
  if (!(await header.getByText(creds.username, { exact: true }).isVisible())) ev.fail("header does not show the signed-in username");
  await ev.shot("signed-in");

  // login-guard: a signed-in visit to /login bounces to /playground (proxy.ts).
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  if (!page.url().includes("/playground")) ev.fail(`/login while signed in should redirect to /playground, got ${page.url()}`);
  ev.note("signed-in visit to /login redirected to /playground");

  // logout: button in the header, then a protected page bounces back with ?next.
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.waitForURL("**/login", { timeout: 20_000 });
  await page.goto(`${base}/playground`, { waitUntil: "networkidle" });
  if (!/\/login\?next=%2Fplayground$/.test(page.url())) ev.fail(`after logout /playground should redirect to /login?next=%2Fplayground, got ${page.url()}`);
  await ev.shot("after-logout");
}
