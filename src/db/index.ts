import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { DrizzleQueryError } from "drizzle-orm/errors";
import * as schema from "./schema";

/** Every warm server instance holds up to this many of the pooler's client slots (200 on Supabase Free). */
function poolMax() {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`DB_POOL_MAX must be a positive integer, got "${raw}"`);
  return n;
}

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supabase: use the Transaction pooler URL (port 6543) on Vercel.
  // - prepare: false — pgbouncer transaction mode does not support prepared statements.
  // - max_pipeline: 0 sends one query per connection at a time. The transaction pooler hands
  //   the server connection back at the first reply, so a query sent before that reply never
  //   gets its answer, and the next reply on the socket resolves the wrong query.
  //   postgres-js 3.4.9 reads max_pipeline but leaves it out of its types, hence `pooled`.
  // - idle_timeout / max_lifetime — drop idle sockets ourselves before the pooler
  //   does; otherwise the next query can hang for a minute on a half-closed socket.
  // - connect_timeout — fail fast instead of blocking a page render.
  // - ssl: "require" encrypts the link to the pooler (no certificate check; the URL alone has no sslmode).
  const options = { prepare: false, ssl: "require" as const, idle_timeout: 20, max_lifetime: 60 * 30, connect_timeout: 10 };
  const pooled = { ...options, max: poolMax(), max_pipeline: 0 };
  const client = postgres(url, pooled);
  // With max_pipeline 0, sql.begin() sends BEGIN but never reserves its connection
  // (porsager/postgres#1189), so transactions get their own connection with the default.
  // The pooler keeps the server connection until COMMIT, so pipelining inside one is safe.
  const transactions = postgres(url, { ...options, max: 1 });
  client.begin = transactions.begin;
  const db = drizzle(client, { schema });
  // drizzle registers its pass-through json, jsonb and date handlers only on the client it wraps.
  // Without them a jsonb parameter inside a transaction is stringified twice and stored as a JSON string.
  Object.assign(transactions.options.parsers, client.options.parsers);
  Object.assign(transactions.options.serializers, client.options.serializers);
  return db;
}

// Cached on globalThis so Next dev HMR reuses one pool instead of leaking
// a connection per module reload.
const g = globalThis as unknown as { __vgsDb?: ReturnType<typeof createDb> };

/** Lazy so `next build` never touches the database. */
export function getDb() {
  if (!g.__vgsDb) g.__vgsDb = createDb();
  return g.__vgsDb;
}

export { schema };

export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

export function pgErrorCode(e: unknown): string | undefined {
  const code = e instanceof DrizzleQueryError ? (e.cause as { code?: unknown } | undefined)?.code : undefined;
  return typeof code === "string" ? code : undefined;
}
