/**
 * Checks the promises of src/lib/generations.ts against a fake Higgsfield and the .env.local database.
 *
 *   npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts
 *   HIGGSFIELD_BASE_URL=http://localhost:4010 SUPABASE_URL=http://localhost:4010 SUPABASE_SERVICE_ROLE_KEY=fake npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts
 *   HIGGSFIELD_BASE_URL=http://localhost:4010 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts --measure http://localhost:3100
 *
 * Without HIGGSFIELD_BASE_URL it starts its own fake (scripts/fake-higgsfield.ts). The copy checks upload to the same
 * fake's Supabase Storage subset: SUPABASE_URL is set to the fake when unset and refused when it points anywhere else.
 * The rows it creates belong to ADMIN_USERNAME, whose Higgsfield key must be set (the fake accepts any key), carry
 * prompts starting with "GP-4 ", and are deleted before it exits. It exits non-zero at the first failed check.
 * The stalled-copy check waits out the 240 s fetch timeout, so a full run takes about six minutes.
 *
 * --measure <base> inserts 15 live rows, keeps /playground of the app at <base> open for 60 s in a headless browser
 * (Playwright from the verify-video-gen-studio skill), and prints the app requests and the fake's status calls.
 * The app at <base> must use the same HIGGSFIELD_BASE_URL, and the fake's FAKE_HF_DURATION_MS must outlast the window.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import type { Generation, User } from "../src/db/schema";
import { coerceParams, findModel } from "../src/lib/catalog";
import { isLive } from "../src/lib/generation-status";
import { configFromEnv, createFakeHiggsfield } from "./fake-higgsfield";

type Owner = typeof import("../src/lib/generations");
type Proxy = ReturnType<typeof startProxy>;
type Stats = {
  statusPolls: { byRequest: Record<string, { total: number; perSecondMax: number }>; byApiKey: Record<string, number> };
  media: { downloads: number };
  storage: { byKey: Record<string, { writes: number; size: number; sha256: string }> };
};
type Schedule = (task: () => Promise<void>) => void;
type BrowserResponse = { url(): string; status(): number; request(): { method(): string } };
type BrowserPage = {
  goto(url: string): Promise<unknown>;
  getByLabel(label: string): { fill(value: string): Promise<void> };
  getByRole(role: "button", opts: { name: string }): { click(): Promise<void> };
  waitForURL(url: (url: URL) => boolean): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  on(event: "response", listener: (res: BrowserResponse) => void): void;
};
type Chromium = {
  launch(opts: { headless: boolean; executablePath?: string }): Promise<{
    newPage(opts: { viewport: { width: number; height: number } }): Promise<BrowserPage>;
    close(): Promise<void>;
  }>;
};

const TAG = "GP-4 ";
const MODEL = "minimax/hailuo-2.3/standard/image-to-video";
const CHECK_GAP_MS = 15_000;
const MIRROR_LEASE_S = 360;
const COPY_TIMEOUT_MS = 240_000;
const STORAGE_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const created: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(ok: boolean, claim: string, detail = ""): void {
  if (!ok) throw new Error(`FAIL ${claim}${detail ? ` (${detail})` : ""}`);
  console.log(`ok   ${claim}${detail ? ` (${detail})` : ""}`);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function readAll(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardable(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["authorization", "content-type", "idempotency-key"]) if (typeof h[k] === "string") out[k] = h[k];
  return out;
}

/**
 * Sits between the owner and the fake. It counts every request and can hold one status answer: the answer is fetched
 * from the fake when the request arrives and delivered only on release, which is how a slow, stale observation looks.
 */
function startProxy(target: string) {
  let requests = 0;
  const holds = new Map<string, { arrived: () => void; released: Promise<void> }>();
  const server = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url ?? "/", target);
    const body = await readAll(req);
    const upstream = await fetch(url, { method: req.method, headers: forwardable(req.headers), body: body.length ? new Uint8Array(body) : undefined });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const requestId = /^\/requests\/([^/]+)\/status$/.exec(url.pathname)?.[1];
    const hold = requestId ? holds.get(requestId) : undefined;
    if (requestId && hold) {
      holds.delete(requestId);
      hold.arrived();
      await hold.released;
    }
    const headers: Record<string, string> = { "content-type": upstream.headers.get("content-type") ?? "application/json" };
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers["retry-after"] = retryAfter;
    res.writeHead(upstream.status, headers).end(bytes);
  });
  return {
    server,
    requests: () => requests,
    hold(requestId: string) {
      let arrived!: () => void;
      let release!: () => void;
      const arrival = new Promise<void>((r) => (arrived = r));
      const released = new Promise<void>((r) => (release = r));
      holds.set(requestId, { arrived, released });
      return { arrival, release };
    },
  };
}

function recorder() {
  const tasks: Promise<void>[] = [];
  return { tasks, schedule: (task: () => Promise<void>) => void tasks.push(task()) };
}

async function stats(upstream: string): Promise<Stats> {
  return (await fetch(`${upstream}/_stats`)).json() as Promise<Stats>;
}

async function providerStatus(upstream: string, requestId: string): Promise<string> {
  const r = await fetch(`${upstream}/requests/${requestId}/status`, { headers: { Authorization: "Key gp3-probe" } });
  return ((await r.json()) as { status: string }).status;
}

async function providerReaches(upstream: string, requestId: string, want: string, withinMs: number): Promise<void> {
  const until = Date.now() + withinMs;
  while ((await providerStatus(upstream, requestId)) !== want) {
    if (Date.now() > until) throw new Error(`FAIL fake request ${requestId} did not reach ${want} within ${withinMs} ms`);
    await sleep(300);
  }
}

async function setFake(upstream: string, knobs: { mediaDelayMs?: number }): Promise<void> {
  await fetch(`${upstream}/_config`, { method: "POST", body: JSON.stringify(knobs) });
}

function objectName(id: string): string {
  return `${process.env.SUPABASE_VIDEO_BUCKET || "videos"}/${id}.mp4`;
}

async function writesOf(upstream: string, id: string): Promise<number> {
  return (await stats(upstream)).storage.byKey[objectName(id)]?.writes ?? 0;
}

function sha256(bytes: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function secondsUntilLeaseEnds(id: string): Promise<number> {
  const [row] = await getDb().execute<{ s: string }>(
    sql`select extract(epoch from mirror_next_at - now()) as s from generations where id = ${id}`,
  );
  return Number(row.s);
}

async function readRow(id: string): Promise<Generation> {
  const [row] = await getDb().select().from(schema.generations).where(eq(schema.generations.id, id)).limit(1);
  if (!row) throw new Error(`FAIL row ${id} disappeared`);
  return row;
}

async function adminUser(): Promise<User> {
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const [u] = await getDb().select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (!u) throw new Error(`FAIL user ${username} not found`);
  if (!u.apiKeyEnc) throw new Error(`FAIL ${username} has no Higgsfield key; assign one in 어드민 (the fake accepts fake:key)`);
  return u;
}

async function submit(owner: Owner, admin: User, label: string): Promise<Generation> {
  const spec = findModel(MODEL);
  if (!spec) throw new Error(`FAIL ${MODEL} missing from the catalog`);
  const row = await owner.submitGeneration(admin, {
    spec,
    prompt: `${TAG}${label}`,
    params: coerceParams(spec, {}),
    imageUrls: ["https://example.com/gp3-ref.jpg"],
    videoUrls: [],
  });
  created.push(row.id);
  return row;
}

/** Settle the row once a second, like an open tab, until it is terminal. */
async function settleUntilDone(owner: Owner, id: string, schedule: Schedule, withinMs: number): Promise<Generation> {
  const until = Date.now() + withinMs;
  for (;;) {
    const row = await owner.settle(await readRow(id), schedule);
    if (!isLive(row.status)) return row;
    if (Date.now() > until) throw new Error(`FAIL row ${id} still ${row.status} after ${withinMs} ms`);
    await sleep(1000);
  }
}

async function fiftyCallers(owner: Owner, admin: User, upstream: string) {
  const row = await submit(owner, admin, "settle 50개 동시");
  const rec = recorder();
  const seen: Generation[] = [];
  const t0 = Date.now();
  for (;;) {
    const fresh = await readRow(row.id);
    if (!isLive(fresh.status)) break;
    if (Date.now() - t0 > 60_000) throw new Error(`FAIL row still ${fresh.status} after 60 s`);
    seen.push(...(await Promise.all(Array.from({ length: 50 }, () => owner.settle(fresh, rec.schedule)))));
    await sleep(1000);
  }
  const elapsed = Date.now() - t0;
  const final = await readRow(row.id);
  const polls = (await stats(upstream)).statusPolls.byRequest[row.requestId ?? ""] ?? { total: 0, perSecondMax: 0 };
  const allowed = 1 + Math.floor(elapsed / CHECK_GAP_MS);
  check(final.status === "completed", "50 concurrent settle calls per second drive the row to completed", `${(elapsed / 1000).toFixed(1)} s, ${seen.length} calls`);
  check(polls.total >= 1 && polls.total <= allowed && polls.perSecondMax === 1, "the fake saw at most one status call per 15 s for that row", `${polls.total} calls in ${(elapsed / 1000).toFixed(1)} s, allowed ${allowed}`);
  const stamps = new Set([...seen, final].filter((g) => g.status === "completed").map((g) => g.completedAt?.toISOString()));
  const costs = new Set([...seen, final].filter((g) => g.status === "completed").map((g) => g.costUsd));
  const price = await owner.priceFor(final.modelId);
  check(stamps.size === 1, "completed_at was written once", [...stamps].join(","));
  check(costs.size === 1 && final.costUsd === (price * final.durationS).toFixed(4), "cost_usd was written once as price × duration", `${final.costUsd} = ${price} × ${final.durationS}`);
  await Promise.all(rec.tasks);
  check(rec.tasks.length === 1, "the terminal follow-up was scheduled once", `${rec.tasks.length}`);
}

async function reversedObservations(owner: Owner, admin: User, upstream: string, proxy: Proxy) {
  const row = await submit(owner, admin, "뒤바뀐 관찰");
  const requestId = row.requestId ?? "";
  const rec = recorder();
  await providerReaches(upstream, requestId, "in_progress", 10_000);
  const held = proxy.hold(requestId);
  const stale = owner.settle(row, rec.schedule);
  await held.arrival;
  await providerReaches(upstream, requestId, "completed", 6_000);
  const fresh = await owner.cancelGeneration(row, rec.schedule);
  check(fresh.status === "completed", "a refused cancel looks again and records completed while an in_progress answer is still in flight");
  held.release();
  const late = await stale;
  const final = await readRow(row.id);
  check(
    final.status === "completed" && final.completedAt?.getTime() === fresh.completedAt?.getTime(),
    "the in_progress answer that arrives after completed does not move the row back",
    `final ${final.status}, completed_at unchanged`,
  );
  check(late.status === "completed", "the late caller returns the row as it now stands, not its stale view");
  await Promise.all(rec.tasks);
  check(rec.tasks.length === 1, "the terminal follow-up was scheduled once", `${rec.tasks.length}`);
}

async function cancelRaces(owner: Owner, admin: User, upstream: string) {
  const race = async (label: string, before: (requestId: string) => Promise<void>) => {
    const row = await submit(owner, admin, `취소와 완료 경쟁: ${label}`);
    const rec = recorder();
    await before(row.requestId ?? "");
    const outcomes = await Promise.allSettled([
      owner.cancelGeneration(row, rec.schedule),
      ...Array.from({ length: 5 }, () => owner.settle(row, rec.schedule)),
    ]);
    const cancel = outcomes[0];
    const final = await settleUntilDone(owner, row.id, rec.schedule, 45_000);
    const provider = await providerStatus(upstream, row.requestId ?? "");
    await Promise.all(rec.tasks);
    const cancelSaw = cancel.status === "fulfilled" ? cancel.value.status : `error ${String(cancel.reason)}`;
    check(final.status === provider, `cancel ${label}: the row ends where the fake says`, `row ${final.status}, fake ${provider}, cancel returned ${cancelSaw}`);
    check(rec.tasks.length === 1, `cancel ${label}: the terminal follow-up was scheduled once`, `${rec.tasks.length}`);
    return final.status;
  };
  const ends = await Promise.all([
    race("while queued", async () => {}),
    race("while in_progress", (id) => providerReaches(upstream, id, "in_progress", 10_000)),
    race("at completion", (id) => providerReaches(upstream, id, "completed", 12_000)),
  ]);
  check(ends.includes("canceled") && ends.includes("completed"), "the races covered both a winning and a refused cancel", ends.join(", "));
}

async function rowWithoutRequestId(owner: Owner, admin: User, proxy: Proxy) {
  const [row] = await getDb()
    .insert(schema.generations)
    .values({
      userId: admin.id,
      modelId: MODEL,
      prompt: `${TAG}request_id 없는 생성 중 행(목업 모양)`,
      status: "in_progress",
      durationS: 6,
      costUsd: "0",
    })
    .returning();
  created.push(row.id);
  const before = proxy.requests();
  const rec = recorder();
  const settled = await Promise.all(Array.from({ length: 20 }, () => owner.settle(row, rec.schedule)));
  const cancel = await owner.cancelGeneration(row, rec.schedule).then(
    () => null,
    (e: unknown) => e as { status?: number },
  );
  const after = await readRow(row.id);
  check(proxy.requests() === before, "a live row without request_id makes zero Higgsfield calls", `${proxy.requests() - before} requests`);
  check(
    after.status === "in_progress" && after.nextCheckAt.getTime() === row.nextCheckAt.getTime() && settled.every((g) => g.status === "in_progress"),
    "and is neither written nor moved",
  );
  check(cancel?.status === 409 && rec.tasks.length === 0, "its cancel is refused with 409 and nothing is scheduled");
}

/** A completed row whose terminal follow-up never ran, as when the process dies before its after() task starts. */
async function completedWithoutCopy(owner: Owner, admin: User, label: string): Promise<Generation> {
  const row = await submit(owner, admin, label);
  const dropped: Schedule = () => {};
  const done = await settleUntilDone(owner, row.id, dropped, 30_000);
  if (done.status !== "completed" || done.storagePath || done.mirrorAttempts !== 0) {
    throw new Error(`FAIL setup: ${label} ended ${done.status}, storage_path ${done.storagePath}, attempts ${done.mirrorAttempts}`);
  }
  return done;
}

async function copyOnCompletion(owner: Owner, admin: User, upstream: string) {
  const row = await submit(owner, admin, "완료한 호출자가 복사");
  const rec = recorder();
  const until = Date.now() + 30_000;
  for (;;) {
    const settled = await Promise.all(Array.from({ length: 5 }, async () => owner.settle(await readRow(row.id), rec.schedule)));
    if (settled.some((g) => !isLive(g.status))) break;
    if (Date.now() > until) throw new Error(`FAIL row ${row.id} still live after 30 s`);
    await sleep(1000);
  }
  await Promise.all(rec.tasks);
  const final = await readRow(row.id);
  const video = owner.publicGeneration(final).video;
  check(
    rec.tasks.length === 1 && (await writesOf(upstream, row.id)) === 1,
    "of 5 settle calls per second, only the one that completed the row copied it, once",
    `${rec.tasks.length} task`,
  );
  check(final.storagePath === `${row.id}.mp4` && final.mirrorAttempts === 1 && final.mirrorError === null, "storage_path is the object key <id>.mp4 after one attempt");
  check(
    video?.kind === "stored" && video.url === `${process.env.SUPABASE_URL}/storage/v1/object/public/${objectName(row.id)}`,
    "the next read returns video.kind stored with the public object URL",
    video?.url,
  );
}

async function tenConcurrentCopies(owner: Owner, admin: User, upstream: string) {
  const row = await completedWithoutCopy(owner, admin, "storeVideo 10개 동시");
  const before = owner.publicGeneration(row).video;
  check(
    before?.kind === "provider" && before.storing && before.url.endsWith(`/media/${row.requestId}.mp4`),
    "before the copy the row plays the provider URL and says a copy is coming",
  );
  await Promise.all(Array.from({ length: 10 }, () => owner.storeVideo(row)));
  const final = await readRow(row.id);
  check(
    (await writesOf(upstream, row.id)) === 1 && final.mirrorAttempts === 1,
    "10 concurrent storeVideo calls claim once and write the key once",
    `attempts ${final.mirrorAttempts}`,
  );

  const media = await (await fetch(`${upstream}/media/${row.requestId}.mp4`)).arrayBuffer();
  const object = (await stats(upstream)).storage.byKey[objectName(row.id)];
  check(
    object.sha256 === sha256(media) && object.size === media.byteLength && final.sizeBytes === media.byteLength,
    "the stored object has the media's sha256 and size_bytes matches it",
    `${final.sizeBytes} bytes`,
  );
  const video = owner.publicGeneration(final).video;
  if (video?.kind !== "stored") throw new Error("FAIL the copied row does not report video.kind stored");
  const served = await fetch(video.url);
  check(served.ok && sha256(await served.arrayBuffer()) === object.sha256, "the public URL serves those bytes");
  const download = await fetch(video.downloadUrl);
  await download.arrayBuffer();
  check(
    video.downloadUrl.endsWith(`?download=${row.id}.mp4`) && /attachment/.test(download.headers.get("content-disposition") ?? ""),
    "downloadUrl asks for <id>.mp4 and is served as an attachment",
  );
}

async function storageOff(owner: Owner, admin: User, upstream: string) {
  const saved = STORAGE_ENV.map((k) => [k, process.env[k]] as const);
  for (const k of STORAGE_ENV) delete process.env[k];
  try {
    const row = await submit(owner, admin, "스토리지 env 없음");
    const rec = recorder();
    await settleUntilDone(owner, row.id, rec.schedule, 30_000);
    await Promise.all(rec.tasks);
    await owner.storeVideo(await readRow(row.id));
    const final = await readRow(row.id);
    const video = owner.publicGeneration(final).video;
    check(
      final.status === "completed" && final.storagePath === null && final.mirrorAttempts === 0,
      "without the storage env the copy never runs: storage_path stays null and no attempt is counted",
    );
    check((await writesOf(upstream, row.id)) === 0, "and nothing reaches the storage endpoint");
    check(video?.kind === "provider" && !video.storing && video.expiresAt !== null, "video.kind is provider with its expiry, and no copy is promised");
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
}

async function stalledCopy(owner: Owner, admin: User, upstream: string) {
  const row = await completedWithoutCopy(owner, admin, "멈춘 미디어");
  await setFake(upstream, { mediaDelayMs: 250_000 });
  const t0 = Date.now();
  let failed: Generation;
  try {
    const first = owner.storeVideo(row);
    await sleep(3000);
    const leased = await readRow(row.id);
    const ahead = await secondsUntilLeaseEnds(row.id);
    check(leased.mirrorAttempts === 1 && ahead > MIRROR_LEASE_S - 10, "the claim counts the attempt and holds the lease at least 360 s", `${ahead.toFixed(0)} s left after 3 s`);
    const downloads = (await stats(upstream)).media.downloads;
    const second = await owner.storeVideo(leased);
    check(second.mirrorAttempts === 1 && (await stats(upstream)).media.downloads === downloads, "a second caller during the lease neither claims nor downloads");
    failed = await first;
  } finally {
    await setFake(upstream, { mediaDelayMs: 0 });
  }
  const took = Date.now() - t0;
  check(
    failed.storagePath === null && /timeout|abort/i.test(failed.mirrorError ?? "") && took >= COPY_TIMEOUT_MS - 1000 && took < 250_000,
    "a 250 s media stall fails at the 240 s fetch timeout and leaves mirror_error",
    `${(took / 1000).toFixed(1)} s, mirror_error "${failed.mirrorError}"`,
  );
  check(failed.status === "completed" && failed.resultUrl === row.resultUrl, "the failure writes only media columns");
  await owner.storeVideo(failed);
  check((await readRow(row.id)).mirrorAttempts === 1, "no retry is claimed before the lease runs out");
  await getDb().execute(sql`update generations set mirror_next_at = now() where id = ${row.id}`);
  const retried = await owner.storeVideo(await readRow(row.id));
  check(
    retried.storagePath === `${row.id}.mp4` && retried.mirrorError === null && retried.mirrorAttempts === 2 && (await writesOf(upstream, row.id)) === 1,
    "after the lease runs out (mirror_next_at moved to now instead of waiting 360 s) the retry copies it and clears mirror_error",
  );
}

async function measure(owner: Owner, admin: User, upstream: string, base: string) {
  const rows = Number(process.env.MEASURE_ROWS ?? 15);
  const seconds = Number(process.env.MEASURE_SECONDS ?? 60);
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("FAIL ADMIN_PASSWORD is not set");
  const mine: Generation[] = [];
  for (let i = 0; i < rows; i++) mine.push(await submit(owner, admin, `측정 ${i + 1}/${rows}`));
  const g = schema.generations;
  const feed = await getDb().select({ id: g.id }).from(g).where(eq(g.userId, admin.id)).orderBy(g.createdAt).then((r) => r.map((x) => x.id));
  const newest = feed.slice(-12);
  const foreign = newest.filter((id) => !created.includes(id));
  if (foreign.length) throw new Error(`FAIL the feed's 12 newest rows include ${foreign.length} rows this run did not create`);

  const harness = resolve(".claude/skills/verify-video-gen-studio/node_modules/playwright/index.mjs");
  const { chromium } = (await import(pathToFileURL(harness).href)) as { chromium: Chromium };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.VGS_CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/login?next=/gallery`);
  await page.getByLabel("ID").fill(admin.username);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => u.pathname === "/gallery");
  const hits: { t: number; path: string; status: number }[] = [];
  page.on("response", (res) => {
    const u = new URL(res.url());
    if (res.request().method() === "GET" && u.pathname.startsWith("/api/generations")) hits.push({ t: Date.now(), path: u.pathname + u.search, status: res.status() });
  });
  const t0 = Date.now();
  await page.goto(`${base}/playground`);
  await page.waitForTimeout(seconds * 1000 - (Date.now() - t0));
  await browser.close();

  const inWindow = hits.filter((h) => h.t - t0 <= seconds * 1000);
  const s = await stats(upstream);
  const perRow = mine.map((r) => s.statusPolls.byRequest[r.requestId ?? ""]?.total ?? 0);
  const stillLive = (await getDb().select({ status: g.status }).from(g).where(inArray(g.id, mine.map((r) => r.id)))).filter((r) => isLive(r.status)).length;
  const report = {
    base,
    rows,
    seconds,
    appRequests: inWindow.length,
    feed: inWindow.filter((h) => h.path.includes("limit=")).length,
    batched: inWindow.filter((h) => h.path.includes("ids=")).length,
    perItem: inWindow.filter((h) => /^\/api\/generations\/[^?]+/.test(h.path)).length,
    non200: inWindow.filter((h) => h.status !== 200).length,
    statusCalls: perRow.reduce((a, b) => a + b, 0),
    statusCallsPerRowMax: Math.max(...perRow),
    rowsPolledByFake: perRow.filter((n) => n > 0).length,
    rowsStillLive: stillLive,
    firstPaths: [...new Set(inWindow.map((h) => h.path.replace(/[0-9a-f-]{36}/g, "<id>")))].slice(0, 4),
  };
  console.log(`MEASURE ${JSON.stringify(report)}`);
  if (report.feed === 0) throw new Error("FAIL the playground never loaded its feed, so the window measured nothing");
}

async function main() {
  const measureAt = process.argv.indexOf("--measure");
  const base = measureAt >= 0 ? process.argv[measureAt + 1] : null;
  if (measureAt >= 0 && (!base || !process.env.HIGGSFIELD_BASE_URL)) {
    throw new Error("FAIL --measure needs a base URL and the HIGGSFIELD_BASE_URL that app uses");
  }
  let ownFake: Server | null = null;
  let upstream = process.env.HIGGSFIELD_BASE_URL;
  if (!upstream) {
    ownFake = createFakeHiggsfield(configFromEnv(process.env));
    upstream = await listen(ownFake);
  }
  const proxy = base ? null : startProxy(upstream);
  if (proxy) {
    const storageUrl = process.env.SUPABASE_URL;
    if (!storageUrl) {
      process.env.SUPABASE_URL = upstream;
      process.env.SUPABASE_SERVICE_ROLE_KEY ||= "fake";
    } else if (new URL(storageUrl).origin !== new URL(upstream).origin) {
      throw new Error(`FAIL SUPABASE_URL is ${new URL(storageUrl).origin}; the copy checks write test objects, so point it at the fake ${upstream}`);
    }
  }
  process.env.HIGGSFIELD_BASE_URL = proxy ? await listen(proxy.server) : upstream;
  const owner: Owner = await import("../src/lib/generations");
  const admin = await adminUser();
  console.log(`fake ${ownFake ? `in-process at ${upstream}` : upstream}, owner talks to ${process.env.HIGGSFIELD_BASE_URL}`);
  try {
    if (!proxy) {
      await measure(owner, admin, upstream, base ?? "");
    } else {
      await fiftyCallers(owner, admin, upstream);
      await reversedObservations(owner, admin, upstream, proxy);
      await cancelRaces(owner, admin, upstream);
      await rowWithoutRequestId(owner, admin, proxy);
      await copyOnCompletion(owner, admin, upstream);
      await tenConcurrentCopies(owner, admin, upstream);
      await storageOff(owner, admin, upstream);
      await stalledCopy(owner, admin, upstream);
      console.log(`all checks passed (${proxy.requests()} Higgsfield requests went through the counter)`);
    }
  } finally {
    const removed = created.length
      ? await getDb().delete(schema.generations).where(inArray(schema.generations.id, created)).returning({ id: schema.generations.id })
      : [];
    console.log(`removed ${removed.length} ${TAG.trim()} rows`);
    proxy?.server.close();
    ownFake?.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
