/**
 * Measures 0011 and the two thread queries on about 20k generation rows. In a fresh database next to the local one
 * DATABASE_URL names, it applies migrations up to 0010, inserts 20 members × 1000 rows with no thread (the shape 0011
 * meets in production), times applying 0011, then moves 800 of each member's rows into 80 threads and runs ANALYZE.
 * It times listThreads and threadFeed (a chat thread and the earlier history, their newest page and an older page from
 * a cursor) through thread-store itself, with and
 * without 0011's two generations indexes, alternating the two sides, and has auto_explain log every statement of
 * one more call per query so the plans and the statement count come from the real calls. The database is dropped at
 * the end. Local Postgres only: the verify skill's Docker container is `vgs-threads-pg`.
 *
 *   npx dotenv -e .env.local -- tsx scripts/threads-perf.mts [--runs 41] [--container vgs-threads-pg]
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb } from "../src/db/index";
import { listThreads, threadFeed } from "../src/lib/thread-store";
import type { ThreadId, ThreadRef } from "../src/lib/threads";

const arg = (name: string, fallback: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const RUNS = Number(arg("--runs", "41"));
const CONTAINER = arg("--container", "vgs-threads-pg");
const MEMBERS = 20;
const PER_MEMBER = 1000;
const THREADS = 80;
const PER_THREAD = 10;

const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("DATABASE_URL must point at a local Postgres");
const dbName = `vgs_threads_perf_${Date.now().toString(36)}`;
const url = new URL(base.href);
url.pathname = `/${dbName}`;
const admin = postgres(base.href, { ssl: "require", max: 1, onnotice: () => {} });
const raw = () => postgres(url.href, { ssl: "require", max: 1, onnotice: () => {} });
const g = globalThis as unknown as { __vgsDb?: unknown };

/** A fresh pool, so database-level settings changed since the last one apply to its connections. */
async function freshPool() {
  if (g.__vgsDb) await getDb().$client.end();
  g.__vgsDb = undefined;
  process.env.DATABASE_URL = url.href;
  return getDb();
}

function stats(ms: number[]) {
  const s = [...ms].sort((x, y) => x - y);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5).toFixed(2), p95: at(0.95).toFixed(2), min: s[0].toFixed(2), max: s[s.length - 1].toFixed(2) };
}

async function timed(run: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await run();
  return performance.now() - t0;
}

await admin.unsafe(`create database ${dbName}`);
const upTo10 = mkdtempSync(join(tmpdir(), "vgs-0010-"));
try {
  cpSync("drizzle", upTo10, { recursive: true });
  const journal = JSON.parse(readFileSync(join(upTo10, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag <= "0010");
  writeFileSync(join(upTo10, "meta", "_journal.json"), JSON.stringify(journal));
  let client = raw();
  await migrate(drizzle(client), { migrationsFolder: upTo10 });
  await client`insert into users (username, password_hash) select 'perf-' || n || '@example.test', '-' from generate_series(1, ${MEMBERS}) n`;
  await client`
    insert into generations (user_id, model_id, prompt, status, duration_s, cost_usd, created_at, completed_at)
    select u.id, 'bytedance/seedance-2.0/text-to-video', 'perf row ' || n, 'completed', 5, 0.4925,
      now() - make_interval(mins => (n * 131) % 129600), now() - make_interval(mins => (n * 131) % 129600 - 1)
    from users u cross join generate_series(1, ${PER_MEMBER}) n`;
  await client`analyze generations`;
  const [{ rows }] = await client`select count(*)::int as rows from generations`;
  await client.end();

  client = raw();
  const t0 = performance.now();
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  const migrateMs = performance.now() - t0;
  console.log(`0011 applied over ${rows} rows with no thread in ${migrateMs.toFixed(0)} ms (one run, includes drizzle's journal read)`);

  await client`
    with ranked as (
      select id, user_id, row_number() over (partition by user_id order by created_at desc) - 1 as r from generations
    ), made as (
      insert into threads (id, user_id, kind, title)
      select gen_random_uuid(), u.id, 'chat', 'perf thread ' || t from users u cross join generate_series(0, ${THREADS - 1}) t
      returning id, user_id, title
    ), numbered as (
      select id, user_id, substring(title from 13)::int as t from made
    )
    update generations g set thread_id = n.id
    from ranked r join numbered n on n.user_id = r.user_id and n.t = r.r / ${PER_THREAD}
    where g.id = r.id and r.r < ${THREADS * PER_THREAD}`;
  await client`analyze generations`;
  await client`analyze threads`;
  const [member] = await client`select id from users order by id limit 1`;
  const [chat] = await client`select id from threads where user_id = ${member.id} and title = 'perf thread 40'`;
  const [chatCursor] = await client`select id from generations where thread_id = ${chat.id} order by created_at desc, id desc offset 4 limit 1`;
  const [earlierCursor] = await client`select id from generations where user_id = ${member.id} and thread_id is null order by created_at desc, id desc offset 11 limit 1`;
  await client.end();

  const me = member.id as number;
  const chatRef: ThreadRef = { kind: "chat", id: chat.id as ThreadId };
  const calls = {
    listThreads: () => listThreads(me),
    feedChat: () => threadFeed(me, chatRef, 12),
    feedEarlier: () => threadFeed(me, { kind: "earlier" }, 12),
    feedChatOlder: () => threadFeed(me, chatRef, 12, chatCursor.id),
    feedEarlierOlder: () => threadFeed(me, { kind: "earlier" }, 12, earlierCursor.id),
  };
  const check = async () => {
    const list = await calls.listThreads();
    const chatFeed = await calls.feedChat();
    const earlierFeed = await calls.feedEarlier();
    if (list.length !== THREADS + 1 || list[list.length - 1].kind !== "earlier") throw new Error(`list has ${list.length} threads`);
    if (chatFeed?.rows.length !== PER_THREAD || earlierFeed?.rows.length !== 12) throw new Error("a feed came back short");
    const chatOlder = await calls.feedChatOlder();
    const earlierOlder = await calls.feedEarlierOlder();
    if (chatOlder?.rows.length !== PER_THREAD - 5 || chatOlder.more || earlierOlder?.rows.length !== 12 || !earlierOlder.more) throw new Error("an older page came back wrong");
    return `list ${list.length} threads, chat feed ${chatFeed.rows.length} rows, earlier feed ${earlierFeed.rows.length} rows, older pages ${chatOlder.rows.length} and ${earlierOlder.rows.length} rows`;
  };

  const results = Object.fromEntries(["indexed", "unindexed"].map((side) => [side, Object.fromEntries(Object.keys(calls).map((name) => [name, [] as number[]]))])) as Record<
    "indexed" | "unindexed",
    Record<keyof typeof calls, number[]>
  >;
  const setIndex = async (on: boolean) => {
    const c = raw();
    if (on) {
      await c`create index if not exists generations_user_thread_created_idx on generations (user_id, thread_id, created_at) where thread_id is not null`;
      await c`create index if not exists generations_user_earlier_created_idx on generations (user_id, created_at) where thread_id is null`;
    } else {
      await c`drop index if exists generations_user_thread_created_idx`;
      await c`drop index if exists generations_user_earlier_created_idx`;
    }
    await c`analyze generations`;
    await c.end();
  };
  await freshPool();
  for (let round = 0; round < 5; round++) {
    for (const side of ["indexed", "unindexed"] as const) {
      await setIndex(side === "indexed");
      await freshPool();
      const what = await check();
      if (round === 0) console.log(`${side}: ${what}`);
      for (let i = 0; i < 3; i++) for (const run of Object.values(calls)) await run();
      for (let i = 0; i < Math.ceil(RUNS / 5); i++) {
        for (const [name, run] of Object.entries(calls) as [keyof typeof calls, () => Promise<unknown>][]) results[side][name].push(await timed(run));
      }
    }
  }
  for (const side of ["indexed", "unindexed"] as const) {
    for (const [name, ms] of Object.entries(results[side])) console.log(`${side.padEnd(9)} ${name.padEnd(11)} ${JSON.stringify({ runs: ms.length, ...stats(ms) })} ms`);
  }

  await setIndex(true);
  const settings = ["session_preload_libraries = 'auto_explain'", "auto_explain.log_min_duration = 0", "auto_explain.log_analyze = on", "auto_explain.log_buffers = on"];
  for (const s of settings) await admin.unsafe(`alter database ${dbName} set ${s}`);
  const since = new Date(Date.now() - 5_000).toISOString();
  const db = await freshPool();
  const marker = (name: string) => db.execute(sql.raw(`select 'perf-marker ${name}'`));
  for (const [name, run] of Object.entries(calls)) {
    await marker(name);
    await run();
  }
  await marker("end");
  await new Promise((r) => setTimeout(r, 500));
  const logs = spawnSync("docker", ["logs", "--since", since, CONTAINER], { encoding: "utf8" });
  const text = `${logs.stdout}${logs.stderr}`;
  for (const name of Object.keys(calls)) {
    const from = text.indexOf(`perf-marker ${name}`);
    const segment = text.slice(text.indexOf("\n", from), text.indexOf("perf-marker", from + 12));
    const statements = segment.split("duration:").length - 1;
    console.log(`--- ${name}: ${statements - 1} statement(s) besides the next marker`);
    console.log(segment.split("\n").filter((l) => /duration:|Scan|Execution|Limit|Nested|Append|SubPlan|InitPlan|Aggregate|Sort|Result|Filter|Cond/.test(l)).map((l) => l.replace(/^.*?(LOG:\s+)?/, "").slice(0, 160)).join("\n"));
  }
} finally {
  if (g.__vgsDb) await getDb().$client.end();
  rmSync(upTo10, { recursive: true, force: true });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}
