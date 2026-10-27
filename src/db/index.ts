import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supabase: use the Transaction pooler URL (port 6543) on Vercel.
  // Pooled connections (pgbouncer transaction mode) do not support prepared statements.
  const client = postgres(url, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

/** Lazy so `next build` never touches the database. */
export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
