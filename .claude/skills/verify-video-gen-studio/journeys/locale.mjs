import { createRequire } from "node:module";
import { join } from "node:path";

const INITIAL = "oooooooo";
const LANG_OF = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN", "zh-TW": "zh-CN" };
const BROWSER_OF = { ko: "ko-KR", en: "en-US", "zh-CN": "zh-CN" };
const NAMES = { ko: "한국어", en: "English", "zh-CN": "简体中文" };
const NEXT = { ko: "en", en: "zh-CN", "zh-CN": "ko" };
const KOREAN_FONTS = /Malgun Gothic|Apple SD Gothic Neo|Noto Sans KR/;

/**
 * Feature: locale — the browser language on first visit, the login picker and its cookie, `<html lang>`, a member's
 * language across sign-out and a second browser, and the shared-browser rule. Creates and deletes two `vgs-loc-*`
 * members. See features/locale.md.
 */
export default async function locale({ page, ev, base, creds, env, webDir, local }) {
  const stamp = Date.now().toString(36);
  const memberA = `vgs-loc-${stamp}-a@example.test`;
  const memberB = `vgs-loc-${stamp}-b@example.test`;
  const passwords = { [memberA]: INITIAL, [memberB]: INITIAL };
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const stored = async (id) => (await sql`select locale from users where username = ${id}`)[0]?.locale ?? null;

  const runLang = LANG_OF[env.VGS_LOCALE || "ko-KR"];
  if (!runLang) ev.fail(`VGS_LOCALE ${env.VGS_LOCALE} is not one of ${Object.keys(LANG_OF).join(", ")}`);
  const loginPick = NEXT[runLang];
  const settingsPick = NEXT[loginPick];
  const bPick = NEXT[settingsPick];

  const langOf = (p) => p.evaluate(() => document.documentElement.lang);
  const expectLang = async (p, want, what) => {
    const got = await langOf(p);
    if (got !== want) ev.fail(`${what}: <html lang> is "${got}", expected "${want}"`);
  };
  const cookieOf = async (p) => (await p.context().cookies()).find((c) => c.name === "vgs_locale")?.value ?? null;
  const expectCookie = async (p, want, what) => {
    const got = await cookieOf(p);
    if (got !== want) ev.fail(`${what}: vgs_locale cookie is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  const expectStored = async (id, want, what) => {
    const got = await stored(id);
    if (got !== want) ev.fail(`${what}: users.locale of ${id} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  const noOverflow = async (p, what) => {
    const { scrollWidth, innerWidth } = await p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    if (scrollWidth > innerWidth) ev.fail(`${what}: the page scrolls sideways (${scrollWidth} > ${innerWidth})`);
  };
  const fontsOf = async (p, selector) => {
    const cdp = await p.context().newCDPSession(p);
    try {
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      return fonts.map((f) => `${f.familyName} ${f.glyphCount}`);
    } finally {
      await cdp.detach();
    }
  };
  const pick = async (p, lang) => {
    await p.getByRole("button", { name: NAMES[lang], exact: true }).click();
    await p.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 20_000 });
    await p.waitForLoadState("networkidle");
  };
  const fillSignIn = async (p, id) => {
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(passwords[id]);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };
  const signIn = async (p, id) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await fillSignIn(p, id);
    await p.waitForURL("**/playground", { timeout: 30_000 });
    await p.waitForLoadState("networkidle");
  };
  const changeTemporary = async (p, id, shot) => {
    await p.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, p) }).waitFor({ timeout: 20_000 });
    if (shot) await ev.shot(shot, { page: p });
    const chosen = `loc-${stamp}-${id === memberA ? "a" : "b"}-pw`;
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(chosen);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(chosen);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
    await p.waitForURL("**/playground", { timeout: 30_000 });
    await p.waitForLoadState("networkidle");
    passwords[id] = chosen;
  };
  const signOut = async (p) => {
    await p.getByRole("button", { name: await ev.t("nav.logout", undefined, p) }).click();
    await p.waitForURL("**/login", { timeout: 20_000 });
    await p.waitForLoadState("networkidle");
  };
  const expectHeader = async (p, what) => {
    const nav = p.getByRole("navigation", { name: await ev.t("nav.label", undefined, p) }).filter({ visible: true });
    for (const key of ["playground", "gallery", "dashboard"]) {
      if (!(await nav.getByRole("link", { name: await ev.t(`pages.${key}`, undefined, p), exact: true }).isVisible())) ev.fail(`${what}: the header has no ${key} link in ${await langOf(p)}`);
    }
  };

  const admin = await ev.newPage();
  try {
    const adminBefore = await stored(creds.username);
    await ev.login("/admin", admin);
    for (const id of [memberA, memberB]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL }) }, admin);
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    ev.note(`admin API created ${memberA} and ${memberB} with the temporary password; this run picks ${loginPick} on the login screen, ${settingsPick} in 설정, and ${bPick} for the second member`);

    for (const [browser, lang] of Object.entries(LANG_OF)) {
      const visitor = await ev.newPage({ locale: browser });
      await visitor.goto(`${base}/login`, { waitUntil: "networkidle" });
      await expectLang(visitor, lang, `a ${browser} browser on /login`);
      const title = await ev.t("auth.heading.login.title", undefined, visitor);
      if (!(await visitor.getByRole("heading", { level: 1, name: title }).isVisible())) ev.fail(`${browser}: the h1 should read "${title}"`);
      const tabTitle = `${await ev.t("pages.login", undefined, visitor)} · Video Gen Studio`;
      if ((await visitor.title()) !== tabTitle) ev.fail(`${browser}: the tab title is "${await visitor.title()}", expected "${tabTitle}"`);
      if (await cookieOf(visitor)) ev.fail(`${browser}: detecting the browser language must not write the vgs_locale cookie`);
      const pressed = await visitor.getByRole("button", { name: NAMES[lang], exact: true }).getAttribute("aria-pressed");
      if (pressed !== "true") ev.fail(`${browser}: the ${NAMES[lang]} button should be pressed`);
      await noOverflow(visitor, `${browser} /login`);
      if (lang === "zh-CN") {
        const fonts = await fontsOf(visitor, "h1");
        if (fonts.some((f) => KOREAN_FONTS.test(f))) ev.fail(`${browser}: the Chinese h1 renders with a Korean font: ${fonts.join(", ")}`);
        ev.note(`${browser}: the h1 renders from ${fonts.join(", ")}`);
      } else {
        const fonts = await fontsOf(visitor, 'button[lang="zh-CN"]');
        if (fonts.some((f) => KOREAN_FONTS.test(f))) ev.fail(`${browser}: the 简体中文 button renders with a Korean font: ${fonts.join(", ")}`);
      }
      await ev.shot(`visitor-${browser}-login`, { page: visitor });
      await visitor.getByRole("button", { name: await ev.t("auth.changePassword", undefined, visitor), exact: true }).click();
      await visitor.getByRole("heading", { level: 1, name: await ev.t("auth.heading.change.title", undefined, visitor) }).waitFor({ timeout: 10_000 });
      await noOverflow(visitor, `${browser} password change`);
      await ev.shot(`visitor-${browser}-change`, { page: visitor });
      await visitor.goto(`${base}/`, { waitUntil: "networkidle" });
      await expectLang(visitor, lang, `a ${browser} browser on /`);
      for (const model of ["Seedance 2.0", "MiniMax H3"]) {
        if (!(await visitor.getByText(model, { exact: false }).first().isVisible())) ev.fail(`${browser}: the landing page should name ${model} as it is`);
      }
      await noOverflow(visitor, `${browser} landing`);
      await ev.shot(`visitor-${browser}-landing`, { page: visitor, fullPage: true });
      await visitor.context().close();
    }
    ev.note("ko-KR, en-US, zh-CN and zh-TW browsers got ko, en, zh-CN and zh-CN on /login and / with matching h1, tab title, pressed button, and no cookie");

    const bad = await ev.newPage();
    await bad.goto(`${base}/login`, { waitUntil: "networkidle" });
    const refused = await ev.api("/api/locale", { method: "POST", body: JSON.stringify({ locale: "de" }) }, bad);
    if (refused.status !== 400 || (await cookieOf(bad))) ev.fail(`POST /api/locale {"locale":"de"} should be a 400 that sets nothing, got ${refused.status}`);
    await bad.context().close();
    ev.note('POST /api/locale {"locale":"de"} answered 400 and set no cookie');

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await expectLang(page, runLang, "the run's browser language");
    await page.getByLabel("ID").fill(memberA);
    await pick(page, loginPick);
    if ((await page.getByLabel("ID").inputValue()) !== memberA) ev.fail("switching the language should keep the typed ID");
    await expectCookie(page, loginPick, "after the login picker");
    if ((await page.getByRole("button", { name: NAMES[loginPick], exact: true }).getAttribute("aria-pressed")) !== "true") ev.fail(`${NAMES[loginPick]} should be pressed after picking it`);
    const pickedTitle = `${await ev.t("pages.login")} · Video Gen Studio`;
    if ((await page.title()) !== pickedTitle) ev.fail(`after the pick the tab title is "${await page.title()}", expected "${pickedTitle}"`);
    await ev.shot("login-picked");
    // The pick is remembered for sign-in only in this page's state, so the reload happens in a second tab.
    const tab = await page.context().newPage();
    await tab.goto(`${base}/login`, { waitUntil: "networkidle" });
    await expectLang(tab, loginPick, "a second tab after the pick");
    await tab.reload({ waitUntil: "networkidle" });
    await expectLang(tab, loginPick, "a reload after the pick");
    await tab.close();
    ev.note(`the login picker switched ${runLang} → ${loginPick} in place (typed ID kept), set vgs_locale=${loginPick}, and a second tab and its reload kept it`);

    await fillSignIn(page, memberA);
    await changeTemporary(page, memberA, "temporary-password");
    await expectLang(page, loginPick, "after the forced change");
    await expectStored(memberA, loginPick, "a pick on the login screen before the first sign-in");
    await expectHeader(page, "after sign-in");
    await ev.shot("signed-in-header");
    ev.note(`${memberA} picked ${loginPick} before signing in, and the forced password change stored it on the account`);

    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const section = page.getByRole("region", { name: await ev.t("language.label") });
    if (!(await section.isVisible())) ev.fail("설정 should have a language section");
    await section.scrollIntoViewIfNeeded();
    await pick(page, settingsPick);
    await expectStored(memberA, settingsPick, "a pick in 설정");
    await expectCookie(page, settingsPick, "a pick in 설정");
    await expectHeader(page, "after the 설정 pick");
    await noOverflow(page, "설정 after the pick");
    await page.getByRole("region", { name: await ev.t("language.label") }).scrollIntoViewIfNeeded();
    await ev.shot("settings-language");
    ev.note(`${memberA} picked ${settingsPick} in 설정: users.locale and the cookie are ${settingsPick}, and the header re-rendered in it`);

    await signOut(page);
    await expectLang(page, settingsPick, "the login screen after sign-out");
    await ev.shot("signed-out");

    const second = await ev.newPage({ locale: BROWSER_OF[NEXT[settingsPick]] });
    await signIn(second, memberA);
    await expectLang(second, settingsPick, `a second ${BROWSER_OF[NEXT[settingsPick]]} browser after ${memberA} signs in`);
    await expectCookie(second, settingsPick, "the second browser after sign-in");
    await expectStored(memberA, settingsPick, "a sign-in without a pick");
    await expectHeader(second, "the second browser");
    await ev.shot("second-browser", { page: second });
    ev.note(`a second browser in ${BROWSER_OF[NEXT[settingsPick]]} showed ${settingsPick} after ${memberA} signed in, without touching the picker`);

    await signOut(second);
    await second.goto(`${base}/login`, { waitUntil: "networkidle" });
    await fillSignIn(second, memberB);
    await changeTemporary(second, memberB);
    await expectStored(memberB, null, "a member who signs in on a shared browser without a pick");
    await second.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await pick(second, bPick);
    await expectStored(memberB, bPick, `${memberB}'s pick in 설정`);
    await signOut(second);
    await signIn(second, memberA);
    await expectLang(second, settingsPick, `${memberA} after ${memberB} signed out on the same browser`);
    await signOut(second);
    await expectCookie(second, settingsPick, `the shared browser after ${memberA} signed out`);
    await signIn(second, memberB);
    await expectLang(second, bPick, `${memberB} on a browser whose cookie says ${settingsPick}`);
    await expectCookie(second, bPick, `the shared browser after ${memberB} signed in`);
    await expectStored(memberA, settingsPick, "the shared browser");
    await expectStored(memberB, bPick, "the shared browser");
    await ev.shot("shared-browser", { page: second });
    ev.note(`shared browser: ${memberB} first signed in with ${memberA}'s cookie and stored nothing; later each member saw their own language (${settingsPick}, ${bPick}) and neither stored value moved`);

    const refusedMember = await ev.api("/api/locale", { method: "POST", body: JSON.stringify({ locale: "zh-TW" }) }, second);
    if (refusedMember.status !== 400) ev.fail(`POST /api/locale {"locale":"zh-TW"} as a member should be a 400, got ${refusedMember.status}`);
    await expectStored(memberB, bPick, "a refused locale");
    ev.note('a member\'s POST /api/locale {"locale":"zh-TW"} answered 400 and left users.locale alone');
    await expectStored(creds.username, adminBefore, "the admin, whose sign-in this run used");
    ev.note(`the admin's users.locale stayed ${JSON.stringify(adminBefore)}`);
  } finally {
    try {
      const gone = await sql`delete from users where username in (${memberA}, ${memberB}) and username like 'vgs-loc-%' returning id`;
      ev.note(`cleanup: deleted ${gone.length} member row(s)`);
    } finally {
      await sql.end();
    }
  }
}
