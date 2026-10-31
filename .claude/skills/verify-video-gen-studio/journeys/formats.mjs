/**
 * Feature: formats — dates in Seoul time in each language's short pattern, relative times that the server and the
 * browser print alike, and dollars as $ with the app's digits rule. Saves each surface to
 * .impeccable/review/i18n-2/<surface>-<lang>-<viewport>.png. Needs `npm run db:mock` rows for the admin, and adds one
 * fresh [목업] row it deletes again, so it runs on a local database only. See features/formats.md.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { composerHandles } from "../composer-handles.mjs";

const LANG = { "ko-KR": "ko", "en-US": "en", "zh-CN": "zh-CN" };
const USD = /^\$\d+(\.\d{2}|\.\d{4})?$/;
const DATE = { ko: /^\d{2}\. \d{1,2}\. \d{1,2}\. \d{2}:\d{2}$/, en: /^\d{1,2}\/\d{1,2}\/\d{2}, \d{2}:\d{2}$/, "zh-CN": /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/ };

export default async function formats({ page, ev, base, env, webDir, local, creds }) {
  if (!/localhost|127\.0\.0\.1/.test(local.DATABASE_URL ?? "")) ev.fail("precondition: this journey writes a generation row, so .env.local must point at a local database");
  const lang = LANG[env.VGS_LOCALE ?? "ko-KR"];
  const viewport = env.VGS_MOBILE === "1" ? "mobile" : "desktop";
  const reviewDir = join(webDir, ".impeccable", "review", "i18n-2");
  mkdirSync(reviewDir, { recursive: true });
  const review = async (surface, opts = {}) => {
    if (opts.focus) await opts.focus.scrollIntoViewIfNeeded();
    await ev.shot(surface, { fullPage: opts.fullPage });
    await page.screenshot({ path: join(reviewDir, `${surface}-${lang}-${viewport}.png`), fullPage: Boolean(opts.fullPage) });
  };
  const hydration = [];
  page.on("console", (m) => /hydrat|did not match|server rendered/i.test(m.text()) && hydration.push(m.text()));
  page.on("pageerror", (e) => hydration.push(String(e)));

  const stamp = Date.now().toString(36);
  const prompt = `[목업] i18n2 ${stamp} three minutes ago`;
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  try {
    const [{ id: adminId }] = await sql`select id from users where username = ${creds.username}`;
    await sql`
      insert into generations (user_id, model_id, prompt, params, status, result_url, duration_s, cost_usd, created_at, completed_at)
      values (${adminId}, 'bytedance/seedance-2.0/text-to-video', ${prompt}, ${sql.json({ duration: 5, resolution: "480p", aspect_ratio: "16:9" })},
        'completed', '/mock/result-landscape.webm', 5, 0.225, now() - interval '3 minutes', now() - interval '2 minutes')`;

    await ev.login("/dashboard");
    const recent = page.getByRole("row").filter({ hasText: prompt });
    const cells = (await recent.locator("td").allTextContents()).map((t) => t.trim());
    if (!DATE[lang].test(cells[0] ?? "") || cells.at(-1) !== "$0.2250") ev.fail(`the dashboard row reads ${JSON.stringify(cells)}`);
    const total = (await page.getByText(/^\$\d+(\.\d+)?$/).first().textContent())?.trim() ?? "";
    if (!USD.test(total)) ev.fail(`the total spend reads ${total}`);
    ev.note(`fmt-dashboard: recent row ${cells[0]} · ${cells.at(-1)}, total ${total}`);
    await review("dashboard", { fullPage: true });

    await page.goto(`${base}/gallery`, { waitUntil: "networkidle" });
    const tile = page.getByRole("listitem").filter({ hasText: prompt });
    const relative = await tile.innerText();
    const ago = { ko: "3분 전", en: "3 minutes ago", "zh-CN": "3分钟前" }[lang];
    if (!relative.includes(ago) || !relative.includes("$0.2250")) ev.fail(`the fresh tile reads ${JSON.stringify(relative)}`);
    await review("gallery-tiles", { focus: tile });
    await tile.getByRole("button", { name: await ev.t("gallery.openDetail", { prompt }) }).click();
    const detail = page.getByRole("dialog", { name: await ev.t("gallery.detail.title") });
    await detail.waitFor({ timeout: 10_000 });
    const dates = (await detail.locator("dd").allTextContents()).map((t) => t.trim()).filter((t) => DATE[lang].test(t));
    if (dates.length < 2) ev.fail(`the detail should show the created and finished times in the ${lang} pattern, got ${JSON.stringify(await detail.locator("dd").allTextContents())}`);
    ev.note(`fmt-gallery: tile "${ago}" and $0.2250, detail dates ${dates.join(", ")}`);
    await review("gallery-detail");
    await page.keyboard.press("Escape");

    await page.goto(`${base}/playground`, { waitUntil: "networkidle" });
    // GPT Image 2 has a rate before any admin sets one, so its estimate shows in dollars.
    const h = await composerHandles(ev, page);
    await h.pickModel("openai/gpt-image-2", "image");
    await h.prompt.fill("i18n2 cost bar");
    const cost = await h.cost();
    if (!/^\$\d+\.\d{4}$/.test(cost)) ev.fail(`the composer's estimate reads ${cost}`);
    ev.note(`fmt-playground: estimate ${cost}`);
    await review("playground-cost", { focus: h.generate });

    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    const adminRow = page.getByRole("row").filter({ hasText: creds.username }).first();
    const adminCells = (await adminRow.locator("td").allTextContents()).map((t) => t.trim());
    if (!adminCells.some((t) => USD.test(t)) || !adminCells.some((t) => DATE[lang].test(t))) ev.fail(`the users row reads ${JSON.stringify(adminCells)}`);
    await review("admin-users", { focus: adminRow });
    await page.getByRole("button", { name: await ev.t("admin.tabs.logs"), exact: true }).click();
    const logRow = page.getByRole("row").filter({ hasText: prompt });
    await logRow.waitFor({ timeout: 15_000 });
    const logCells = (await logRow.locator("td").allTextContents()).map((t) => t.trim());
    if (!DATE[lang].test(logCells[0] ?? "") || logCells.at(-1) !== "$0.2250") ev.fail(`the logs row reads ${JSON.stringify(logCells)}`);
    ev.note(`fmt-admin: users ${adminCells.filter((t) => USD.test(t) || DATE[lang].test(t)).join(" · ")}, logs ${logCells[0]} · ${logCells.at(-1)}`);
    await review("admin-logs", { focus: logRow });

    if (hydration.length) ev.fail(`hydration or page errors: ${hydration.join(" | ").slice(0, 400)}`);
    ev.note("no hydration warning or page error on the dashboard, gallery, playground or admin");
  } finally {
    await sql`delete from generations where prompt = ${prompt}`;
    await sql.end();
  }
}
