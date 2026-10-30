import { and, desc, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import { dbNowMs, getDb, schema } from "@/db";
import type { Generation } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { EARLIER, threadTitle, type PublicThread, type ThreadId, type ThreadRef } from "@/lib/threads";

/*
 * A member sees a thread when it is theirs, not deleted, and holds at least one generation. Every rule below reads
 * that one definition, so a thread another member owns, a deleted one, and one that never existed look the same: 404.
 * Admins get no exception; a thread is private to its owner.
 */

/** The member's visible threads, the one with the newest generation first. One statement. */
export async function listThreads(userId: number): Promise<PublicThread[]> {
  const rows = await getDb().execute<{ id: string; title: string | null }>(sql`
    select t.id::text as id, t.title, last.at
    from threads t
    cross join lateral (select max(g.created_at) as at from generations g where g.user_id = t.user_id and g.thread_id = t.id) last
    where t.user_id = ${userId} and t.kind = 'chat' and t.deleted_at is null and last.at is not null
    union all
    select ${EARLIER}, null, last.at
    from (select max(g.created_at) as at from generations g where g.user_id = ${userId} and g.thread_id is null) last
    where last.at is not null and not exists (select 1 from threads e where e.user_id = ${userId} and e.kind = 'earlier')
    order by at desc, id`);
  return rows.map((r) => (r.id === EARLIER ? { kind: "earlier", id: EARLIER } : { kind: "chat", id: r.id as ThreadId, title: r.title ?? "" }));
}

/**
 * The newest `limit` generations of a visible thread and the database's clock, or null when the member cannot see it.
 * One statement.
 */
export async function threadFeed(userId: number, ref: ThreadRef, limit: number): Promise<{ rows: Generation[]; now: number } | null> {
  const db = getDb();
  const g = schema.generations;
  const t = schema.threads;
  const member =
    ref.kind === "earlier"
      ? and(isNull(g.threadId), notExists(db.select({ one: sql`1` }).from(t).where(and(eq(t.userId, userId), eq(t.kind, "earlier")))))
      : and(
          eq(g.threadId, ref.id),
          exists(db.select({ one: sql`1` }).from(t).where(and(eq(t.id, ref.id), eq(t.userId, userId), eq(t.kind, "chat"), isNull(t.deletedAt)))),
        );
  const found = await db
    .select({ row: g, now: dbNowMs })
    .from(g)
    .where(and(eq(g.userId, userId), member))
    .orderBy(desc(g.createdAt))
    .limit(limit);
  if (found.length === 0) return null;
  return { rows: found.map((f) => f.row), now: found[0].now };
}

/** The thread a generation goes into: its id, null for the earlier history, and how the playground lists it. */
export type ClaimedThread = { threadId: ThreadId | null; thread: PublicThread };

/**
 * Open the thread the next generation goes into. A chat thread that does not exist yet is created here, by its first
 * generation, titled from that generation's prompt. Sending the same new id again, after a lost answer or a double
 * click, finds the thread the first send created, so one id never makes two threads.
 */
export async function claimThread(userId: number, ref: ThreadRef, prompt: string): Promise<ClaimedThread> {
  const db = getDb();
  const t = schema.threads;
  if (ref.kind === "earlier") {
    const [deleted] = await db.select({ id: t.id }).from(t).where(and(eq(t.userId, userId), eq(t.kind, "earlier"))).limit(1);
    if (deleted) throw new HttpError(404, "noSuchThread");
    return { threadId: null, thread: { kind: "earlier", id: EARLIER } };
  }
  const [made] = await db
    .insert(t)
    .values({ id: ref.id, userId, kind: "chat", title: threadTitle(prompt) })
    .onConflictDoNothing({ target: t.id })
    .returning({ id: t.id, title: t.title });
  const [open] = made
    ? [made]
    : await db
        .select({ id: t.id, title: t.title })
        .from(t)
        .where(and(eq(t.id, ref.id), eq(t.userId, userId), eq(t.kind, "chat"), isNull(t.deletedAt)))
        .limit(1);
  if (!open) throw new HttpError(404, "noSuchThread");
  return { threadId: open.id, thread: { kind: "chat", id: open.id, title: open.title ?? "" } };
}

/**
 * Take a thread off the member's list. Its generations stay exactly as they are: in the gallery, in every usage
 * number, and running on if live. The earlier history has no row, so deleting it writes one that says so.
 */
export async function deleteThread(userId: number, ref: ThreadRef): Promise<void> {
  const db = getDb();
  const t = schema.threads;
  const gone =
    ref.kind === "chat"
      ? await db
          .update(t)
          .set({ deletedAt: sql`now()` })
          .where(and(eq(t.id, ref.id), eq(t.userId, userId), eq(t.kind, "chat"), isNull(t.deletedAt)))
          .returning({ id: t.id })
      : await db.execute(sql`
          insert into threads (user_id, kind, deleted_at)
          select ${userId}, 'earlier', now()
          where exists (select 1 from generations g where g.user_id = ${userId} and g.thread_id is null)
          on conflict (user_id) where kind = 'earlier' do nothing
          returning id`);
  if (gone.length === 0) throw new HttpError(404, "noSuchThread");
}
