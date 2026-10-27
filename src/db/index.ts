import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supabase: use the Transaction pooler URL (port 6543) on Vercel.
  // - prepare: false — pgbouncer transaction mode does not support prepared statements.
  // - idle_timeout / max_lifetime — drop idle sockets ourselves before the pooler
  //   does; otherwise the next query can hang for a minute on a half-closed socket.
  // - connect_timeout — fail fast instead of blocking a page render.
  const client = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
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
