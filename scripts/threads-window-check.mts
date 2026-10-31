/**
 * Proves drizzle/0011_threads.sql is safe to apply while master's code still runs. In a fresh database next to the
 * local one DATABASE_URL names, master's own drizzle-kit applies master's migrations, master's own submitGeneration
 * writes a row, this branch applies 0011, master's code writes a second row, and then this branch's thread-store must
 * show both rows in the member's earlier history, delete that history like any thread, and leave both rows as they
 * were. The database is dropped at the end. Master runs from a checkout of origin/master whose node_modules matches
 * this one's (a junction or a copy), and its submits go to the fake Higgsfield.
 *
 *   git archive -o master.tar origin/master && mkdir ../master && tar -xf master.tar -C ../master
 *   (link node_modules into ../master), FAKE_HF_PORT=4800 npm run fake:hf, then
 *   HIGGSFIELD_BASE_URL=http://localhost:4800 npx dotenv -e .env.local -- tsx scripts/threads-window-check.mts --master ../master
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { encrypt } from "../src/lib/crypto";
import { deleteThread, listThreads, threadFeed } from "../src/lib/thread-store";

const MASTER_WRITE = `
import { eq } from "drizzle-orm";
import { getDb, schema } from "./src/db";
import { planGeneration } from "./src/lib/catalog";
import { submitGeneration } from "./src/lib/generations";
const [user] = await getDb().select().from(schema.users).where(eq(schema.users.id, Number(process.argv[2])));
const plan = planGeneration({ family: "bytedance/seedance-2.0", mode: "t2v", prompt: process.argv[3], params: {}, images: [], videos: [], endImage: null }, 0.1);
if (!plan.ready) throw new Error(JSON.stringify(plan.blocker));
const row = await submitGeneration(user, plan, (task) => void task());
console.log(JSON.stringify({ id: row.id, status: row.status }));
process.exit(0);
`;

function fail(message: string): never {
  throw new Error(message);
}

const masterArg = process.argv[process.argv.indexOf("--master") + 1];
if (!process.argv.includes("--master") || !masterArg) fail("pass --master <checkout of origin/master>");
const master = resolve(masterArg);
if (!existsSync(join(master, "drizzle", "0010_generation_error_code.sql")) || existsSync(join(master, "drizzle", "0011_threads.sql"))) {
  fail(`${master} is not master's tree: it must end at 0010 and have no 0011`);
}
const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) fail("DATABASE_URL must point at a local Postgres");
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(process.env.HIGGSFIELD_BASE_URL ?? "")) fail("HIGGSFIELD_BASE_URL must be the local fake");

const dbName = `vgs_threads_window_${Date.now().toString(36)}`;
const url = new URL(base.href);
url.pathname = `/${dbName}`;
const env = { ...process.env, DATABASE_URL: url.href };
const admin = postgres(base.href, { ssl: "require", max: 1, onnotice: () => {} });
const child = join(master, ".threads-window-write.mts");

function masterWrites(userId: number, label: string): string {
  const out = execFileSync(process.execPath, [join(master, "node_modules", "tsx", "dist", "cli.mjs"), child, String(userId), label], { cwd: master, env, encoding: "utf8" });
  const { id, status } = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as { id?: string; status?: string };
  if (!id) fail(`master's submitGeneration printed no row: ${out}`);
  console.log(`master's submitGeneration wrote ${id} (${status}) for "${label}"`);
  return id;
}

await admin.unsafe(`create database ${dbName}`);
try {
  execFileSync(process.execPath, [join(master, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"], { cwd: master, env, stdio: "ignore" });
  console.log("master's drizzle-kit applied master's migrations (0000-0010)");
  process.env.DATABASE_URL = url.href;
  const db = getDb();
  const [member] = await db
    .insert(schema.users)
    .values({ username: `threads-window-${Date.now().toString(36)}@example.test`, passwordHash: "-", apiKeyEnc: encrypt("fake-id:fake-secret") })
    .returning({ id: schema.users.id });
  writeFileSync(child, MASTER_WRITE);
  const before = masterWrites(member.id, "written before 0011");

  const migrator = postgres(url.href, { ssl: "require", max: 1, onnotice: () => {} });
  await migrate(drizzle(migrator), { migrationsFolder: "drizzle" });
  await migrator.end();
  const [{ n }] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.columns where table_name = 'generations' and column_name = 'thread_id'`,
  );
  if (n !== 1) fail("0011 did not add generations.thread_id");
  console.log("this branch applied 0011 under master's row");

  const windowRow = masterWrites(member.id, "written by master after 0011");
  const rows = await db.select().from(schema.generations).where(eq(schema.generations.userId, member.id)).orderBy(asc(schema.generations.id));
  if (rows.length !== 2 || rows.some((r) => r.threadId !== null)) fail(`expected master's two rows with no thread, got ${JSON.stringify(rows.map((r) => [r.id, r.threadId]))}`);

  const list = await listThreads(member.id);
  if (JSON.stringify(list) !== JSON.stringify([{ kind: "earlier", id: "earlier" }])) fail(`the list should be the earlier history alone, got ${JSON.stringify(list)}`);
  const feed = await threadFeed(member.id, { kind: "earlier" }, 12);
  const feedIds = feed?.rows.map((r) => r.id) ?? [];
  if (JSON.stringify(feedIds) !== JSON.stringify([windowRow, before])) fail(`the earlier history should hold [${windowRow}, ${before}], got ${JSON.stringify(feedIds)}`);
  console.log(`this branch lists one thread, the earlier history, holding both rows newest first: ${feedIds.join(", ")}`);

  await deleteThread(member.id, { kind: "earlier" });
  const after = await db.select().from(schema.generations).where(eq(schema.generations.userId, member.id)).orderBy(asc(schema.generations.id));
  if (JSON.stringify(await listThreads(member.id)) !== "[]") fail("the earlier history is still listed after its delete");
  if (JSON.stringify(after) !== JSON.stringify(rows)) fail("deleting the earlier history changed a generation row");
  console.log("deleting the earlier history took it off the list and left both rows unchanged");
  await db.$client.end();
  console.log("PASS window rows land in the earlier history");
} catch (e) {
  console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  rmSync(child, { force: true });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}
