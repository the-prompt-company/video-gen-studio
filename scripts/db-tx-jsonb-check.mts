/**
 * Regression check for src/db/index.ts: db.transaction() runs on a second postgres-js client, which needs drizzle's
 * type handlers too. Inside one transaction it inserts a probe user and generation, reads the generation back, and
 * rolls back. Exits 0 only if the jsonb params were stored as an object, created_at parsed to the transaction's own
 * now(), a jsonb parameter on the pooled client is an object, and no probe row remains. Any other outcome exits 1.
 *
 *   npx tsx scripts/db-tx-jsonb-check.mts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const watchdog = setTimeout(() => { console.log("watchdog"); process.exit(2); }, 30_000);
const db = getDb();
const { users, generations } = schema;
const value = { duration: 6, prompt_optimizer: true };
const username = `db-tx-jsonb-check-${randomUUID()}`;
class Rollback extends Error {}

const [{ kind: pooled }] = await db.execute<{ kind: string }>(sql`select jsonb_typeof(${sql.param(value, generations.params)}) as kind`);

let probe: { id: string; stored: string; params: unknown; createdAt: Date; nowMs: string } | undefined;
await db
  .transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ username, passwordHash: "-" }).returning({ id: users.id });
    // Named columns only, so the probe does not depend on generations columns that a migration adds or drops.
    const [row] = await tx.execute<{ id: string }>(
      sql`insert into generations (user_id, model_id, params) values (${user.id}, 'db-tx-jsonb-check', ${sql.param(value, generations.params)}) returning id`,
    );
    [probe] = await tx
      .select({
        id: generations.id,
        stored: sql<string>`jsonb_typeof(${generations.params})`,
        params: generations.params,
        createdAt: generations.createdAt,
        nowMs: sql<string>`floor(extract(epoch from now()) * 1000)::bigint::text`,
      })
      .from(generations)
      .where(eq(generations.id, row.id));
    throw new Rollback();
  })
  .catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });

const left = probe
  ? (await db.execute<{ n: number }>(
      sql`select ((select count(*) from generations where id = ${probe.id}) + (select count(*) from users where username = ${username}))::int as n`,
    ))[0].n
  : "no probe";
const result = {
  pooled,
  storedInTransaction: probe?.stored ?? "no probe",
  paramsRoundTrip: JSON.stringify(probe?.params) === JSON.stringify(value),
  createdAtIsTransactionNow: probe ? probe.createdAt instanceof Date && Math.abs(probe.createdAt.getTime() - Number(probe.nowMs)) <= 1 : false,
  probeRowsLeft: left,
};
console.log(JSON.stringify(result));
clearTimeout(watchdog);
const ok = pooled === "object" && result.storedInTransaction === "object" && result.paramsRoundTrip && result.createdAtIsTransactionNow && left === 0;
process.exit(ok ? 0 : 1);
