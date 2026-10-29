/**
 * Regression check for the live stage in src/components/Playground.tsx, through a real browser against a running app.
 * A temporary member, poll-check-<random>, signs in through the form, attaches one image reference and generates once.
 * The browser's clock runs SKEW_MS ahead (default 60 s, a member whose computer clock is off), and the page's 2nd poll
 * request is held in the browser and never answered. Exits 0 only if
 *   - the stage shows a finished label within RECOVER_MS of the database row finishing,
 *   - once a poll has answered, the stage's elapsed time stays within -2.5 s..+1 s of the row's age by the database
 *     clock (the stage shows whole seconds and redraws once a second),
 *   - the 갤러리 counter rises by exactly 1.
 * The member's Higgsfield key is fake, so run the app against scripts/fake-higgsfield.ts; a real Higgsfield refuses the
 * key and nothing is spent. Playwright comes from the verify-video-gen-studio harness. The member and its rows are
 * deleted before it exits.
 *
 *   BASE=http://localhost:3100 npx tsx scripts/playground-poll-check.mts
 *   MOBILE=1 BASE=http://localhost:3100 npx tsx scripts/playground-poll-check.mts
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { encrypt, hashPassword } from "../src/lib/crypto";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

type Locator = {
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<unknown>;
  click(): Promise<void>;
  waitFor(opts?: { timeout?: number }): Promise<void>;
  first(): Locator;
  locator(selector: string): Locator;
  getByRole(role: string, opts: { name: string }): Locator;
  getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null>;
  textContent(opts?: { timeout?: number }): Promise<string | null>;
  setInputFiles(path: string): Promise<void>;
};
type Page = Pick<Locator, "locator" | "getByRole"> & {
  clock: { install(opts: { time: number }): Promise<void> };
  route(url: string, handler: (route: { continue(): Promise<void> }) => Promise<void>): Promise<void>;
  on(event: "response", listener: (res: { url(): string }) => void): void;
  goto(url: string): Promise<unknown>;
  getByLabel(text: string): Locator;
  keyboard: { press(key: string): Promise<void> };
  waitForURL(url: (url: URL) => boolean, opts?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
};
type Chromium = {
  launch(opts: { headless: boolean; executablePath?: string }): Promise<{
    newContext(opts: { viewport: { width: number; height: number }; isMobile?: boolean; hasTouch?: boolean }): Promise<{ newPage(): Promise<Page> }>;
    close(): Promise<void>;
  }>;
};

const BASE = process.env.BASE ?? "http://localhost:3100";
const SKEW_MS = Number(process.env.SKEW_MS ?? 60_000);
const MOBILE = process.env.MOBILE === "1";
/** The page's 10 s poll timeout plus one poll's answer and a margin. Without the timeout the stage never finishes. */
const RECOVER_MS = 15_000;
const LIVE = /제출 대기|대기|생성 중/;

const watchdog = setTimeout(() => {
  console.log("watchdog");
  process.exit(2);
}, 4 * 60_000);
const db = getDb();
const { users, generations } = schema;
const username = `poll-check-${randomBytes(4).toString("hex")}`;
const password = randomBytes(12).toString("base64url");
const [member] = await db
  .insert(users)
  .values({ username, passwordHash: hashPassword(password), role: "user", apiKeyEnc: encrypt(`fake:${username}`), note: "playground-poll-check" })
  .returning({ id: users.id });
const harness = resolve(".claude/skills/verify-video-gen-studio/node_modules/playwright/index.mjs");
const { chromium } = (await import(pathToFileURL(harness).href)) as { chromium: Chromium };
const browser = await chromium.launch({ headless: true, executablePath: process.env.VGS_CHROME || undefined });
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const context = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.clock.install({ time: Date.now() + SKEW_MS });
  let polls = 0;
  let firstAnswerAt = 0;
  await page.route("**/api/generations?ids=*", async (route) => {
    if (++polls !== 2) await route.continue();
  });
  page.on("response", (res) => {
    if (!firstAnswerAt && res.url().includes("/api/generations?ids=")) firstAnswerAt = Date.now();
  });

  await page.goto(`${BASE}/login?next=/playground`);
  await page.getByLabel("ID").fill(username);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => u.pathname === "/playground", { timeout: 60_000 });
  const stage = page.getByRole("region", { name: "결과 무대" });
  const galleryCounter = stage.locator('div:has(> a[aria-label="갤러리"]) > span').first();
  const galleryBefore = await galleryCounter.textContent();
  await page.getByLabel("모델").selectOption("minimax/h3");
  await page.getByRole("button", { name: "레퍼런스 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "레퍼런스 추가" });
  await dialog.locator('input[type=file][accept^="image/"]').setInputFiles("public/mock/ref-landscape-1.jpg");
  await dialog.getByRole("list", { name: "첨부한 레퍼런스" }).locator("li").first().waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "프롬프트" }).fill(`POLL CHECK ${new Date().toISOString()}`);
  await page.getByRole("complementary", { name: "생성 설정" }).getByRole("button", { name: "생성하기" }).click();
  const article = stage.locator("article").first();
  await article.waitFor({ timeout: 60_000 });
  const id = (await article.getAttribute("data-id")) ?? "";

  const samples: { t: number; label: string; elapsed: string | null; status: string; ageMs: number }[] = [];
  let rowDoneAt = 0;
  let stageDoneAt = 0;
  const started = Date.now();
  while (Date.now() - started < 150_000 && !(stageDoneAt && rowDoneAt)) {
    const label = ((await article.getAttribute("aria-label")) ?? "").split(": ")[1] ?? "";
    const elapsed = await article.locator('[aria-live="polite"]').textContent({ timeout: 200 }).catch(() => null);
    const [row] = await db
      .select({ status: generations.status, ageMs: sql<number>`extract(epoch from now() - ${generations.createdAt}) * 1000`.mapWith(Number) })
      .from(generations)
      .where(eq(generations.id, id));
    const t = Date.now();
    samples.push({ t, label, elapsed, status: row.status, ageMs: row.ageMs });
    if (!rowDoneAt && !["pending", "queued", "in_progress"].includes(row.status)) rowDoneAt = t;
    if (!stageDoneAt && !LIVE.test(label)) stageDoneAt = t;
    if (rowDoneAt && !stageDoneAt && t - rowDoneAt > RECOVER_MS + 5_000) break;
    await page.waitForTimeout(250);
  }
  const lag = stageDoneAt && rowDoneAt ? stageDoneAt - rowDoneAt : null;
  check(
    lag !== null && lag <= RECOVER_MS,
    lag === null
      ? `stage still showed "${samples.at(-1)?.label}" ${rowDoneAt ? Date.now() - rowDoneAt : "?"} ms after the row became ${samples.at(-1)?.status}, with the 2nd poll request unanswered`
      : `stage finished ${lag} ms after the row (bound ${RECOVER_MS} ms), with the 2nd poll request unanswered`,
  );

  const seconds = (s: string | null) => (s && /^\d+:\d\d$/.test(s) ? Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]) : null);
  const diffs = samples
    .filter((s) => firstAnswerAt && s.t > firstAnswerAt + 1_000 && LIVE.test(s.label) && seconds(s.elapsed) !== null)
    .map((s) => seconds(s.elapsed)! - s.ageMs / 1000);
  const [lo, hi] = [Math.min(...diffs), Math.max(...diffs)];
  check(
    diffs.length >= 3 && lo >= -2.5 && hi <= 1,
    `stage elapsed minus database age over ${diffs.length} live samples: ${lo.toFixed(2)}..${hi.toFixed(2)} s (bound -2.5..1 s, browser clock ${SKEW_MS} ms ahead)`,
  );

  const galleryAfter = await galleryCounter.textContent();
  const n = (s: string | null) => (s === "—" ? 0 : Number(s));
  check(n(galleryAfter) - n(galleryBefore) === 1, `갤러리 counter went ${galleryBefore} -> ${galleryAfter} for one finished generation`);
} finally {
  await browser.close();
  await db.delete(generations).where(eq(generations.userId, member.id));
  await db.delete(users).where(eq(users.id, member.id));
  const [left] = await db.select({ n: count() }).from(users).where(eq(users.id, member.id));
  check(left.n === 0, `temporary member ${username} and its rows removed`);
}
clearTimeout(watchdog);
process.exit(failures.length ? 1 : 0);
