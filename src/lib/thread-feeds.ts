import type { PublicGeneration } from "@/lib/generations";

/** A thread's first page and each older page hold up to this many results. */
export const FEED_LIMIT = 12;

/** The results this tab has shown of one thread, newest first, and whether the server holds older ones. */
export type ThreadFeed = { rows: readonly PublicGeneration[]; more: boolean };

/** Each thread's results this tab has shown, and the member's count of finished results. */
export type Feeds = { byThread: Readonly<Record<string, ThreadFeed>>; galleryTotal: number };

const NONE: ThreadFeed = { rows: [], more: false };

const finished = (before: PublicGeneration | undefined, after: PublicGeneration) => (before && before.status !== "completed" && after.status === "completed" ? 1 : 0);

/** A row into the thread that already holds it, or else at the top of `thread`. */
export function withRow(feeds: Feeds, item: PublicGeneration, thread: string): Feeds {
  const holder = Object.keys(feeds.byThread).find((k) => feeds.byThread[k].rows.some((x) => x.id === item.id)) ?? thread;
  const feed = feeds.byThread[holder] ?? NONE;
  const prev = feed.rows.find((x) => x.id === item.id);
  const rows = prev ? feed.rows.map((x) => (x.id === item.id ? item : x)) : [item, ...feed.rows];
  return { byThread: { ...feeds.byThread, [holder]: { ...feed, rows } }, galleryTotal: feeds.galleryTotal + finished(prev, item) };
}

/**
 * A thread's newest page as the server answered, under the rows this tab sent after the newest of them. Older pages
 * the tab loaded before are dropped, so the stream starts again from the newest page.
 */
export function withAnswer(feeds: Feeds, thread: string, answered: readonly PublicGeneration[], more: boolean): Feeds {
  const cached = feeds.byThread[thread]?.rows ?? NONE.rows;
  const newest = answered[0] ? new Date(answered[0].createdAt).getTime() : -Infinity;
  const sentSince = cached.filter((x) => new Date(x.createdAt).getTime() > newest && !answered.some((a) => a.id === x.id));
  const done = answered.reduce((n, a) => n + finished(cached.find((x) => x.id === a.id), a), 0);
  return { byThread: { ...feeds.byThread, [thread]: { rows: [...sentSince, ...answered], more } }, galleryTotal: feeds.galleryTotal + done };
}

/** An older page below the rows the thread already shows. */
export function withOlder(feeds: Feeds, thread: string, older: readonly PublicGeneration[], more: boolean): Feeds {
  const feed = feeds.byThread[thread] ?? NONE;
  const rows = [...feed.rows, ...older.filter((o) => !feed.rows.some((x) => x.id === o.id))];
  return { ...feeds, byThread: { ...feeds.byThread, [thread]: { rows, more } } };
}

export function withoutThread(feeds: Feeds, thread: string): Feeds {
  const byThread = { ...feeds.byThread };
  delete byThread[thread];
  return { ...feeds, byThread };
}
