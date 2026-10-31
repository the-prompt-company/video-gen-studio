import { and, desc, eq, exists, isNull, lte, notExists, sql } from "drizzle-orm";
import { dbNowMs, getDb, schema } from "@/db";
import type { Generation } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { EARLIER, threadTitle, type PublicThread, type ThreadId, type ThreadRef } from "@/lib/threads";

const t = schema.threads;
const openChat = (userId: number, id: ThreadId) => and(eq(t.id, id), eq(t.userId, userId), eq(t.kind, "chat"), isNull(t.deletedAt));
const earlierDeleted = (userId: number) => and(eq(t.userId, userId), eq(t.kind, "earlier"));

/** The member's visible threads, the one with the newest generation first. */
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
 * The newest `limit` generations of a visible thread, or the `limit` just older than the member's row `before`, with
 * whether older ones remain and the database's clock. Null when the member cannot see the thread, or when it has no
 * row before the cursor, which only a thread deleted since the last page can answer, because rows are never deleted.
 */
export async function threadFeed(userId: number, ref: ThreadRef, limit: number, before: string | null = null): Promise<{ rows: Generation[]; more: boolean; now: number } | null> {
  const db = getDb();
  const g = schema.generations;
  const member =
    ref.kind === "earlier"
      ? and(isNull(g.threadId), notExists(db.select({ one: sql`1` }).from(t).where(earlierDeleted(userId))))
      : and(eq(g.threadId, ref.id), exists(db.select({ one: sql`1` }).from(t).where(openChat(userId, ref.id))));
  // The cursor's exact created_at, read here: the browser's copy has lost its microseconds. The id breaks a tie.
  const at = sql`(select c.created_at from generations c where c.id = ${before} and c.user_id = ${userId})`;
  const older = before === null ? undefined : and(lte(g.createdAt, at), sql`(${g.createdAt}, ${g.id}) < (${at}, ${before}::uuid)`);
  const found = await db
    .select({ row: g, now: dbNowMs })
    .from(g)
    .where(and(eq(g.userId, userId), member, older))
    .orderBy(desc(g.createdAt), desc(g.id))
    .limit(limit + 1);
  if (found.length === 0) return null;
  return { rows: found.slice(0, limit).map((f) => f.row), more: found.length > limit, now: found[0].now };
}

export type ClaimedThread = { threadId: ThreadId | null; thread: PublicThread };

/**
 * Open the thread the next generation goes into. A chat thread that does not exist yet is created here, by its first
 * generation, titled from that generation's prompt. Sending the same new id again, after a lost answer or a double
 * click, finds the thread the first send created, so one id never makes two threads.
 */
export async function claimThread(userId: number, ref: ThreadRef, prompt: string): Promise<ClaimedThread> {
  const db = getDb();
  if (ref.kind === "earlier") {
    const [deleted] = await db.select({ id: t.id }).from(t).where(earlierDeleted(userId)).limit(1);
    if (deleted) throw new HttpError(404, "noSuchThread");
    return { threadId: null, thread: { kind: "earlier", id: EARLIER } };
  }
  // No conflict target: two sends of one new id race on both the primary key and (id, user_id), and either may report it.
  const [made] = await db.insert(t).values({ id: ref.id, userId, kind: "chat", title: threadTitle(prompt) }).onConflictDoNothing().returning({ id: t.id, title: t.title });
  const [open] = made ? [made] : await db.select({ id: t.id, title: t.title }).from(t).where(openChat(userId, ref.id)).limit(1);
  if (!open) throw new HttpError(404, "noSuchThread");
  return { threadId: open.id, thread: { kind: "chat", id: open.id, title: open.title ?? "" } };
}

/**
 * Take a thread off the member's list. Its generations stay exactly as they are: in the gallery, in every usage
 * number, and running on if live.
 */
export async function deleteThread(userId: number, ref: ThreadRef): Promise<void> {
  const db = getDb();
  const gone =
    ref.kind === "chat"
      ? await db.update(t).set({ deletedAt: sql`now()` }).where(openChat(userId, ref.id)).returning({ id: t.id })
      : await db.execute(sql`
          insert into threads (user_id, kind, deleted_at)
          select ${userId}, 'earlier', now()
          where exists (select 1 from generations g where g.user_id = ${userId} and g.thread_id is null)
          on conflict (user_id) where kind = 'earlier' do nothing
          returning id`);
  if (gone.length === 0) throw new HttpError(404, "noSuchThread");
}
