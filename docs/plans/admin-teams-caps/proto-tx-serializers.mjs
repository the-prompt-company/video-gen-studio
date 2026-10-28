// Read-only prototype for docs/plans/admin-teams-caps.md, Appendix A. Every transaction starts with
// SET TRANSACTION READ ONLY, and nothing outside a transaction writes.
//
// Question. With createDb() from PR #11 (origin/fix-db-pool), does db.transaction() encode jsonb parameters and
// parse timestamps the way the pooled client does? Does copying drizzle's type handlers onto the transaction client
// fix it? What does a lock-then-sum transaction cost against the Supabase transaction pooler?
//
//   node docs/plans/admin-teams-caps/proto-tx-serializers.mjs .env.local
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { pgTable, jsonb, timestamp, uuid, integer, numeric } from "drizzle-orm/pg-core";

const env = Object.fromEntries(
  readFileSync(process.argv[2] ?? ".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"(.*)"$/, "$1")]),
);
if (!env.DATABASE_URL) throw new Error("no DATABASE_URL in the env file");

const generations = pgTable("generations", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id"),
  params: jsonb("params"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

/** createDb() from PR #11, pool of 2. With `fix`, the transaction client gets the pooled client's type handlers. */
function createDb(fix) {
  const options = { prepare: false, ssl: "require", idle_timeout: 20, max_lifetime: 60 * 30, connect_timeout: 10 };
  const client = postgres(env.DATABASE_URL, { ...options, max: 2, max_pipeline: 0 });
  const txClient = postgres(env.DATABASE_URL, { ...options, max: 1 });
  client.begin = txClient.begin;
  const db = drizzle(client, { schema: { generations } });
  if (fix) {
    Object.assign(txClient.options.parsers, client.options.parsers);
    Object.assign(txClient.options.serializers, client.options.serializers);
  }
  return db;
}

const value = { duration: 6, prompt_optimizer: true };
const show = (label, x) => console.log(label.padEnd(46), JSON.stringify(x));
const readOnly = (db, fn) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx);
  });
const kind = async (q) => (await q.execute(sql`select jsonb_typeof(${sql.param(value, generations.params)}) as kind`))[0].kind;
const typed = async (q) => {
  const [r] = await q.select({ createdAt: generations.createdAt, params: generations.params, costUsd: generations.costUsd }).from(generations).limit(1);
  return r ? { createdAtIsDate: r.createdAt instanceof Date, paramsType: typeof r.params, costUsdType: typeof r.costUsd } : null;
};

const asIs = createDb(false);
show("PR #11 pooled client, jsonb param", await kind(asIs));
show("PR #11 db.transaction, jsonb param", await readOnly(asIs, kind));
show("PR #11 pooled client, typed select", await typed(asIs));
show("PR #11 db.transaction, typed select", await readOnly(asIs, typed));

const fixed = createDb(true);
show("with handlers copied, db.transaction, jsonb", await readOnly(fixed, kind));
show("with handlers copied, db.transaction, select", await readOnly(fixed, typed));

const [size] = await fixed.execute(
  sql`select pg_size_pretty(pg_database_size(current_database())) as db, (select count(*)::int from generations) as generations, (select count(*)::int from users) as users`,
);
show("database", size);

const [{ uid }] = await fixed.execute(sql`select coalesce((select user_id from generations group by user_id order by count(*) desc limit 1), 0) as uid`);
const ms = (t0) => Math.round(performance.now() - t0);
const timings = { tx: [], plain: [] };
for (let i = 0; i < 8; i++) {
  let t0 = performance.now();
  await readOnly(fixed, async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin-teams-caps-proto'))`);
    await tx.execute(sql`select coalesce(sum(cost_usd), 0) from generations where user_id = ${uid}`);
  });
  timings.tx.push(ms(t0));
  t0 = performance.now();
  await fixed.execute(sql`select coalesce(sum(cost_usd), 0) from generations where user_id = ${uid}`);
  timings.plain.push(ms(t0));
}
show("lock + sum in a read-only transaction, ms", timings.tx);
show("the sum alone on the pooled client, ms", timings.plain);

const plan = await readOnly(fixed, (tx) => tx.execute(sql`explain (analyze) select coalesce(sum(cost_usd), 0) from generations where user_id = ${uid}`));
console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
process.exit(0);
