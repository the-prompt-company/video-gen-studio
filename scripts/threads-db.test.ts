/**
 * The thread rules of src/lib/thread-store.ts against a real Postgres: owner-only access, delete hiding a thread but
 * none of its generations, the earlier history, idempotent creation, the list order and the feed. Each run creates its
 * own database next to the one DATABASE_URL names, applies every migration in drizzle/, and drops it at the end, so it
 * needs a local server (the verify skill's Docker Postgres) and refuses any other host.
 *
 *   npx dotenv -e .env.local -- node --test --import tsx scripts/threads-db.test.ts
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc, eq } from "drizzle-orm";
import { getDb, pgErrorCode, schema, FOREIGN_KEY_VIOLATION } from "../src/db";
import type { Generation } from "../src/db/schema";
import { HttpError } from "../src/lib/auth";
import { usageFor } from "../src/lib/stats";
import { claimThread, deleteThread, listThreads, threadFeed } from "../src/lib/thread-store";
import { EARLIER, type ThreadId, type ThreadRef } from "../src/lib/threads";

const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("DATABASE_URL must point at a local Postgres: this test creates and drops a database");
const dbName = `vgs_threads_test_${Date.now().toString(36)}`;
const admin = postgres(base.href, { ssl: "require", max: 1, onnotice: () => {} });
let raw: postgres.Sql;

before(async () => {
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(base.href);
  url.pathname = `/${dbName}`;
  const migrator = postgres(url.href, { ssl: "require", max: 1, onnotice: () => {} });
  await migrate(drizzle(migrator), { migrationsFolder: "drizzle" });
  await migrator.end();
  process.env.DATABASE_URL = url.href;
  raw = postgres(url.href, { ssl: "require", max: 1 });
});

after(async () => {
  await getDb().$client.end();
  await raw.end();
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const chat = () => ({ kind: "chat", id: randomUUID() as ThreadId }) as const;
const earlier: ThreadRef = { kind: "earlier" };

async function member(role: "user" | "admin" = "user"): Promise<number> {
  const [u] = await getDb().insert(schema.users).values({ username: `threads-${randomUUID()}@example.test`, passwordHash: "-", role }).returning({ id: schema.users.id });
  return u.id;
}

async function generate(userId: number, threadId: ThreadId | null, minutesAgo: number, status: Generation["status"] = "completed"): Promise<string> {
  const [r] = await getDb()
    .insert(schema.generations)
    .values({ userId, threadId, modelId: "bytedance/seedance-2.0/text-to-video", prompt: `p ${minutesAgo}`, status, durationS: 5, costUsd: "0.4925", createdAt: new Date(Date.now() - minutesAgo * 60_000) })
    .returning({ id: schema.generations.id });
  return r.id;
}

async function masterRow(userId: number, minutesAgo: number): Promise<string> {
  const [r] = await raw<{ id: string }[]>`
    insert into generations (user_id, model_id, prompt, status, cost_usd, duration_s, created_at)
    values (${userId}, 'minimax/h3/text-to-video', 'window row', 'completed', 0.65, 10, now() - make_interval(mins => ${minutesAgo}))
    returning id`;
  return r.id;
}

async function rowsOf(userId: number) {
  return getDb().select().from(schema.generations).where(eq(schema.generations.userId, userId)).orderBy(asc(schema.generations.id));
}

async function refused(run: () => Promise<unknown>) {
  await assert.rejects(run, (e: unknown) => e instanceof HttpError && e.status === 404 && e.error.code === "noSuchThread");
}

const idsOf = (rows: { id: string }[] | undefined) => rows?.map((r) => r.id);

test("one new thread id makes one thread however often or however concurrently it is sent, titled by the first prompt", async () => {
  const me = await member();
  const ref = chat();
  const claims = await Promise.all([1, 2, 3].map(() => claimThread(me, ref, "  비 오는 밤\n한강 다리 위 ")));
  const again = await claimThread(me, ref, "a different second prompt");
  for (const c of [...claims, again]) assert.equal(c.threadId, ref.id);
  assert.deepEqual(again.thread, { kind: "chat", id: ref.id, title: "비 오는 밤 한강 다리 위" });
  const stored = await getDb().select().from(schema.threads).where(eq(schema.threads.userId, me));
  assert.equal(stored.length, 1);
});

test("a thread is its owner's alone: another member, even an admin, gets 404 from every thread route and sees nothing of it", async () => {
  const owner = await member();
  const other = await member("admin");
  const ref = chat();
  const { threadId } = await claimThread(owner, ref, "owner's prompt");
  const id = await generate(owner, threadId, 1);
  await refused(() => claimThread(other, ref, "taking it over"));
  await refused(() => deleteThread(other, ref));
  assert.equal(await threadFeed(other, ref, 12), null);
  assert.deepEqual(await listThreads(other), []);
  assert.deepEqual(idsOf((await threadFeed(owner, ref, 12))?.rows), [id]);
  assert.deepEqual(await listThreads(owner), [{ kind: "chat", id: threadId, title: "owner's prompt" }]);
});

test("a generation can only point at a thread its own member owns", async () => {
  const owner = await member();
  const other = await member();
  const { threadId } = await claimThread(owner, chat(), "mine");
  await assert.rejects(generate(other, threadId, 1), (e: unknown) => pgErrorCode(e) === FOREIGN_KEY_VIOLATION);
});

test("deleting a thread takes it off the list and leaves its generations, the gallery and the dashboard exactly as they were", async () => {
  const me = await member();
  const ref = chat();
  const { threadId } = await claimThread(me, ref, "to delete");
  const live = await generate(me, threadId, 2, "in_progress");
  await generate(me, threadId, 3);
  await generate(me, null, 30);
  const keep = await claimThread(me, chat(), "to keep");
  await generate(me, keep.threadId, 1);
  const rowsBefore = await rowsOf(me);
  const usageBefore = await usageFor(me);

  await deleteThread(me, ref);

  assert.deepEqual(await listThreads(me), [keep.thread, { kind: "earlier", id: EARLIER }]);
  assert.equal(await threadFeed(me, ref, 12), null);
  await refused(() => claimThread(me, ref, "one more into the deleted thread"));
  await refused(() => deleteThread(me, ref));
  assert.deepEqual(await rowsOf(me), rowsBefore);
  assert.deepEqual(await usageFor(me), usageBefore);
  const [stillLive] = await getDb().select().from(schema.generations).where(eq(schema.generations.id, live));
  assert.equal(stillLive.status, "in_progress");
});

test("generations with no thread, from before 0011 or from master's code after it, are the member's earlier history", async () => {
  const me = await member();
  const before = await generate(me, null, 120);
  const windowRow = await masterRow(me, 60);
  const { threadId } = await claimThread(me, chat(), "a thread made later");
  await generate(me, threadId, 5);

  const list = await listThreads(me);
  assert.deepEqual(list.map((t) => t.id), [threadId, EARLIER]);
  assert.deepEqual(idsOf((await threadFeed(me, earlier, 12))?.rows), [windowRow, before]);
  assert.deepEqual(await claimThread(me, earlier, "more history"), { threadId: null, thread: { kind: "earlier", id: EARLIER } });
});

test("the earlier history deletes like any thread, keeps its generations, and is never shown to a member without one", async () => {
  const me = await member();
  await generate(me, null, 10);
  await masterRow(me, 5);
  const rowsBefore = await rowsOf(me);
  const usageBefore = await usageFor(me);

  await deleteThread(me, earlier);

  assert.deepEqual(await listThreads(me), []);
  assert.equal(await threadFeed(me, earlier, 12), null);
  await refused(() => claimThread(me, earlier, "into deleted history"));
  await refused(() => deleteThread(me, earlier));
  assert.deepEqual(await rowsOf(me), rowsBefore);
  assert.deepEqual(await usageFor(me), usageBefore);

  const fresh = await member();
  assert.deepEqual(await listThreads(fresh), []);
  assert.equal(await threadFeed(fresh, earlier, 12), null);
  await refused(() => deleteThread(fresh, earlier));
});

test("the list puts the thread with the newest generation first and leaves out a thread that has none", async () => {
  const me = await member();
  await generate(me, null, 180);
  await claimThread(me, chat(), "claimed, never generated");
  const older = await claimThread(me, chat(), "older");
  await generate(me, older.threadId, 240);
  await generate(me, older.threadId, 120);
  const newer = await claimThread(me, chat(), "newer");
  await generate(me, newer.threadId, 60);
  assert.deepEqual((await listThreads(me)).map((t) => t.id), [newer.threadId, older.threadId, EARLIER]);
});

test("a thread's feed is its own newest rows, newest first, up to the limit", async () => {
  const me = await member();
  const ref = chat();
  const { threadId } = await claimThread(me, ref, "feed");
  const oldest = await generate(me, threadId, 30);
  const middle = await generate(me, threadId, 20);
  const newest = await generate(me, threadId, 10);
  await generate(me, null, 5);
  const other = await claimThread(me, chat(), "other");
  await generate(me, other.threadId, 1);
  assert.deepEqual(idsOf((await threadFeed(me, ref, 2))?.rows), [newest, middle]);
  assert.deepEqual(idsOf((await threadFeed(me, ref, 12))?.rows), [newest, middle, oldest]);
  assert.equal(typeof (await threadFeed(me, ref, 12))?.now, "number");
});

test("older pages continue from the oldest row the page holds, to the last row, then say none remain", async () => {
  const me = await member();
  const ref = chat();
  const { threadId } = await claimThread(me, ref, "pages");
  const rows = [];
  for (let minutes = 50; minutes > 0; minutes -= 10) rows.unshift(await generate(me, threadId, minutes));
  const first = await threadFeed(me, ref, 2);
  assert.deepEqual([idsOf(first?.rows), first?.more], [rows.slice(0, 2), true]);
  const second = await threadFeed(me, ref, 2, rows[1]);
  assert.deepEqual([idsOf(second?.rows), second?.more], [rows.slice(2, 4), true]);
  const last = await threadFeed(me, ref, 2, rows[3]);
  assert.deepEqual([idsOf(last?.rows), last?.more], [[rows[4]], false]);
  assert.equal((await threadFeed(me, ref, 12))?.more, false);

  const earlierRows = [await generate(me, null, 9), await generate(me, null, 8)].reverse();
  assert.deepEqual(idsOf((await threadFeed(me, earlier, 1, earlierRows[0]))?.rows), [earlierRows[1]]);
});

test("rows created in the same microsecond page apart by id, so none is skipped or repeated", async () => {
  const me = await member();
  const ref = chat();
  const { threadId } = await claimThread(me, ref, "ties");
  const at = new Date(Date.now() - 60_000);
  const made = await getDb()
    .insert(schema.generations)
    .values(Array.from({ length: 3 }, (_, i) => ({ userId: me, threadId, modelId: "bytedance/seedance-2.0/text-to-video", prompt: `tie ${i}`, status: "completed" as const, durationS: 5, costUsd: "0.4925", createdAt: at })))
    .returning({ id: schema.generations.id });
  const seen: string[] = [];
  let page = await threadFeed(me, ref, 1);
  while (page) {
    seen.push(...page.rows.map((r) => r.id));
    if (!page.more) break;
    page = await threadFeed(me, ref, 1, seen[seen.length - 1]);
  }
  assert.deepEqual([...seen].sort(), made.map((m) => m.id).sort());
});

test("a cursor that is not the member's row finds nothing", async () => {
  const me = await member();
  const other = await member();
  const ref = chat();
  const { threadId } = await claimThread(me, ref, "cursor");
  await generate(me, threadId, 10);
  const foreign = await generate(other, null, 20);
  assert.equal(await threadFeed(me, ref, 12, foreign), null);
});
