# Database pool diagnosis: postgres-js on the Supabase transaction pooler

The goal is that during a launch burst (20 people, hundreds of generations), the database client is never what pushes a Higgsfield webhook past its 10 s receiver window or makes a submit take about 10 s. The project stays on the Supabase Free plan.

## Summary

The Supabase transaction pooler (Supavisor, port 6543) releases the Postgres server connection when it sees the first `ReadyForQuery` with status idle. postgres-js 3.4.9 pipelines, so it can have several queries in flight on one client connection. The server runs all of them, but the pooler drops every reply that reaches it after the first one. postgres-js matches replies to queries in order, so the dropped queries wait forever, and the next reply that does arrive resolves the wrong query.

`src/db/index.ts` now sets `max_pipeline: 0`, so each connection carries one query at a time. With that setting, every probe completed, with no hang and no wrong row. `max_pipeline: 0` also breaks `sql.begin()` in postgres-js ([porsager/postgres#1189](https://github.com/porsager/postgres/issues/1189)), so `db.transaction()` gets its own single connection with the default setting. Stay on the transaction pooler. On the Free plan the session pooler admits only 15 clients in total.

## How the hang happens

### postgres-js puts a second query on a busy connection

`handler` in `node_modules/postgres/src/index.js` takes an idle connection first, then opens a closed one, and then writes the query onto a busy connection (`go(busy.shift(), query)`). `onopen` drains the queue onto a connection in a loop. `execute` in `src/connection.js` keeps a connection busy while this expression is true:

```js
write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection))
```

`write` buffers output until `setImmediate`, so queries issued in the same tick leave in one TCP write. `ReadyForQuery` resolves the current query and then takes the next one from `sent`. It returns the connection to the pool only when `sent` is empty.

Whether postgres-js writes a second query behind a query depends on the first query's parameters:

- A parameterless query, such as `db.select().from(schema.models)` on the playground page or in `src/app/api/admin/models/route.ts`, goes out as a simple `Query` message. `execute` returns true, the connection stays `busy`, and the next queries can be written behind it.
- A parameterized query has `describeFirst` set because `prepare: false` never caches a statement. It sends `Parse/Describe/Flush`, waits a round trip, then sends `Bind/Execute/Sync`. `execute` returns false, so nothing is written behind it. It can still be written behind a parameterless query and lose its reply.

`max_pipeline: 1` does not help. `sent.length < 1` is true for the first query, so one more query can still be written behind it.

### The pooler drops replies after the first `ReadyForQuery`

Supabase documents this behavior. Transaction mode "returns a connection to the pool as soon as it sees one reply finish", and "`postgres.js` pipelines queries by default, so this combination can hang queries or return mismatched rows" ([Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)). A socket tap on one client connection shows it (`>` is a frontend write, `<` is backend data, `Z` is `ReadyForQuery`):

```text
>PDBESPDBESPDBES@80      three queries in one write
<D(r0q0) ZI@85           only the first reply comes back
>PDBES@8104              the next query, 8 s later
<D(r0after) ZI@8110      its reply resolves q1, the head of `sent`
```

An observer on the session pooler then saw a server connection whose last statement was `select 'M-q2'`, state `idle`, in 3 of 3 runs. So the server ran the lost queries, and the pooler threw their replies away. The trigger is several queries in flight on one client connection, not one TCP packet. With three separate writes 1 ms apart, the pooler held q1 and q2 until q0 finished, forwarded them together, and dropped q2's reply in 5 of 8 runs. A reply survives only when it reaches the pooler in the same backend read as the first.

### Nothing times out

A wedged connection never returns to the `open` queue, so `idle_timeout` never fires. `max_lifetime` calls `end()`, which waits for in-flight queries. With `idle_timeout: 1` and `max_lifetime: 3`, the lost queries were still pending after 11 s. That is why one verifier probe hung for 40 minutes.

## Evidence

All numbers come from a Windows PC in Korea against the project's pooler (`aws-0-ap-northeast-2`), with a round trip of about 6.5 ms. Probes ran one at a time and opened at most 20 connections.

### One connection, one variable at a time

Each row pipelines two queries on `max: 1` and then sends one more query, 5 runs, 15 outcomes.

| Change from the baseline | Hung outcomes |
| --- | --- |
| Baseline: transaction pooler, extended protocol, `max_pipeline` 100 | 8 of 15 |
| Simple protocol (`Query` message) | 4 of 15 |
| `fetch_types: false` | 6 of 15 |
| `max_pipeline: 1` | 8 of 15 |
| `max_pipeline: 0` | 0 of 15 |
| Session pooler (port 5432) | 0 of 15 |

### Pool configurations under N parallel queries

`load.mjs` warms `max` connections, then sends N queries at once and checks every returned value. Each cell is 3 runs, interleaved across configurations. "Parameterless" is `select <n>::int` with no parameters. "Parameterized" is `select $1::int`, the shape of almost every app query. Latency is per query from the start of the burst, as median and range across runs.

| Driver, pooler, pool | Query | N | Completed per run | Hung | Wrong row | Max ms |
| --- | --- | --- | --- | --- | --- | --- |
| postgres-js, transaction, max 5, `max_pipeline` 100 (master) | parameterless | 6 | 6, 5, 5 | 2 | 0 | 10 (8-10) |
| same | parameterless | 50 | 4, 9, 5 | 131 | 1 | 9 (9-10) |
| same | parameterless | 300 | 10, 4, 6 | 857 | 23 | 14 (11-15) |
| same | parameterized | 300 | 300, 300, 300 | 0 | 0 | 917 (729-959) |
| postgres-js, transaction, max 5, `max_pipeline` 1 | parameterless | 300 | 5, 5, 7 | 883 | 0 | 12 (11-18) |
| postgres-js, transaction, max 20, `max_pipeline` 100 | parameterless | 50 | 21, 17, 24 | 77 | 11 | 10 (8-10) |
| same | parameterless | 300 | 30, 29, 20 | 805 | 16 | 23 (19-25) |
| postgres-js, transaction, max 5, `max_pipeline` 0 | parameterless | 300 | 300, 300, 300 | 0 | 0 | 395 (376-443) |
| same | parameterized | 300 | 300, 300, 300 | 0 | 0 | 744 (715-886) |
| postgres-js, transaction, max 10, `max_pipeline` 0 | parameterized | 300 | 300, 300, 300 | 0 | 0 | 396 (357-520) |
| postgres-js, transaction, max 20, `max_pipeline` 0 | parameterized | 300 | 300, 300, 300 | 0 | 0 | 221 (194-288) |
| postgres-js, session, max 5, `max_pipeline` 100 | parameterless | 300 | 300, 300, 300 | 0 | 0 | 22 (21-25) |
| same | parameterized | 300 | 300, 300, 300 | 0 | 0 | 859 (830-871) |
| `pg` 8.23.1, transaction, max 5 | parameterized | 300 | 300, 300, 300 | 0 | 0 | 459 (424-460) |

Every `max_pipeline` 0 cell completed at N = 6, 50, and 300 with no hang and no wrong row. The full 48-row table is in [Appendix: full matrix](#appendix-full-matrix).

The latency bound is the client connection count times the round trips per query. With `max_pipeline: 0`, 300 parameterized queries on 5 connections take 60 rounds of 2 round trips, about 60 × 2 × 6.5 ms = 780 ms (measured 744). Doubling `max` halves it: 396 ms at 10 and 221 ms at 20. `pg` sends `Parse/Bind/Execute/Sync` in one write, so it takes 1 round trip per parameterized query (459 ms). The session pooler finishes parameterless queries in 22 ms because pipelining is safe there. Its parameterized queries are as slow as the transaction pooler's, because `describeFirst` stops pipelining.

### The app's own client, before and after

`appmix.ts` imports `getDb()` and sends N drizzle queries at once. One in four has no parameters, as on the playground page. Three runs each, alternating master and this branch.

| Client | N | Completed per run | Hung | Wrong row | Max ms |
| --- | --- | --- | --- | --- | --- |
| master | 50 | 16, 37, 33 | 63 | 0 | 119-192 |
| this branch | 50 | 50, 50, 50 | 0 | 0 | 140-150 |
| master | 300 | 21, 21, 21 | 837 | 0 | 132-149 |
| this branch | 300 | 300, 300, 300 | 0 | 0 | 666-876 |

### Transactions

| Probe (session pooler, `max: 1`) | `sql.begin()` | `db.transaction()` | Connection left inside a transaction |
| --- | --- | --- | --- |
| `max_pipeline` 100 | ok | ok | no |
| `max_pipeline` 0 | `Cannot set properties of undefined (setting 'onclose')` | same error | yes, plus an unhandled rejection |

On this branch, through `getDb()` on the transaction pooler (`apptx.ts`, run on the final code):

- 10 of 10 sequential transactions returned the right values. Each pipelined two parameterless and two parameterized selects.
- 5 of 5 concurrent transactions returned the right values, and so did 50 of 50 ordinary queries sent at the same time.
- A transaction that throws rejects with its own error, and the next query works.
- No Supavisor server connection was left `idle in transaction`, and there were no unhandled rejections.

The same probe on master's client completed 21 of 50 ordinary queries, and the throwing transaction hung.

## Free-plan limits

| Limit | Value | Source |
| --- | --- | --- |
| Postgres `max_connections` | 60, of which 3 are reserved for superusers | measured, `current_setting('max_connections')` |
| Pool size (server connections per user, database, and mode) | 15 | measured, from the session-mode error below |
| Transaction mode, server connections at once | 16 | measured, 0.5 s sleeps: 15 or 16 at once finish in one wave, 17 to 20 take two (9 runs) |
| Session mode, clients | 15. Clients past 15 fail within 80 ms, without queueing, with `XX000 (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15` | measured, 16 and 18 clients |
| Pooler client connections | 200 | [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk), "Nano (free)" row |

At idle, Supabase's own services hold about 5 client backends (PostgREST, the Supavisor auth query, the metrics exporter).

## Recommendation

Keep `DATABASE_URL` on the transaction pooler (port 6543) and ship this change. Leave `DB_POOL_MAX` at its default of 5.

### Arithmetic for Vercel Fluid compute

Every warm instance holds up to `DB_POOL_MAX` client connections to the pooler. It holds one more only while a `db.transaction()` runs, and the app runs none. Keep half of the 200 client slots for preview deployments, local development, `drizzle-kit`, and scripts.

- On the transaction pooler, keep instances × `DB_POOL_MAX` ≤ 100. With 5, that allows up to 20 warm instances, and 40 before the hard limit. Postgres stays safe however many instances run, because the pooler opens at most 16 server connections. Even with the session pool full as well, 16 + 15 + 5 = 36 is under the 57 that clients can use.
- On the session pooler, instances × `DB_POOL_MAX` must stay ≤ 15, and every other session client shares those 15. With 5, a fourth instance's queries fail at once with `EMAXCONNSESSION`, and a webhook would answer 5xx. Do not use it on Vercel on the Free plan.

Demand and capacity for one instance:

- A webhook for a live row runs about 6 parameterized queries in `onProviderHook`. It reads the row, claims the check, reads the owner's key, reads the price when the row completes, applies the step, and sometimes reads the row again. The Higgsfield status call holds no database connection.
- The verifier's production-build burst logged 1,744 webhook deliveries over 160 s, with a peak of 87 in one second (`hookproxy-prod.log`). At 6 queries each, the peak is about 520 queries per second.
- With `DB_POOL_MAX=5`, one instance on this PC served 340 to 450 app-shaped queries per second (300 in 0.67 to 0.88 s, at a 6.5 ms round trip). Capacity scales with the round trip, and Vercel `icn1` sits in the same AWS region as the pooler, so a Vercel instance should serve several times more. That is an inference. It was not measured from Vercel.

Take the worst case: one instance takes the whole peak at this PC's round trip. About 520 - 340 = 180 queries back up, and each waits about 180 / 340 ≈ 0.5 s. A webhook runs its 6 queries one after another, so it waits about 3 s, which is still inside the 10 s window. From Vercel the backlog should be smaller or absent. Raise `DB_POOL_MAX` to 10 if Vercel's function logs show webhook latency above 1 s during a burst, and keep instances × `DB_POOL_MAX` ≤ 100.

## Not covered here

- The end-to-end burst (`burst429-prod`) was not rerun on this branch, because it writes rows and this diagnosis was read-only. Rerun it before launch. On master, its webhook proxy log (`hookproxy-prod.log`) shows p95 11.3 s and 114 of 1,744 deliveries over 10 s.
- Both clients in `src/db/index.ts` require TLS (`ssl: "require"`), so the link to the pooler is encrypted. postgres-js sets `rejectUnauthorized: false` for `"require"`, so the server certificate is not verified. Verifying it needs Supabase's CA certificate passed as `ssl: { ca }`. That was not tested here.
- A suspended Fluid instance may keep its client connections open until it resumes, because `idle_timeout` runs only while the instance runs. The 50% headroom above covers this. It was not measured.
- Switching to `pg` with `drizzle-orm/node-postgres` would remove the transaction workaround and halve the round trips for parameterized queries (459 ms against 744 ms above). It changes `package.json` and the shape that `db.execute()` returns, so it is a separate change.
- When porsager/postgres#1189 is fixed upstream, the second client for `begin` can go.

## How to reproduce

Save this as `repro.mjs` in `web/` and run `npx dotenv -e .env.local -- node repro.mjs`. Then run it again with `MP=0` in the environment.

```js
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, max_pipeline: Number(process.env.MP ?? 100) });
await sql`select 1`;
const seen = { q0: "pending", q1: "pending", q2: "pending", q3: "pending", q4: "pending", after: "pending" };
[0, 1, 2, 3, 4].forEach((i) => sql.unsafe(`select ${i}::int as v`, [], { simple: false }).execute().then((r) => (seen[`q${i}`] = `v=${r[0].v}`)));
await new Promise((r) => setTimeout(r, 3000));
sql`select 9 as v`.execute().then((r) => (seen.after = `v=${r[0].v}`));
await new Promise((r) => setTimeout(r, 2000));
console.log(`max_pipeline=${process.env.MP ?? 100}`, JSON.stringify(seen));
await sql.end({ timeout: 1 }).catch(() => {});
process.exit(0);
```

In 4 of 4 runs with the default, a later query got the wrong row and the rest stayed pending, for example `{"q0":"v=0","q1":"v=9","q2":"pending",...}`. In 4 of 4 runs with `MP=0`, every query got its own row.

The other probes (`load.mjs`, `appmix.ts`, `apptx.ts`, `begin.mjs`, `sessioncap.mjs`, `txpool.mjs`, and `pipe.mjs` with its socket tap) stayed in the diagnosing worktree's `.verify/`, which git ignores.

## Appendix: full matrix

`summarize.mjs` generated this table from `matrix.jsonl`. It covers 8 configurations, 2 query kinds, and N = 6, 50, and 300, with 3 runs each and a 10 s cap per query. "simple" is the parameterless query and "param" is the parameterized one.

| driver | pooler | max | max_pipeline | query | N | completed per rep | hung | mismatched | errors | p50 ms (median, range) | p95 ms (median, range) | max ms (median, range) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| postgres | transaction 6543 | 5 | 100 | simple | 6 | 6, 5, 5 | 2 | 0 | 0 | 8 (8-8) | 10 (8-10) | 10 (8-10) |
| postgres | transaction 6543 | 5 | 1 | simple | 6 | 5, 6, 6 | 1 | 0 | 0 | 8 (7-9) | 8 (8-10) | 8 (8-10) |
| postgres | transaction 6543 | 5 | 0 | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 9 (7-11) | 15 (13-18) | 15 (13-18) |
| postgres | transaction 6543 | 10 | 0 | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 7 (6-9) | 8 (6-9) | 8 (6-9) |
| postgres | transaction 6543 | 20 | 0 | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 7 (7-9) | 7 (7-9) | 7 (7-9) |
| postgres | transaction 6543 | 20 | 100 | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 8 (7-11) | 8 (7-11) | 8 (7-11) |
| postgres | session 5432 | 5 | 100 | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 7 (7-8) | 8 (7-9) | 8 (7-9) |
| pg | transaction 6543 | 5 | n/a | simple | 6 | 6, 6, 6 | 0 | 0 | 0 | 8 (7-9) | 15 (13-15) | 15 (13-15) |
| postgres | transaction 6543 | 5 | 100 | simple | 50 | 4, 9, 5 | 131 | 1 | 0 | 8 (7-10) | 9 (9-10) | 9 (9-10) |
| postgres | transaction 6543 | 5 | 1 | simple | 50 | 7, 9, 7 | 127 | 0 | 0 | 9 (7-11) | 15 (13-18) | 15 (13-18) |
| postgres | transaction 6543 | 5 | 0 | simple | 50 | 50, 50, 50 | 0 | 0 | 0 | 34 (32-39) | 69 (56-73) | 69 (59-76) |
| postgres | transaction 6543 | 10 | 0 | simple | 50 | 50, 50, 50 | 0 | 0 | 0 | 20 (17-24) | 33 (32-47) | 37 (32-50) |
| postgres | transaction 6543 | 20 | 0 | simple | 50 | 50, 50, 50 | 0 | 0 | 0 | 14 (14-20) | 21 (20-29) | 21 (21-30) |
| postgres | transaction 6543 | 20 | 100 | simple | 50 | 21, 17, 24 | 77 | 11 | 0 | 8 (7-9) | 8 (8-10) | 10 (8-10) |
| postgres | session 5432 | 5 | 100 | simple | 50 | 50, 50, 50 | 0 | 0 | 0 | 7 (7-11) | 9 (8-11) | 9 (8-11) |
| pg | transaction 6543 | 5 | n/a | simple | 50 | 50, 50, 50 | 0 | 0 | 0 | 31 (30-45) | 56 (54-78) | 57 (57-84) |
| postgres | transaction 6543 | 5 | 100 | simple | 300 | 10, 4, 6 | 857 | 23 | 0 | 12 (11-13) | 14 (11-15) | 14 (11-15) |
| postgres | transaction 6543 | 5 | 1 | simple | 300 | 5, 5, 7 | 883 | 0 | 0 | 11 (10-12) | 12 (11-18) | 12 (11-18) |
| postgres | transaction 6543 | 5 | 0 | simple | 300 | 300, 300, 300 | 0 | 0 | 0 | 210 (183-218) | 377 (353-420) | 395 (376-443) |
| postgres | transaction 6543 | 10 | 0 | simple | 300 | 300, 300, 300 | 0 | 0 | 0 | 108 (101-122) | 217 (186-228) | 225 (198-239) |
| postgres | transaction 6543 | 20 | 0 | simple | 300 | 300, 300, 300 | 0 | 0 | 0 | 68 (64-73) | 116 (103-124) | 122 (106-130) |
| postgres | transaction 6543 | 20 | 100 | simple | 300 | 30, 29, 20 | 805 | 16 | 0 | 16 (16-16) | 23 (18-25) | 23 (19-25) |
| postgres | session 5432 | 5 | 100 | simple | 300 | 300, 300, 300 | 0 | 0 | 0 | 16 (16-18) | 21 (21-24) | 22 (21-25) |
| pg | transaction 6543 | 5 | n/a | simple | 300 | 300, 300, 300 | 0 | 0 | 0 | 184 (183-220) | 348 (347-412) | 365 (364-432) |
| postgres | transaction 6543 | 5 | 100 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 13 (13-15) | 23 (22-29) | 23 (22-29) |
| postgres | transaction 6543 | 5 | 1 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 16 (12-20) | 27 (21-36) | 27 (21-36) |
| postgres | transaction 6543 | 5 | 0 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 13 (11-14) | 23 (22-28) | 23 (22-28) |
| postgres | transaction 6543 | 10 | 0 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 12 (11-14) | 12 (12-15) | 12 (12-15) |
| postgres | transaction 6543 | 20 | 0 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 18 (14-18) | 18 (14-18) | 18 (14-18) |
| postgres | transaction 6543 | 20 | 100 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 12 (12-14) | 13 (13-15) | 13 (13-15) |
| postgres | session 5432 | 5 | 100 | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 13 (11-16) | 24 (22-31) | 24 (22-31) |
| pg | transaction 6543 | 5 | n/a | param | 6 | 6, 6, 6 | 0 | 0 | 0 | 9 (8-9) | 15 (13-15) | 15 (13-15) |
| postgres | transaction 6543 | 5 | 100 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 70 (69-83) | 126 (123-150) | 131 (124-154) |
| postgres | transaction 6543 | 5 | 1 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 70 (65-82) | 123 (117-143) | 133 (124-147) |
| postgres | transaction 6543 | 5 | 0 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 72 (66-74) | 141 (118-149) | 144 (121-150) |
| postgres | transaction 6543 | 10 | 0 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 36 (35-42) | 75 (70-75) | 78 (75-86) |
| postgres | transaction 6543 | 20 | 0 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 27 (27-38) | 42 (38-52) | 42 (39-54) |
| postgres | transaction 6543 | 20 | 100 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 34 (30-45) | 49 (47-62) | 49 (47-69) |
| postgres | session 5432 | 5 | 100 | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 77 (67-82) | 147 (113-148) | 151 (121-153) |
| pg | transaction 6543 | 5 | n/a | param | 50 | 50, 50, 50 | 0 | 0 | 0 | 38 (33-41) | 74 (58-75) | 74 (60-81) |
| postgres | transaction 6543 | 5 | 100 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 461 (367-530) | 868 (692-922) | 917 (729-959) |
| postgres | transaction 6543 | 5 | 1 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 360 (354-458) | 681 (672-856) | 715 (706-897) |
| postgres | transaction 6543 | 5 | 0 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 373 (362-460) | 711 (681-846) | 744 (715-886) |
| postgres | transaction 6543 | 10 | 0 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 198 (186-233) | 373 (340-498) | 396 (357-520) |
| postgres | transaction 6543 | 20 | 0 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 126 (102-148) | 210 (185-278) | 221 (194-288) |
| postgres | transaction 6543 | 20 | 100 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 135 (109-144) | 236 (196-250) | 244 (209-257) |
| postgres | session 5432 | 5 | 100 | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 413 (355-429) | 829 (788-832) | 859 (830-871) |
| pg | transaction 6543 | 5 | n/a | param | 300 | 300, 300, 300 | 0 | 0 | 0 | 229 (222-246) | 434 (402-436) | 459 (424-460) |
