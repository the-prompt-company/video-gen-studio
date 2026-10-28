/**
 * Read-only regression check for src/db/index.ts: a jsonb parameter must reach Postgres as an object both on the
 * pooled client and inside db.transaction() (which runs on a separate client). Exits 1 if either side differs.
 *
 *   npx tsx scripts/db-tx-jsonb-check.mts
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const watchdog = setTimeout(() => { console.log("watchdog"); process.exit(2); }, 30_000);
const db = getDb();
const value = { duration: 6, prompt_optimizer: true };
const kind = async (q: Pick<typeof db, "execute">) => (await q.execute(sql`select jsonb_typeof(${sql.param(value, schema.generations.params)}) as kind`))[0].kind;
const pooled = await kind(db);
const inTx = await db.transaction(async (tx) => { await tx.execute(sql`set transaction read only`); return kind(tx); });
const typed = await db.transaction(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  const [r] = await tx.select({ createdAt: schema.generations.createdAt }).from(schema.generations).limit(1);
  return r ? r.createdAt instanceof Date : "no rows";
});
console.log(JSON.stringify({ pooled, inTransaction: inTx, transactionDateParsed: typed }));
clearTimeout(watchdog);
process.exit(pooled === "object" && inTx === "object" ? 0 : 1);
