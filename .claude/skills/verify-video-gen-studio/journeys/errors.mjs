/**
 * Feature: errors — every server refusal and stored failure reason reads in the page's language, and provider text and
 * old Korean reasons show as written. Saves each surface to .impeccable/review/i18n-2/<surface>-<lang>-<viewport>.png.
 * Creates and deletes three vgs-loc-* members and their rows; writes generation rows, so it runs on a local database only.
 * See features/errors.md.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composerHandles } from "../composer-handles.mjs";

const INITIAL = "oooooooo";
const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const GPT = "openai/gpt-image-2";
const OPENAI_DEFAULTS = { delayMs: 0, refuseFirstN: 0, overloadedFirstN: 0, retryAfterS: 1, fail: null, usage: true };
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function errors({ page, ev, base, env, webDir, local }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes generation rows, so .env.local must point at a local database");
  const fake = env.VGS_FAKE_HF;
  if (!fake) ev.fail("precondition: set VGS_FAKE_HF to the fake the app talks to; the image failure runs against it");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "i18n-2");
  mkdirSync(reviewDir, { recursive: true });
  const review = async (surface, p = page, focus) => {
    if (focus) await focus.scrollIntoViewIfNeeded();
    await ev.shot(surface, { page: p });
    await p.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`) });
  };
  const expectText = async (locator, want, what) => {
    try {
      await locator.filter({ hasText: want }).first().waitFor({ timeout: 30_000 });
    } catch {
      ev.fail(`${what}: expected "${want}", got "${(await locator.allTextContents()).join(" | ")}"`);
    }
  };

  const stamp = Date.now().toString(36);
  const [memberA, memberB, memberC] = ["a", "b", "c"].map((x) => `vgs-loc-i18n2-${stamp}-${x}@example.test`);
  const chosenA = `i18n2-${stamp}-a-1`;
  const imagePrompt = `[목업] i18n2 ${stamp} image failure`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const admin = await ev.newPage();
  const member = await ev.newPage();
  const signIn = async (p, id, password) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(password);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };
  const fillNewPassword = async (p, next) => {
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(next);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(next);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
  };
  const setOpenAi = (knobs) => fetch(`${fake}/_config`, { method: "POST", body: JSON.stringify({ openai: { ...OPENAI_DEFAULTS, ...knobs } }) });

  try {
    // err-wrong: an ID that does not exist, so no real account's lockout counter moves.
    await signIn(page, `nobody-${stamp}@example.test`, "wrong-pass-1");
    const alert = page.locator("form").getByRole("alert");
    await expectText(alert, await ev.t("errors.wrongCredentials"), "wrong password");
    await review("login-wrong");

    await ev.login("/admin", admin);
    for (const id of [memberA, memberB, memberC]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL }) }, admin);
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    ev.note(`admin API created ${memberA}, ${memberB} and ${memberC} with the temporary password`);

    // err-wire: refusals carry only a code and params, never a sentence.
    const refusals = [
      ["empty sign-in", "/api/auth/login", { method: "POST", body: "{}" }],
      ["bad generation id", "/api/generations/not-a-uuid", {}],
      ["bad locale", "/api/locale", { method: "POST", body: JSON.stringify({ locale: "fr" }) }],
      ["blank team name", "/api/admin/teams", { method: "POST", body: JSON.stringify({ name: "  " }) }],
      ["duplicate ID", "/api/admin/users", { method: "POST", body: JSON.stringify({ username: memberA, password: INITIAL }) }],
      ["bad upload path", "/api/uploads/blob", { method: "POST", body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: "../x.mp4", callbackUrl: `${base}/api/uploads/blob`, clientPayload: null, multipart: false } }) }],
    ];
    const lines = [];
    for (const [label, path, init] of refusals) {
      const { status, body } = await ev.api(path, init, admin);
      const text = JSON.stringify(body);
      if (Object.keys(body ?? {}).join() !== "error" || typeof body.error.code !== "string" || /[가-힣]/.test(text)) ev.fail(`${label}: ${status} ${text}`);
      lines.push(`${status} ${label.padEnd(18)} ${text}`);
    }
    const anonymous = await fetch(`${base}/api/generations`);
    lines.push(`${anonymous.status} ${"no session".padEnd(18)} ${await anonymous.text()}`);
    if (!lines.at(-1).endsWith('{"error":{"code":"signInRequired"}}')) ev.fail(`no session: ${lines.at(-1)}`);
    writeFileSync(join(reviewDir, "wire.txt"), `${lines.join("\n")}\n`);
    ev.note(`err-wire: ${lines.length} refusals are codes with no Hangul`);

    // err-locked: ten wrong passwords, then the right one is refused with the minutes from params.
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: memberB, password: `wrong-${i}-pw` }) });
      if (res.status !== 401) ev.fail(`wrong password #${i} answered ${res.status}`);
    }
    const lockedWire = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: memberB, password: INITIAL }) });
    const lockedBody = await lockedWire.json();
    if (lockedWire.status !== 423 || JSON.stringify(lockedBody) !== JSON.stringify({ error: { code: "locked", params: { minutes: 15 } } })) ev.fail(`the lock answered ${lockedWire.status} ${JSON.stringify(lockedBody)}`);
    await signIn(page, memberB, INITIAL);
    await expectText(alert, await ev.t("errors.locked", { minutes: 15 }), "lockout");
    ev.note(`err-locked: the wire says ${JSON.stringify(lockedBody)}; the page says "${await alert.first().innerText()}"`);
    await review("login-locked");

    // err-temporary: the temporary password's own rules, from the forced change form.
    await signIn(page, memberC, INITIAL);
    await page.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title") }).waitFor({ timeout: 20_000 });
    await fillNewPassword(page, INITIAL);
    await expectText(alert, await ev.t("errors.passwordIsInitial"), "the initial password as the new one");
    await review("password-initial");
    await fillNewPassword(page, "short");
    await expectText(alert, await ev.t("errors.passwordTooShort", { min: 8 }), "a short new password");
    await review("password-short");

    // err-stage: failed rows in each form. The newest, an error code, is on the stage.
    const [{ id: aId }] = await sql`select id from users where username = ${memberA}`;
    const failed = (minutesAgo, prompt, stored) => sql`
      insert into generations (user_id, model_id, prompt, status, duration_s, cost_usd, error, error_code, error_params, created_at, completed_at)
      values (${aId}, 'bytedance/seedance-2.0/text-to-video', ${prompt}, 'failed', 5, 0, ${stored.error ?? null}, ${stored.code ?? null},
        ${stored.params ? sql.json(stored.params) : null}, now() - make_interval(mins => ${minutesAgo}), now() - make_interval(mins => ${minutesAgo}))`;
    await failed(3, `[목업] i18n2 ${stamp} old row`, { error: "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요" });
    await failed(2, `[목업] i18n2 ${stamp} provider text`, { error: "content moderation" });
    await failed(1, `[목업] i18n2 ${stamp} coded`, { code: "submitDeadline", params: { minutes: 30 } });

    await signIn(member, memberA, INITIAL);
    await member.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, member) }).waitFor({ timeout: 20_000 });
    await fillNewPassword(member, chosenA);
    await member.waitForURL("**/playground", { timeout: 30_000 });
    await member.waitForLoadState("networkidle");
    const hm = await composerHandles(ev, member);
    // Without a Higgsfield key the composer starts on the image model, which needs none.
    await hm.pickModel("bytedance/seedance-2.0", "video");
    const noKey = hm.status.filter({ hasText: await ev.t("errors.noKey", undefined, member) });
    await noKey.first().waitFor({ timeout: 20_000 });
    await hm.prompt.fill("");
    const blocker = hm.status.filter({ hasText: await ev.t("errors.promptRequired", { model: "Seedance 2.0", mode: "t2v" }, member) });
    await blocker.first().waitFor({ timeout: 10_000 });
    ev.note("err-composer: the no-key line and the composer's reason read in the page language");
    await review("playground-no-key", member, noKey.first());
    await review("playground-blocker", member, blocker.first());
    // The three failed rows have no thread, so they are the earlier history.
    await member.goto(`${base}/playground?thread=earlier`, { waitUntil: "networkidle" });
    const stage = (await composerHandles(ev, member)).stream;
    const coded = await ev.t("errors.submitDeadline", { minutes: 30 }, member);
    await expectText(stage.locator("p"), coded, "the coded failure in the stream");
    await review("playground-failure", member, stage.getByText(coded).first());

    // err-nickname: the nickname rule, checked in the browser before the server, reads the same code.
    await member.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await member.getByLabel(new RegExp(`^${literal(await ev.t("profile.nickname.label", undefined, member))}`)).fill("가".repeat(31));
    await member.getByRole("button", { name: await ev.t("profile.nickname.save", undefined, member) }).click();
    const tooLong = await ev.t("errors.nameTooLong", { kind: "nickname", max: 30, length: 31 }, member);
    await expectText(member.locator("main").getByRole("alert"), tooLong, "a 31-character nickname");
    const wire = await ev.api("/api/me", { method: "PATCH", body: JSON.stringify({ nickname: "a".repeat(31) }) }, member);
    if (JSON.stringify(wire.body) !== JSON.stringify({ error: { code: "nameTooLong", params: { kind: "nickname", max: 30, length: 31 } } })) ev.fail(`PATCH /api/me answered ${wire.status} ${JSON.stringify(wire.body)}`);
    await review("settings-nickname", member, member.locator("main").getByRole("alert").first());

    // err-duplicate: the admin modal shows the server's code in the page language.
    await admin.goto(`${base}/admin`, { waitUntil: "networkidle" });
    const addTitle = await ev.t("members.add.title", undefined, admin);
    await admin.getByRole("button", { name: addTitle, exact: true }).click();
    const add = admin.getByRole("dialog", { name: addTitle });
    await add.getByLabel("ID", { exact: true }).fill(memberA);
    await add.getByLabel(await ev.t("members.add.password", undefined, admin)).fill("abcdefgh1");
    await add.getByRole("button", { name: await ev.t("members.add.submit", undefined, admin), exact: true }).click();
    await expectText(add.getByRole("alert"), await ev.t("errors.duplicateUsername", undefined, admin), "a duplicate ID");
    await review("admin-duplicate", admin);
    await admin.keyboard.press("Escape");

    // err-logs: the admin logs tab shows each stored form, old Korean text as it was written.
    await admin.getByRole("button", { name: await ev.t("admin.tabs.logs", undefined, admin), exact: true }).click();
    for (const [label, surface, want] of [
      ["old row", "logs-old-row", "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요"],
      ["provider text", "logs-provider-text", "content moderation"],
      ["coded", "logs-coded", await ev.t("errors.submitDeadline", { minutes: 30 }, admin)],
    ]) {
      await admin.getByRole("row").filter({ hasText: `i18n2 ${stamp} ${label}` }).click();
      const detail = admin.locator("dl");
      await expectText(detail.locator("dd"), want, `the logs detail of the ${label}`);
      await review(surface, admin);
      await admin.keyboard.press("Escape");
      await admin.mouse.click(5, 5);
    }

    // err-image: real submits the fake OpenAI fails. A 500 is imageUnanswered (maybe billed); a 401 keeps OpenAI's own words.
    const failImage = async (fail, code, surface, check) => {
      await setOpenAi({ fail });
      await admin.goto(`${base}/playground`, { waitUntil: "networkidle" });
      const ha = await composerHandles(ev, admin);
      await ha.pickModel(GPT, "image");
      await ha.prompt.fill(`${imagePrompt} ${fail}`);
      const { status, body } = await ha.submit();
      const id = body?.item?.id;
      if (!id) ev.fail(`the ${fail} image submit answered ${status}`);
      let row;
      for (let i = 0; i < 40 && row?.status !== "failed"; i++) {
        await admin.waitForTimeout(500);
        row = (await ev.api(`/api/generations/${id}`, undefined, admin)).body?.item;
      }
      if (row?.status !== "failed" || row.reason?.code !== code || !check(row.reason.params)) ev.fail(`the ${fail} image row ended ${row?.status} ${JSON.stringify(row?.reason)}`);
      const shown = await ev.t(`errors.${code}`, row.reason.params, admin);
      const adminStage = ha.stream;
      await expectText(adminStage.locator("p"), shown, `the ${fail} image failure in the stream`);
      ev.note(`err-image ${fail}: the row stores ${JSON.stringify(row.reason)} and the stream reads it in the page language`);
      await review(surface, admin, adminStage.getByText(shown).first());
    };
    await failImage("server", "imageUnanswered", "playground-image-failure", (p) => p?.cause === "reply");
    await failImage("badkey", "openaiKeyRejected", "playground-key-rejected", (p) => p?.status === 401 && String(p.detail).startsWith("Incorrect API key provided: sk-… ") && !/sk-proj|wxyz/.test(String(p.detail)));
  } finally {
    await setOpenAi({});
    const ids = [memberA, memberB, memberC];
    await sql`delete from generations where user_id in (select id from users where username in ${sql(ids)} and username like 'vgs-loc-%')`;
    await sql`delete from generations where prompt like ${`${imagePrompt}%`}`;
    const gone = await sql`delete from users where username in ${sql(ids)} and username like 'vgs-loc-%' returning id`;
    ev.note(`cleanup: deleted ${gone.length} members and their rows`);
    await sql.end();
  }
}
