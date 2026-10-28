/**
 * Checks the promises of src/lib/generations.ts against a fake Higgsfield and the .env.local database.
 *
 *   npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts
 *   npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts --triggers
 *   npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts --submits
 *   HIGGSFIELD_BASE_URL=http://localhost:4010 SUPABASE_URL=http://localhost:4010 SUPABASE_SERVICE_ROLE_KEY=fake npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts
 *   HIGGSFIELD_BASE_URL=http://localhost:4010 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts --measure http://localhost:3100
 *
 * Without HIGGSFIELD_BASE_URL it starts its own fake (scripts/fake-higgsfield.ts). The copy checks upload to the same
 * fake's Supabase Storage subset: SUPABASE_URL is set to the fake when unset and refused when it points anywhere else.
 * The rows it creates belong to ADMIN_USERNAME, whose Higgsfield key must be set (the fake accepts any key), carry
 * prompts starting with "GP-6 ", and are deleted before it exits. It exits non-zero at the first failed check.
 * The stalled-copy check waits out the 240 s fetch timeout, so a full run takes about seven minutes.
 * If the test model's price is 0 it sets 0.0123 USD/s for the cost check and restores the stored price afterwards.
 *
 * The submit checks (--submits runs only those) drive pending rows: a lost accept, 429s, the deadline, cancel during
 * and after a submit, a 422 body mismatch, and a submitter killed after the fake accepted (a child process of this
 * script, started with --submit-once, killed by the proxy's tap).
 *
 * The webhook and sweep checks (--triggers runs only those) point PUBLIC_BASE_URL at a receiver inside this process
 * that answers like src/app/api/hooks/higgsfield/route.ts, so the fake's webhooks reach the owner without a server.
 * The earlier checks run with PUBLIC_BASE_URL unset, because a webhook would add status calls they count.
 * sweep settles every due row in the database, so each sweep check first refuses to run while any row this run did
 * not create could be due.
 *
 * --measure <base> inserts 15 live rows, keeps /playground of the app at <base> open for 60 s in a headless browser
 * (Playwright from the verify-video-gen-studio skill), and prints the app requests and the fake's status calls.
 * The app at <base> must use the same HIGGSFIELD_BASE_URL, and the fake's FAKE_HF_DURATION_MS must outlast the window.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, desc, eq, gt, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import type { Generation, User } from "../src/db/schema";
import { coerceParams, findModel } from "../src/lib/catalog";
import { signToken } from "../src/lib/crypto";
import { isLive, LIVE_STATUSES } from "../src/lib/generation-status";
import { configFromEnv, createFakeHiggsfield, type Config } from "./fake-higgsfield";

type Owner = typeof import("../src/lib/generations");
type Proxy = ReturnType<typeof startProxy>;
type Hooks = ReturnType<typeof startHookReceiver>;
type Stats = {
  accepted: { byIdempotencyKey: Record<string, number> };
  rejected: { 429: number; 422: number; 503: number };
  statusPolls: { byRequest: Record<string, { total: number; perSecondMax: number }>; byApiKey: Record<string, number> };
  webhooks: { sent: number; dropped: number; failed: number; retried: number; byRequest: Record<string, number[]> };
  media: { downloads: number };
  storage: { byKey: Record<string, { writes: number; size: number; sha256: string }> };
};
type Knobs = Partial<
  Pick<
    Config,
    | "mediaDelayMs"
    | "storageFailN"
    | "statusFailN"
    | "dropWebhooks"
    | "dupWebhooks"
    | "firstN429"
    | "retryAfterS"
    | "submitFailN"
    | "submitDelayMs"
  >
>;
type SubmitSeen = { key: string; status: number; requestId: string };
type TapReply = { status: number; retryAfterS: number } | "hang-up";
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

const TAG = "GP-6 ";
const SWEEP_BUDGET_MS = 240_000;
const HOOK_HTTP = { done: 204, unauthorized: 401, retry: 503 } as const;
const MODEL = "minimax/hailuo-2.3/standard/image-to-video";
const CHECK_GAP_MS = 15_000;
const MIRROR_LEASE_S = 360;
const SUBMIT_LEASE_S = 30;
const DEADLINE_ERROR = "Higgsfield가 30분 동안 요청을 받지 않았습니다";
const COPY_TIMEOUT_MS = 240_000;
const STORAGE_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const TEST_PRICE = "0.0123";
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
 * It can also tap the next submit: the fake gets it and answers, the test sees that answer, and the owner gets the
 * reply the test picks instead, or a hung-up connection. That is how a lost accept and a crashed submitter look.
 */
function startProxy(target: string) {
  let requests = 0;
  const holds = new Map<string, { arrived: () => void; released: Promise<void> }>();
  let tap: { seen: (s: SubmitSeen) => void; reply: Promise<TapReply> } | null = null;
  const server = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url ?? "/", target);
    const body = await readAll(req);
    const upstream = await fetch(url, { method: req.method, headers: forwardable(req.headers), body: body.length ? new Uint8Array(body) : undefined });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const key = req.headers["idempotency-key"];
    if (req.method === "POST" && typeof key === "string" && tap) {
      const t = tap;
      tap = null;
      const requestId = String((JSON.parse(bytes.toString("utf8") || "{}") as { request_id?: unknown }).request_id ?? "");
      t.seen({ key, status: upstream.status, requestId });
      const reply = await t.reply;
      if (reply === "hang-up") return void res.destroy();
      res
        .writeHead(reply.status, { "content-type": "application/json", "retry-after": String(reply.retryAfterS) })
        .end(JSON.stringify({ detail: "lifecycle-check replaced this answer" }));
      return;
    }
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
    tapNextSubmit() {
      let seen!: (s: SubmitSeen) => void;
      let reply!: (r: TapReply) => void;
      const answered = new Promise<SubmitSeen>((r) => (seen = r));
      tap = { seen, reply: new Promise<TapReply>((r) => (reply = r)) };
      return { answered, reply };
    },
  };
}

function recorder() {
  const tasks: Promise<void>[] = [];
  return { tasks, schedule: (task: () => Promise<void>) => void tasks.push(task()) };
}

/**
 * price × duration proves nothing at price 0, and the shared models table starts at 0 for every model. When the
 * model's price is 0, run with TEST_PRICE and put the stored value back afterwards.
 */
async function withKnownPrice<T>(modelId: string, run: () => Promise<T>): Promise<T> {
  const m = schema.models;
  const [row] = await getDb().select().from(m).where(eq(m.modelId, modelId)).limit(1);
  if (!row) throw new Error(`FAIL models row for ${modelId} missing; run npm run db:seed`);
  if (Number(row.pricePerSecUsd) > 0) return run();
  await getDb().update(m).set({ pricePerSecUsd: TEST_PRICE }).where(eq(m.modelId, modelId));
  try {
    return await run();
  } finally {
    await getDb().update(m).set({ pricePerSecUsd: row.pricePerSecUsd }).where(eq(m.modelId, modelId));
  }
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

async function setFake(upstream: string, knobs: Knobs): Promise<void> {
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

async function secondsUntilNextCheck(id: string): Promise<number> {
  const [row] = await getDb().execute<{ s: string }>(
    sql`select extract(epoch from next_check_at - now()) as s from generations where id = ${id}`,
  );
  return Number(row.s);
}

async function acceptedFor(upstream: string, key: string): Promise<number> {
  return (await stats(upstream)).accepted.byIdempotencyKey[key] ?? 0;
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
  }, (task) => void task());
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
  check(price > 0 && costs.size === 1 && final.costUsd === (price * final.durationS).toFixed(4), "cost_usd was written once as a non-zero price × duration", `${final.costUsd} = ${price} × ${final.durationS}`);
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

async function cancelAfterAnotherCallerFinished(owner: Owner, admin: User, upstream: string) {
  const snapshot = await submit(owner, admin, "끝난 뒤 취소");
  const rec = recorder();
  await providerReaches(upstream, snapshot.requestId ?? "", "completed", 12_000);
  await settleUntilDone(owner, snapshot.id, rec.schedule, 20_000);
  const answer = await owner.cancelGeneration(snapshot, rec.schedule);
  check(
    answer.status === "completed",
    "a refused cancel returns the row as it stands now, not the queued row the route read before another caller finished it",
    `returned ${answer.status}`,
  );
  await Promise.all(rec.tasks);
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

/** Answers webhooks the way src/app/api/hooks/higgsfield/route.ts does, with a recorder in place of after(). */
function startHookReceiver(owner: Owner) {
  const rec = recorder();
  const server = createServer(async (req, res) => {
    await readAll(req);
    try {
      const outcome = await owner.onProviderHook(new URL(req.url ?? "/", "http://receiver.local"), rec.schedule);
      res.writeHead(HOOK_HTTP[outcome]).end();
    } catch (e) {
      console.error(`hook receiver: ${e instanceof Error ? e.message : e}`);
      res.writeHead(500).end();
    }
  });
  return { server, rec };
}

function hookUrlFor(id: string, token = signToken("hf-hook", id)): URL {
  return new URL(`${process.env.PUBLIC_BASE_URL}/api/hooks/higgsfield?g=${id}&t=${token}`);
}

function statusCalls(s: Stats, requestId: string | null): number {
  return s.statusPolls.byRequest[requestId ?? ""]?.total ?? 0;
}

/** The HTTP status of each webhook delivery for one request, in order, once there are at least `n`. */
async function deliveries(upstream: string, requestId: string, n: number, withinMs: number): Promise<number[]> {
  const until = Date.now() + withinMs;
  for (;;) {
    const codes = (await stats(upstream)).webhooks.byRequest[requestId] ?? [];
    if (codes.length >= n) return codes;
    if (Date.now() > until) throw new Error(`FAIL request ${requestId} got ${codes.length} of ${n} webhook deliveries in ${withinMs} ms`);
    await sleep(250);
  }
}

async function withKnobs<T>(upstream: string, knobs: Knobs, reset: Knobs, run: () => Promise<T>): Promise<T> {
  await setFake(upstream, knobs);
  try {
    return await run();
  } finally {
    await setFake(upstream, reset);
  }
}

async function submitWithoutHook(owner: Owner, admin: User, label: string): Promise<Generation> {
  const base = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  try {
    return await submit(owner, admin, label);
  } finally {
    process.env.PUBLIC_BASE_URL = base;
  }
}

async function removeCreated(): Promise<number> {
  if (created.length === 0) return 0;
  const g = schema.generations;
  const removed = await getDb().delete(g).where(inArray(g.id, created)).returning({ id: g.id });
  created.length = 0;
  return removed.length;
}

/**
 * sweep settles every due row of every user, and a row the fake does not know turns failed. Refuse to sweep while a
 * row this run did not create is pending, is live with a request id, or is an unstored, unexpired result, whatever its
 * clocks say.
 */
async function assertSweepScope(): Promise<void> {
  const g = schema.generations;
  const foreign = await getDb()
    .select({ id: g.id, status: g.status, prompt: g.prompt })
    .from(g)
    .where(
      and(
        or(
          eq(g.status, "pending"),
          and(
            isNotNull(g.requestId),
            or(
              inArray(g.status, LIVE_STATUSES),
              and(eq(g.status, "completed"), isNull(g.storagePath), isNotNull(g.resultUrl), or(isNull(g.expiresAt), gt(g.expiresAt, sql`now()`))),
            ),
          ),
        ),
        created.length > 0 ? notInArray(g.id, created) : undefined,
      ),
    );
  if (foreign.length > 0) {
    const sample = foreign.slice(0, 5).map((r) => `${r.id} ${r.status} "${r.prompt.slice(0, 30)}"`).join("; ");
    throw new Error(`FAIL refusing to sweep: ${foreign.length} rows this run did not create could be due: ${sample}`);
  }
}

function sweepDeadline() {
  return { deadline: Date.now() + SWEEP_BUDGET_MS };
}

async function hookRefusals(owner: Owner, admin: User, proxy: Proxy) {
  const row = await submitWithoutHook(owner, admin, "훅 거절");
  const [bare] = await getDb()
    .insert(schema.generations)
    .values({ userId: admin.id, modelId: MODEL, prompt: `${TAG}request_id 없는 행의 훅`, status: "in_progress", durationS: 6, costUsd: "0" })
    .returning();
  created.push(bare.id);
  const before = proxy.requests();
  const token = signToken("hf-hook", row.id);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const post = (url: URL) => fetch(url, { method: "POST", body: JSON.stringify({ status: "completed" }) }).then((r) => r.status);
  const refused = [await post(hookUrlFor(row.id, tampered)), await post(hookUrlFor(row.id, signToken("hf-hook", bare.id)))];
  check(refused.every((c) => c === 401), "a webhook with a tampered token, or with another row's token, gets 401", refused.join(","));
  const noRequestId = await post(hookUrlFor(bare.id));
  check(noRequestId === 503, "a webhook for a live row without request_id gets 503, so Higgsfield delivers it again");
  const missing = await owner.onProviderHook(hookUrlFor(randomUUID()), recorder().schedule);
  check(missing === "done", "a webhook for a row that does not exist answers done (204), since rows are inserted before Higgsfield sees their id", missing);
  const after = await readRow(row.id);
  check(
    proxy.requests() === before && after.status === row.status && after.nextCheckAt.getTime() === row.nextCheckAt.getTime(),
    "none of them made a Higgsfield call or wrote the row",
    `${proxy.requests() - before} requests`,
  );
}

async function oneWebhookNoPoll(owner: Owner, admin: User, upstream: string, hooks: Hooks) {
  const before = hooks.rec.tasks.length;
  const row = await submit(owner, admin, "웹훅 한 번, 폴링 없음");
  const codes = await deliveries(upstream, row.requestId ?? "", 1, 20_000);
  await Promise.all(hooks.rec.tasks);
  const final = await readRow(row.id);
  const price = await owner.priceFor(final.modelId);
  check(
    codes.join() === "204" && final.status === "completed" && final.storagePath === `${row.id}.mp4`,
    "with no poll at all, one webhook completes the row and its after() copy stores it",
    `deliveries ${codes.join(",")}`,
  );
  check(
    statusCalls(await stats(upstream), row.requestId) === 1 && hooks.rec.tasks.length - before === 1,
    "the fake saw only the hook's one status call, and the follow-up was scheduled once",
  );
  check(price > 0 && final.costUsd === (price * final.durationS).toFixed(4), "the webhook recorded cost_usd as price × duration", `${final.costUsd}`);
}

async function duplicateWebhooks(owner: Owner, admin: User, upstream: string, hooks: Hooks) {
  await withKnobs(upstream, { dupWebhooks: true }, { dupWebhooks: false }, async () => {
    const before = hooks.rec.tasks.length;
    const row = await submit(owner, admin, "중복 웹훅");
    const codes = await deliveries(upstream, row.requestId ?? "", 2, 20_000);
    await Promise.all(hooks.rec.tasks);
    const final = await readRow(row.id);
    check(codes.join() === "204,204", "both deliveries of a duplicated webhook get 204", codes.join(","));
    check(
      hooks.rec.tasks.length - before === 1 && final.mirrorAttempts === 1 && (await writesOf(upstream, row.id)) === 1,
      "the two webhooks made one transition: one follow-up, one copy claim, one upload",
      `${hooks.rec.tasks.length - before} follow-up, completed_at ${final.completedAt?.toISOString()}`,
    );
  });
}

/**
 * Another caller completes the row after the webhook read it and before the webhook's forced claim: a row lock holds
 * the claim while the row moves, as when a duplicate delivery loses the race. The webhook must judge the row as it
 * stands, not as it read it.
 */
async function hookAfterAnotherCallerFinished(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0 }, async () => {
    const row = await submit(owner, admin, "읽은 뒤 다른 호출자가 끝낸 행의 훅");
    const callsBefore = statusCalls(await stats(upstream), row.requestId);
    const pending: Promise<string>[] = [];
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select id from generations where id = ${row.id} for update`);
      pending.push(owner.onProviderHook(hookUrlFor(row.id), recorder().schedule));
      await sleep(1000);
      await tx.execute(sql`update generations set status = 'completed', completed_at = now() where id = ${row.id}`);
    });
    const outcome = await pending[0];
    check(outcome === "done", "a webhook whose row another caller completed between its read and its claim answers done, not 503", outcome);
    check(statusCalls(await stats(upstream), row.requestId) === callsBefore, "and asks Higgsfield nothing");
  });
}

async function redeliveryAfter503(owner: Owner, admin: User, upstream: string, hooks: Hooks) {
  await withKnobs(upstream, { statusFailN: 1 }, { statusFailN: 0 }, async () => {
    const row = await submit(owner, admin, "503 뒤 재전송");
    const codes = await deliveries(upstream, row.requestId ?? "", 2, 30_000);
    await Promise.all(hooks.rec.tasks);
    const final = await readRow(row.id);
    check(
      codes.join() === "503,204" && final.status === "completed" && final.storagePath === `${row.id}.mp4`,
      "a webhook whose status call fails gets 503, and the redelivery completes and stores the row",
      codes.join(","),
    );
  });
}

async function sweepTicks(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0 }, async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, (_, i) => submit(owner, admin, `웹훅 유실 ${i + 1}/5`)));
    await assertSweepScope();
    const tick1 = Date.now();
    const [a, b] = await Promise.all([owner.sweep(sweepDeadline()), owner.sweep(sweepDeadline())]);
    const s1 = await stats(upstream);
    const calls = rows.map((r) => statusCalls(s1, r.requestId));
    check(
      calls.every((n) => n === 1) && a.checked + b.checked === rows.length,
      "two overlapping sweeps asked Higgsfield once per row",
      `status calls ${calls.join(",")}, checked ${a.checked} + ${b.checked}`,
    );
    const live = (await Promise.all(rows.map((r) => readRow(r.id)))).filter((g) => isLive(g.status)).length;
    await Promise.all(rows.map((r) => providerReaches(upstream, r.requestId ?? "", "completed", 12_000)));
    await sleep(Math.max(0, tick1 + CHECK_GAP_MS + 1000 - Date.now()));
    await assertSweepScope();
    const tick2 = await owner.sweep(sweepDeadline());
    const final = await Promise.all(rows.map((r) => readRow(r.id)));
    const dropped = (await stats(upstream)).webhooks.dropped;
    const writes = await Promise.all(rows.map((r) => writesOf(upstream, r.id)));
    check(
      final.every((g) => g.status === "completed" && g.storagePath === `${g.id}.mp4`) && dropped >= rows.length,
      "with every webhook dropped, the next sweep completes and stores every row",
      JSON.stringify(tick2),
    );
    check(writes.every((n) => n === 1), "each row was uploaded once", `writes ${writes.join(",")}`);
    check(
      tick2.checked === live && tick2.moved === live && tick2.stored === live && a.failures + b.failures + tick2.failures === 0 && !tick2.truncated,
      `that sweep reports checked, moved and stored ${live}, no failure, and truncated false`,
    );
  });
}

/**
 * The poll claims the check and asks first, but its answer is held until the webhook has completed the row, so the
 * poll's apply matches zero rows. Only the caller that moved the row may schedule the follow-up.
 */
async function pollAnsweredAfterHook(owner: Owner, admin: User, upstream: string, proxy: Proxy) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0 }, async () => {
    const row = await submit(owner, admin, "웹훅 뒤에 도착한 폴링 답");
    const requestId = row.requestId ?? "";
    await providerReaches(upstream, requestId, "completed", 12_000);
    const rec = recorder();
    const held = proxy.hold(requestId);
    const late = owner.settle(row, rec.schedule);
    await held.arrival;
    const hook = await owner.onProviderHook(hookUrlFor(row.id), rec.schedule);
    held.release();
    const polled = await late;
    await Promise.all(rec.tasks);
    const final = await readRow(row.id);
    check(
      hook === "done" && polled.status === "completed" && polled.completedAt?.getTime() === final.completedAt?.getTime(),
      "a poll answer that arrives after the webhook completed the row returns the row as it stands, completed_at unchanged",
    );
    check(
      rec.tasks.length === 1 && final.mirrorAttempts === 1 && (await writesOf(upstream, row.id)) === 1,
      "only the webhook, which moved the row, scheduled the follow-up: one follow-up, one copy claim, one upload",
      `${rec.tasks.length} follow-ups`,
    );
  });
}

async function hookPollSweepRace(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0 }, async () => {
    const row = await submit(owner, admin, "훅, 폴링, sweep 동시");
    await providerReaches(upstream, row.requestId ?? "", "completed", 12_000);
    await assertSweepScope();
    const rec = recorder();
    const [hook, polled, report] = await Promise.all([
      owner.onProviderHook(hookUrlFor(row.id), rec.schedule),
      owner.settle(row, rec.schedule),
      owner.sweep(sweepDeadline()),
    ]);
    await Promise.all(rec.tasks);
    const final = await readRow(row.id);
    const stamps = new Set([polled, final].filter((g) => g.status === "completed").map((g) => g.completedAt?.toISOString()));
    check(
      hook === "done" && final.status === "completed" && stamps.size === 1,
      "a webhook, a poll and a sweep on the same finished row end completed with one completed_at",
      `hook ${hook}, poll returned ${polled.status}, sweep moved ${report.moved}`,
    );
    check(
      rec.tasks.length <= 1 && final.storagePath === `${row.id}.mp4` && (await writesOf(upstream, row.id)) === 1 && report.failures === 0,
      "and the row was uploaded once",
      `${rec.tasks.length} follow-up from the hook or the poll`,
    );
  });
}

async function sweepCopies(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0, storageFailN: 0 }, async () => {
    const [alone, raced, failing] = await Promise.all([
      completedWithoutCopy(owner, admin, "sweep 복사: after() 복사가 사라진 행"),
      completedWithoutCopy(owner, admin, "sweep 복사: after() 복사와 경쟁"),
      completedWithoutCopy(owner, admin, "sweep 복사: 실패 뒤 재시도"),
    ]);
    await setFake(upstream, { storageFailN: 1 });
    const failed = await owner.storeVideo(failing);
    if (!failed.mirrorError || failed.storagePath) throw new Error("FAIL setup: the first copy did not fail");
    await getDb().execute(sql`update generations set mirror_next_at = now() where id = ${failing.id}`);
    const [mock] = await getDb()
      .insert(schema.generations)
      .values({
        userId: admin.id,
        modelId: MODEL,
        prompt: `${TAG}목업 모양 완료 행`,
        status: "completed",
        resultUrl: "/mock/result-landscape.webm",
        durationS: 6,
        costUsd: "0",
        completedAt: new Date(),
      })
      .returning();
    created.push(mock.id);
    await assertSweepScope();
    const [, report] = await Promise.all([owner.storeVideo(raced), owner.sweep(sweepDeadline())]);
    await owner.storeVideo(mock);
    const [a, r, f, m] = await Promise.all([alone, raced, failing, mock].map((g) => readRow(g.id)));
    check(a.storagePath === `${a.id}.mp4` && a.mirrorAttempts === 1, "the sweep copies a completed row whose after() copy never ran");
    check(
      r.storagePath === `${r.id}.mp4` && r.mirrorAttempts === 1 && (await writesOf(upstream, r.id)) === 1,
      "a sweep racing an after() copy of the same row uploads it once",
    );
    check(
      f.storagePath === `${f.id}.mp4` && f.mirrorError === null && f.mirrorAttempts === 2,
      "the sweep retries a failed copy once its lease ran out, and clears mirror_error",
    );
    const mockVideo = owner.publicGeneration(m).video;
    check(
      m.storagePath === null && m.mirrorAttempts === 0 && m.mirrorError === null && (await writesOf(upstream, m.id)) === 0,
      "a completed row without request_id (the mock shape) is claimed by neither the sweep nor a direct storeVideo",
    );
    check(mockVideo?.kind === "provider" && !mockVideo.storing, "and it promises no copy, so the playground does not keep polling it");
    check(report.failures === 0 && report.stored >= 2 && !report.truncated, "the sweep reports the copies and no failure", JSON.stringify(report));
  });
}

async function sweepPastDeadline(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { dropWebhooks: 1 }, { dropWebhooks: 0 }, async () => {
    const row = await submit(owner, admin, "deadline 지난 sweep");
    await assertSweepScope();
    const report = await owner.sweep({ deadline: Date.now() - 1 });
    check(
      report.truncated && report.checked === 0 && statusCalls(await stats(upstream), row.requestId) === 0,
      "a sweep past its deadline starts no row and reports truncated",
      JSON.stringify(report),
    );
  });
}

/** Wait for the row a submit in flight has inserted, found by its unique prompt. */
async function insertedRow(label: string, withinMs: number): Promise<Generation> {
  const g = schema.generations;
  const until = Date.now() + withinMs;
  for (;;) {
    const [row] = await getDb()
      .select()
      .from(g)
      .where(and(eq(g.prompt, `${TAG}${label}`), eq(g.status, "pending")))
      .orderBy(desc(g.createdAt))
      .limit(1);
    if (row) return row;
    if (Date.now() > until) throw new Error(`FAIL no row "${TAG}${label}" within ${withinMs} ms`);
    await sleep(100);
  }
}

async function firstCheckDue(owner: Owner, admin: User) {
  const row = await submit(owner, admin, "수락 직후 첫 조회 시각");
  const ahead = await secondsUntilNextCheck(row.id);
  check(row.status === "queued" && ahead <= 0, "a row Higgsfield just accepted is due for its first status check by the database's clock", `${ahead.toFixed(2)} s ahead`);
}

async function lostAcceptResent(owner: Owner, admin: User, upstream: string, proxy: Proxy) {
  const tap = proxy.tapNextSubmit();
  const submitting = submit(owner, admin, "답을 잃은 제출");
  const seen = await tap.answered;
  tap.reply({ status: 503, retryAfterS: 6 });
  const row = await submitting;
  check(
    seen.status === 200 && seen.requestId !== "" && row.status === "pending" && row.requestId === null && /503/.test(row.error ?? ""),
    "a submit the fake accepted but whose answer was lost (503) leaves the row pending, with no request_id and the reason recorded",
    row.error ?? "",
  );
  const wait = await secondsUntilNextCheck(row.id);
  check(wait > 4 && wait <= 6, "the row waits out Retry-After 6 s before anyone sends it again", `${wait.toFixed(1)} s`);
  const rec = recorder();
  const before = proxy.requests();
  const early = await owner.settle(row, rec.schedule);
  check(proxy.requests() === before && early.status === "pending", "a poll during the wait sends nothing");
  await sleep(wait * 1000 + 300);
  const resent = await owner.settle(await readRow(row.id), rec.schedule);
  check(
    resent.status !== "pending" && resent.requestId === seen.requestId && resent.error === null,
    "the poll after the wait sends the same key and body and gets the original request_id back",
    `${resent.status} ${resent.requestId}`,
  );
  check((await acceptedFor(upstream, row.id)) === 1, "the fake accepted that Idempotency-Key once");
  const final = await settleUntilDone(owner, row.id, rec.schedule, 30_000);
  await Promise.all(rec.tasks);
  check(final.status === "completed" && final.requestId === seen.requestId, "and the row completes under that request_id");
}

async function rateLimitedThenAccepted(owner: Owner, admin: User, upstream: string) {
  await withKnobs(upstream, { firstN429: 2, retryAfterS: 5 }, { firstN429: 0, retryAfterS: 5 }, async () => {
    const before = (await stats(upstream)).rejected[429];
    const row = await submit(owner, admin, "429 두 번 뒤 수락");
    check(row.status === "pending" && /429/.test(row.error ?? ""), "a 429 on submit leaves the row pending with the reason, not an error to the user", row.error ?? "");
    const rec = recorder();
    const seen = new Set<string>([row.status]);
    const until = Date.now() + 60_000;
    let now = row;
    while (isLive(now.status)) {
      if (Date.now() > until) throw new Error(`FAIL row ${row.id} still ${now.status} after 60 s`);
      await sleep(1000);
      now = await owner.settle(await readRow(row.id), rec.schedule);
      seen.add(now.status);
    }
    await Promise.all(rec.tasks);
    const s = await stats(upstream);
    check(
      now.status === "completed" && s.rejected[429] - before === 2 && s.accepted.byIdempotencyKey[row.id] === 1,
      "polls resend it after each Retry-After until the fake accepts it once, and it completes",
      `statuses ${[...seen].join(" -> ")}, 429s ${s.rejected[429] - before}`,
    );
  });
}

async function cancelPending(owner: Owner, admin: User, upstream: string, proxy: Proxy) {
  const rec = recorder();
  const label = "제출 중 취소";
  const inflight = await withKnobs(upstream, { submitDelayMs: 4000 }, { submitDelayMs: 0 }, async () => {
    const submitting = submit(owner, admin, label);
    const row = await insertedRow(label, 3000);
    const refused = await owner.cancelGeneration(row, rec.schedule).then(
      () => null,
      (e: unknown) => e as { status?: number; message?: string },
    );
    check(refused?.status === 409 && /제출 중/.test(refused.message ?? ""), "a cancel while the submit is in flight answers 409 제출 중", refused?.message);
    return submitting;
  });
  check(inflight.status === "queued" && inflight.requestId !== null, "and the submit it refused to race lands as queued");

  const waiting = await withKnobs(upstream, { firstN429: 1, retryAfterS: 30 }, { firstN429: 0, retryAfterS: 5 }, () =>
    submit(owner, admin, "429 대기 중 취소"),
  );
  check(waiting.status === "pending" && (await secondsUntilNextCheck(waiting.id)) > 20, "a 429 leaves the row pending for Retry-After 30 s");
  const before = proxy.requests();
  const canceled = await owner.cancelGeneration(waiting, rec.schedule);
  await getDb().execute(sql`update generations set next_check_at = now() where id = ${waiting.id}`);
  const later = await owner.settle(await readRow(waiting.id), rec.schedule);
  await Promise.all(rec.tasks);
  check(
    canceled.status === "canceled" && later.status === "canceled" && proxy.requests() === before && (await acceptedFor(upstream, waiting.id)) === 0,
    "a pending row waiting out a deferral cancels at once, is never sent afterwards, and the fake never accepted it",
  );
}

async function bodyMismatch(owner: Owner, admin: User, upstream: string) {
  const row = await withKnobs(upstream, { firstN429: 1, retryAfterS: 5 }, { firstN429: 0, retryAfterS: 5 }, () =>
    submit(owner, admin, "본문이 다른 재제출"),
  );
  if (row.status !== "pending") throw new Error(`FAIL setup: the first submit ended ${row.status}`);
  const other = await fetch(`${upstream}/${MODEL}`, {
    method: "POST",
    headers: { Authorization: "Key gp6-probe", "Content-Type": "application/json", "Idempotency-Key": row.id },
    body: JSON.stringify({ prompt: "다른 본문" }),
  });
  if (!other.ok) throw new Error(`FAIL setup: the probe submit got ${other.status}`);
  const before = (await stats(upstream)).rejected[422];
  await sleep((await secondsUntilNextCheck(row.id)) * 1000 + 300);
  const rec = recorder();
  const failed = await owner.settle(await readRow(row.id), rec.schedule);
  await Promise.all(rec.tasks);
  check(
    failed.status === "failed" && /422/.test(failed.error ?? "") && Number(failed.costUsd) === 0 && (await stats(upstream)).rejected[422] === before + 1,
    "a resend whose body differs from the one Higgsfield holds for the key gets 422, and the row fails with that reason at no cost",
    failed.error ?? "",
  );
  check(rec.tasks.length === 1, "the failed row's follow-up was scheduled once");
}

async function submitDeadline(owner: Owner, admin: User, proxy: Proxy) {
  const insert = async (label: string, extra: { status: Generation["status"]; nextCheckAt?: SQL; error?: string }) => {
    const [row] = await getDb()
      .insert(schema.generations)
      .values({ userId: admin.id, modelId: MODEL, prompt: `${TAG}${label}`, durationS: 6, costUsd: "0", createdAt: sql`now() - interval '31 minutes'`, ...extra })
      .returning();
    created.push(row.id);
    return row;
  };
  const due = await insert("31분 된 제출 대기", { status: "pending", nextCheckAt: sql`now()` });
  const leased = await insert("31분 된 제출 대기, lease 중", { status: "pending", nextCheckAt: sql`now() + make_interval(secs => ${SUBMIT_LEASE_S})` });
  const swept = await insert("31분 된 제출 대기, sweep이 처리", { status: "pending", nextCheckAt: sql`now()`, error: "Higgsfield 429: Too many requests" });
  const mock = await insert("31분 된 목업 모양 생성 중 행", { status: "in_progress" });
  const before = proxy.requests();
  const rec = recorder();
  const failed = await owner.settle(due, rec.schedule);
  check(
    failed.status === "failed" && failed.error === DEADLINE_ERROR && failed.completedAt !== null && Number(failed.costUsd) === 0,
    "a pending row past 30 minutes fails with the reason instead of being sent",
    failed.error ?? "",
  );
  const held = await owner.settle(leased, rec.schedule);
  check(held.status === "pending", "one whose submit lease is held is not failed under its submitter");
  await assertSweepScope();
  const report = await owner.sweep(sweepDeadline());
  const [s, m] = await Promise.all([readRow(swept.id), readRow(mock.id)]);
  check(s.status === "failed" && s.error === DEADLINE_ERROR && report.moved >= 1, "the sweep fails a past-deadline pending row too", JSON.stringify(report));
  check(m.status === "in_progress" && m.nextCheckAt.getTime() === mock.nextCheckAt.getTime(), "and leaves the mock-shaped row (no request_id, not pending) untouched");
  await getDb().execute(sql`update generations set next_check_at = now() where id = ${leased.id}`);
  const expired = await owner.settle(await readRow(leased.id), rec.schedule);
  check(expired.status === "failed" && expired.error === DEADLINE_ERROR, "once the lease runs out, that row fails too");
  await Promise.all(rec.tasks);
  check(proxy.requests() === before, "none of them made a Higgsfield call", `${proxy.requests() - before} requests`);
}

async function submitChecks(owner: Owner, admin: User, upstream: string, proxy: Proxy) {
  await firstCheckDue(owner, admin);
  await lostAcceptResent(owner, admin, upstream, proxy);
  await rateLimitedThenAccepted(owner, admin, upstream);
  await cancelPending(owner, admin, upstream, proxy);
  await bodyMismatch(owner, admin, upstream);
  console.log(`removed ${await removeCreated()} ${TAG.trim()} rows before the deadline sweep, so every due row is this run's`);
  await submitDeadline(owner, admin, proxy);
}

/**
 * A submitter dies after Higgsfield accepted and before its UPDATE: a child process of this script submits, and the
 * proxy kills it the moment the fake has answered. The row stays pending under the dead submitter's lease. The fake's
 * webhook gets 503 until the lease runs out, then a redelivery sends the row again with the same key and body, gets
 * the original request_id, and completes it.
 */
async function crashAfterAccept(owner: Owner, admin: User, upstream: string, proxy: Proxy, hooks: Hooks) {
  const label = "수락 뒤 죽은 제출자";
  const tap = proxy.tapNextSubmit();
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--submit-once", label], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const seen = await tap.answered;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  tap.reply("hang-up");
  created.push(seen.key);
  const row = await readRow(seen.key);
  check(
    seen.status === 200 && row.status === "pending" && row.requestId === null && (await acceptedFor(upstream, row.id)) === 1,
    "a submitter killed after the fake accepted leaves the row pending without request_id",
  );
  const before = proxy.requests();
  await owner.settle(row, recorder().schedule);
  check(proxy.requests() === before, "while the dead submitter's 30 s lease runs, a poll sends nothing");
  const until = Date.now() + 120_000;
  let codes: number[] = [];
  while (!codes.includes(204)) {
    if (Date.now() > until) throw new Error(`FAIL no 204 webhook for ${seen.requestId} within 120 s (${codes.join(",")})`);
    await sleep(500);
    codes = (await stats(upstream)).webhooks.byRequest[seen.requestId] ?? [];
  }
  await Promise.all(hooks.rec.tasks);
  const final = await readRow(row.id);
  check(
    codes[0] === 503 && codes.at(-1) === 204,
    "its webhook got 503 while the lease held, and a redelivery after it answered 204",
    codes.join(","),
  );
  check(
    final.status === "completed" && final.requestId === seen.requestId && (await acceptedFor(upstream, row.id)) === 1 && final.storagePath === `${row.id}.mp4`,
    "that redelivery sent the row again, got the original request_id, completed and stored it: one accepted submit for the key",
  );
}

/**
 * The cron route, called the way Vercel Cron calls it. This process talks to a fake, so the route must refuse to sweep
 * the shared database and ask Higgsfield nothing, until SWEEP_ALLOW_NONPROD=1 opens it.
 */
async function cronRouteGuard(owner: Owner, admin: User, proxy: Proxy) {
  const route = await import("../src/app/api/cron/settle/route");
  const saved = { secret: process.env.CRON_SECRET, allow: process.env.SWEEP_ALLOW_NONPROD };
  process.env.CRON_SECRET = "lifecycle-check";
  delete process.env.SWEEP_ALLOW_NONPROD;
  try {
    const call = () => route.GET(new Request("http://local/api/cron/settle", { headers: { authorization: "Bearer lifecycle-check" } }));
    await submitWithoutHook(owner, admin, "fake 기준 크론");
    const before = proxy.requests();
    const refused = await call();
    const body = (await refused.json()) as { error?: string };
    check(
      refused.status === 409 && /SWEEP_ALLOW_NONPROD/.test(body.error ?? "") && proxy.requests() === before,
      "the cron route answers 409 and sweeps nothing while HIGGSFIELD_BASE_URL is not the real Higgsfield",
      body.error,
    );
    process.env.SWEEP_ALLOW_NONPROD = "1";
    await assertSweepScope();
    const allowed = await call();
    const report = (await allowed.json()) as { checked?: number };
    check(allowed.status === 200 && (report.checked ?? 0) >= 1, "with SWEEP_ALLOW_NONPROD=1 the same call sweeps", JSON.stringify(report));
  } finally {
    if (saved.secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved.secret;
    if (saved.allow === undefined) delete process.env.SWEEP_ALLOW_NONPROD;
    else process.env.SWEEP_ALLOW_NONPROD = saved.allow;
  }
}

async function triggerChecks(owner: Owner, admin: User, upstream: string, proxy: Proxy, hooks: Hooks) {
  await hookRefusals(owner, admin, proxy);
  await withKnownPrice(MODEL, () => oneWebhookNoPoll(owner, admin, upstream, hooks));
  await duplicateWebhooks(owner, admin, upstream, hooks);
  await hookAfterAnotherCallerFinished(owner, admin, upstream);
  await redeliveryAfter503(owner, admin, upstream, hooks);
  await pollAnsweredAfterHook(owner, admin, upstream, proxy);
  await cronRouteGuard(owner, admin, proxy);
  console.log(`removed ${await removeCreated()} ${TAG.trim()} rows before the sweep checks, so every due row is this run's`);
  await sweepTicks(owner, admin, upstream);
  await hookPollSweepRace(owner, admin, upstream);
  await sweepCopies(owner, admin, upstream);
  await sweepPastDeadline(owner, admin, upstream);
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

/** Child mode for crashAfterAccept: submit one row through the proxy in HIGGSFIELD_BASE_URL and wait to be killed. */
async function submitOnce(label: string) {
  const owner: Owner = await import("../src/lib/generations");
  await submit(owner, await adminUser(), label);
}

async function main() {
  const onceAt = process.argv.indexOf("--submit-once");
  if (onceAt >= 0) return submitOnce(process.argv[onceAt + 1]);
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
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const owner: Owner = await import("../src/lib/generations");
  const admin = await adminUser();
  console.log(`fake ${ownFake ? `in-process at ${upstream}` : upstream}, owner talks to ${process.env.HIGGSFIELD_BASE_URL}`);
  let hooks: Hooks | null = null;
  try {
    if (!proxy) {
      await measure(owner, admin, upstream, base ?? "");
    } else {
      const triggers = process.argv.includes("--triggers");
      const submits = process.argv.includes("--submits");
      if (!triggers && !submits) {
        await withKnownPrice(MODEL, () => fiftyCallers(owner, admin, upstream));
        await reversedObservations(owner, admin, upstream, proxy);
        await cancelRaces(owner, admin, upstream);
        await cancelAfterAnotherCallerFinished(owner, admin, upstream);
        await rowWithoutRequestId(owner, admin, proxy);
        await copyOnCompletion(owner, admin, upstream);
        await tenConcurrentCopies(owner, admin, upstream);
        await storageOff(owner, admin, upstream);
        await stalledCopy(owner, admin, upstream);
      }
      if (!triggers) await submitChecks(owner, admin, upstream, proxy);
      hooks = startHookReceiver(owner);
      process.env.PUBLIC_BASE_URL = await listen(hooks.server);
      console.log(`webhooks go to the receiver at ${process.env.PUBLIC_BASE_URL}`);
      if (!submits) await triggerChecks(owner, admin, upstream, proxy, hooks);
      if (!triggers) await crashAfterAccept(owner, admin, upstream, proxy, hooks);
      console.log(`all checks passed (${proxy.requests()} Higgsfield requests went through the counter)`);
    }
  } finally {
    console.log(`removed ${await removeCreated()} ${TAG.trim()} rows`);
    hooks?.server.close();
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
