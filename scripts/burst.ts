/**
 * The launch burst, end to end: BURST_USERS users each click 생성 BURST_PER_USER times through the real routes of a
 * running app that talks to the fake Higgsfield, then every row must end terminal, every completed row stored, and no
 * user may see a 502.
 *
 *   HIGGSFIELD_BASE_URL=http://localhost:4010 BURST_BASE=http://localhost:3100 npx dotenv -e .env.local -- tsx scripts/burst.ts
 *
 * The app at BURST_BASE must use the same fake for HIGGSFIELD_BASE_URL and SUPABASE_URL, and PUBLIC_BASE_URL pointing
 * at itself so the fake's webhooks reach it. Start the fake with the conditions under test, for example
 * FAKE_HF_429_FIRST_N=5 FAKE_HF_DROP_WEBHOOKS=0.1 FAKE_HF_DUP_WEBHOOKS=1.
 *
 * There is no user delete endpoint, so the script creates its users (gp6-burst-01 …) directly in the database, each
 * with a fake key encrypted the way the admin screen does, and signs them in through POST /api/auth/login. Each user
 * submits one at a time, as the playground's disabled button allows, and polls GET /api/generations?ids= on the
 * playground's schedule (2 s, ×1.5, at most 10 s, back to 2 s after its own submit). With CRON_SECRET set it calls
 * the cron route every BURST_CRON_MS, but only while every due row in the database belongs to these users. At the end
 * it deletes their rows, then the users, and fails unless none of either is left.
 */
import { and, eq, gt, inArray, isNotNull, isNull, like, notInArray, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb, schema } from "../src/db";
import { encrypt, hashPassword } from "../src/lib/crypto";
import { isLive, LIVE_STATUSES, type GenerationStatus } from "../src/lib/generation-status";

type Item = {
  id: string;
  status: GenerationStatus;
  video: { kind: "stored" } | { kind: "provider"; storing: boolean } | null;
};
type Track = { id: string; clickAt: number; postMs: number; status: GenerationStatus; sawPending: boolean; completedAt?: number; storedAt?: number; settled: boolean };
type BurstUser = { id: number; username: string; cookie: string };
type FakeStats = {
  accepted: { byIdempotencyKey: Record<string, number> };
  rejected: { 429: number; 422: number; 503: number };
  statusPolls: { byRequest: Record<string, { total: number; perSecondMax: number }> };
  webhooks: { sent: number; dropped: number; failed: number; retried: number; byRequest: Record<string, number[]> };
};
type FakeKnobs = { dropWebhooks: number; dupWebhooks: boolean; firstN429: number; retryAfterS: number; submitFailN: number };

const PREFIX = "gp6-burst-";
const MODEL = "minimax/hailuo-2.3/standard/image-to-video";
const USERS = Number(process.env.BURST_USERS ?? 20);
const PER_USER = Number(process.env.BURST_PER_USER ?? 15);
const TIMEOUT_MS = Number(process.env.BURST_TIMEOUT_MS ?? 600_000);
const CRON_MS = Number(process.env.BURST_CRON_MS ?? 60_000);
const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10_000;
const POLL_JITTER_MS = 400;
const CHECK_GAP_MS = 15_000;

const base = process.env.BURST_BASE ?? "http://localhost:3100";
const fake = process.env.HIGGSFIELD_BASE_URL ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];

function check(ok: boolean, claim: string, detail = ""): void {
  const line = `${claim}${detail ? ` (${detail})` : ""}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failures.push(line);
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

function spread(xs: number[]) {
  const s = (n: number) => Math.round(n) / 1000;
  return { n: xs.length, p50: s(quantile(xs, 0.5)), p95: s(quantile(xs, 0.95)), max: s(Math.max(...xs)) };
}

async function burstUserIds(): Promise<number[]> {
  const u = schema.users;
  return (await getDb().select({ id: u.id }).from(u).where(like(u.username, `${PREFIX}%`))).map((r) => r.id);
}

/** Delete the burst users' rows, then the users. Returns what is left of each, which must be 0. */
async function removeBurstUsers(): Promise<{ users: number; rows: number; removedUsers: number; removedRows: number }> {
  const g = schema.generations;
  const ids = await burstUserIds();
  const removedRows = ids.length ? (await getDb().delete(g).where(inArray(g.userId, ids)).returning({ id: g.id })).length : 0;
  const removedUsers = ids.length ? (await getDb().delete(schema.users).where(inArray(schema.users.id, ids)).returning({ id: schema.users.id })).length : 0;
  const left = await burstUserIds();
  const [{ n }] = await getDb().execute<{ n: number }>(
    sql`select count(*)::int as n from generations g join users u on u.id = g.user_id where u.username like ${`${PREFIX}%`}`,
  );
  return { users: left.length, rows: Number(n), removedUsers, removedRows };
}

async function createUsers(): Promise<{ id: number; username: string; password: string }[]> {
  const out = [];
  for (let i = 1; i <= USERS; i++) {
    const username = `${PREFIX}${String(i).padStart(2, "0")}`;
    const password = randomBytes(12).toString("base64url");
    const [u] = await getDb()
      .insert(schema.users)
      .values({ username, passwordHash: hashPassword(password), role: "user", apiKeyEnc: encrypt(`fake:${username}`), note: "GP-6 burst 임시 사용자" })
      .returning({ id: schema.users.id });
    out.push({ id: u.id, username, password });
  }
  return out;
}

async function signIn(u: { id: number; username: string; password: string }): Promise<BurstUser> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u.username, password: u.password }),
  });
  const session = res.headers.getSetCookie().find((c) => c.startsWith("vgs_session="));
  if (!res.ok || !session) throw new Error(`FAIL login for ${u.username} answered ${res.status}`);
  return { id: u.id, username: u.username, cookie: session.split(";")[0] };
}

/** Every row the sweep could touch belongs to a burst user, so a cron tick never settles someone else's row. */
async function foreignDueRows(userIds: number[]): Promise<number> {
  const g = schema.generations;
  const [{ n }] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(g)
    .where(
      and(
        notInArray(g.userId, userIds),
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
      ),
    );
  return Number(n);
}

function settled(item: Item): boolean {
  if (isLive(item.status)) return false;
  return item.status !== "completed" || item.video?.kind === "stored" || (item.video?.kind === "provider" && !item.video.storing);
}

function observe(t: Track, item: Item, at: number) {
  t.status = item.status;
  if (item.status === "pending") t.sawPending = true;
  if (item.status === "completed") t.completedAt ??= at;
  if (item.video?.kind === "stored") t.storedAt ??= at;
  t.settled = settled(item);
}

/** One person: click 생성 PER_USER times, one submit at a time, while polling like the playground. */
async function person(u: BurstUser, n: number, stopAt: number, postCodes: number[], tracks: Track[]): Promise<void> {
  const mine: Track[] = [];
  const headers = { cookie: u.cookie, "Content-Type": "application/json" };
  let delay = POLL_FIRST_MS;
  let nextAt = Date.now() + delay;
  let clicking = true;
  const poll = (async () => {
    while (Date.now() < stopAt) {
      if (Date.now() < nextAt) {
        await sleep(50);
        continue;
      }
      const open = mine.filter((t) => !t.settled);
      if (open.length === 0) {
        if (!clicking) return;
        nextAt = Date.now() + 200;
        continue;
      }
      const started = Date.now();
      try {
        const res = await fetch(`${base}/api/generations?ids=${open.map((t) => t.id).join(",")}`, { headers });
        const body = (await res.json()) as { items?: Item[] };
        for (const item of body.items ?? []) {
          const t = mine.find((x) => x.id === item.id);
          if (t) observe(t, item, Date.now());
        }
      } catch {
        /* the playground retries on its next tick */
      }
      delay = Math.min(POLL_MAX_MS, delay * 1.5);
      nextAt = started + delay + (Math.random() - 0.5) * POLL_JITTER_MS;
    }
  })();
  for (let i = 1; i <= n && Date.now() < stopAt; i++) {
    const clickAt = Date.now();
    const res = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ modelId: MODEL, prompt: `GP-6 burst ${u.username} ${i}/${n}`, params: {}, imageUrls: ["https://example.com/gp6-burst.jpg"] }),
    });
    const body = (await res.json().catch(() => ({}))) as { item?: Item };
    postCodes.push(res.status);
    if (body.item) {
      const t: Track = { id: body.item.id, clickAt, postMs: Date.now() - clickAt, status: body.item.status, sawPending: false, settled: false };
      observe(t, body.item, Date.now());
      mine.push(t);
      tracks.push(t);
    }
    delay = POLL_FIRST_MS;
    nextAt = Date.now() + delay;
    await sleep(300 + Math.random() * 900);
  }
  clicking = false;
  await poll;
}

async function main() {
  if (!fake) throw new Error("FAIL HIGGSFIELD_BASE_URL must point at the fake the app uses");
  const knobs = (await (await fetch(`${fake}/_config`, { method: "POST", body: "{}" })).json()) as FakeKnobs;
  const before = (await (await fetch(`${fake}/_stats`)).json()) as FakeStats;
  const login = await fetch(`${base}/login`);
  if (!login.ok) throw new Error(`FAIL ${base}/login answered ${login.status}`);
  const [model] = await getDb().select().from(schema.models).where(eq(schema.models.modelId, MODEL)).limit(1);
  if (model && !model.enabled) throw new Error(`FAIL ${MODEL} is disabled in 어드민`);
  const leftovers = await removeBurstUsers();
  if (leftovers.removedUsers) console.log(`removed ${leftovers.removedUsers} leftover ${PREFIX} users and ${leftovers.removedRows} rows`);
  console.log(`burst ${USERS} users × ${PER_USER} submits against ${base}, fake ${fake} ${JSON.stringify(knobs)}`);

  const postCodes: number[] = [];
  const tracks: Track[] = [];
  const cron: unknown[] = [];
  let userIds: number[] = [];
  const started = Date.now();
  try {
    const created = await createUsers();
    userIds = created.map((u) => u.id);
    const users = await Promise.all(created.map(signIn));
    const stopAt = started + TIMEOUT_MS;
    let running = true;
    const ticker = (async () => {
      const secret = process.env.CRON_SECRET;
      while (secret && running) {
        const tickAt = Date.now() + CRON_MS;
        while (running && Date.now() < tickAt) await sleep(100);
        if (!running) return;
        const foreign = await foreignDueRows(userIds);
        if (foreign > 0) {
          cron.push({ skipped: `${foreign} due rows belong to other users` });
          continue;
        }
        const res = await fetch(`${base}/api/cron/settle`, { headers: { Authorization: `Bearer ${secret}` } });
        if (res.status === 404) return void cron.push({ absent: "no cron route on this build" });
        cron.push(res.ok ? await res.json() : { status: res.status });
      }
    })();
    await Promise.all(users.map((u) => person(u, PER_USER, stopAt, postCodes, tracks)));
    running = false;
    await ticker;
    const wallMs = Date.now() - started;

    const g = schema.generations;
    const rows = await getDb().select().from(g).where(inArray(g.userId, userIds));
    const after = (await (await fetch(`${fake}/_stats`)).json()) as FakeStats;
    const completed = rows.filter((r) => r.status === "completed");
    const byStatus = Object.fromEntries([...new Set(rows.map((r) => r.status))].map((s) => [s, rows.filter((r) => r.status === s).length]));
    const accepted = rows.map((r) => after.accepted.byIdempotencyKey[r.id] ?? 0);
    const overCalls = rows.flatMap((r) => {
      const calls = after.statusPolls.byRequest[r.requestId ?? ""]?.total ?? 0;
      const lifeMs = (r.completedAt ?? new Date()).getTime() - r.createdAt.getTime();
      const deliveries = after.webhooks.byRequest[r.requestId ?? ""]?.length ?? 0;
      const allowed = 1 + Math.floor(lifeMs / CHECK_GAP_MS) + deliveries;
      return calls > allowed ? [`${r.id} ${calls}>${allowed}`] : [];
    });
    const perSecondMax = Math.max(0, ...rows.map((r) => after.statusPolls.byRequest[r.requestId ?? ""]?.perSecondMax ?? 0));
    const deliveries = rows.map((r) => after.webhooks.byRequest[r.requestId ?? ""] ?? []);
    const dropped = after.webhooks.dropped - before.webhooks.dropped;
    const codes = Object.fromEntries([...new Set(postCodes)].map((c) => [c, postCodes.filter((x) => x === c).length]));

    check(rows.length === USERS * PER_USER, `all ${USERS * PER_USER} submits made a row`, `${rows.length}`);
    check(rows.every((r) => !isLive(r.status)), "every row ended terminal", JSON.stringify(byStatus));
    check(completed.length > 0 && completed.every((r) => r.storagePath === `${r.id}.mp4`), "every completed row is stored", `${completed.filter((r) => r.storagePath).length}/${completed.length}`);
    check(accepted.every((n) => n === 1), "the fake accepted exactly one submit per Idempotency-Key", `${accepted.filter((n) => n !== 1).length} keys off`);
    check(overCalls.length === 0, "status calls per row stay within 1 per 15 s plus 1 per webhook delivery", overCalls.slice(0, 3).join("; "));
    check((codes[502] ?? 0) === 0, "no submit answered 502", JSON.stringify(codes));
    if (knobs.firstN429 > 0) check(after.rejected[429] > before.rejected[429], "the fake did answer 429s, so the run exercised them", `${after.rejected[429] - before.rejected[429]}`);
    if (knobs.dropWebhooks > 0) check(dropped > 0, "the fake dropped some webhooks", `${dropped}`);
    if (knobs.dupWebhooks) check(deliveries.some((d) => d.length >= 2), "the fake delivered some webhooks twice", `${deliveries.filter((d) => d.length >= 2).length} rows`);

    const toDone = tracks.filter((t) => t.completedAt).map((t) => (t.completedAt ?? 0) - t.clickAt);
    const toStored = tracks.filter((t) => t.storedAt).map((t) => (t.storedAt ?? 0) - t.clickAt);
    const report = {
      users: USERS,
      perUser: PER_USER,
      wallS: Math.round(wallMs / 1000),
      postCodes: codes,
      sawPending: tracks.filter((t) => t.sawPending).length,
      clickToDoneS: spread(toDone),
      clickToStoredS: spread(toStored),
      postS: spread(tracks.map((t) => t.postMs)),
      fake429: after.rejected[429] - before.rejected[429],
      fake503: after.rejected[503] - before.rejected[503],
      statusPerSecondMax: perSecondMax,
      webhooks: { dropped, rowsDeliveredTwice: deliveries.filter((d) => d.length >= 2).length },
      byStatus,
      cron,
    };
    console.log(`BURST ${JSON.stringify(report)}`);
  } finally {
    const left = await removeBurstUsers();
    console.log(`cleanup: removed ${left.removedRows} rows and ${left.removedUsers} users; left ${left.users} ${PREFIX} users and ${left.rows} of their rows`);
    check(left.users === 0 && left.rows === 0, "no burst user and no burst row is left");
  }
  if (failures.length) throw new Error(`${failures.length} burst checks failed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
