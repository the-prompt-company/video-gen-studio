import type { PublicGeneration } from "@/lib/generations";

/** The stage shows up to this many of a thread's newest results. */
export const FEED_LIMIT = 12;

/** Each thread's results this tab has shown, newest first, and the member's count of finished results. */
export type Feeds = { byThread: Readonly<Record<string, readonly PublicGeneration[]>>; galleryTotal: number };

const NONE: readonly PublicGeneration[] = [];

const finished = (before: PublicGeneration | undefined, after: PublicGeneration) => (before && before.status !== "completed" && after.status === "completed" ? 1 : 0);

/** A row into the thread that already holds it, or else at the top of `thread`. */
export function withRow(feeds: Feeds, item: PublicGeneration, thread: string): Feeds {
  const holder = Object.keys(feeds.byThread).find((k) => feeds.byThread[k].some((x) => x.id === item.id)) ?? thread;
  const list = feeds.byThread[holder] ?? NONE;
  const prev = list.find((x) => x.id === item.id);
  return {
    byThread: { ...feeds.byThread, [holder]: prev ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list].slice(0, FEED_LIMIT) },
    galleryTotal: feeds.galleryTotal + finished(prev, item),
  };
}

/** A thread's rows as the server answered, under the rows this tab sent after the newest of them. */
export function withAnswer(feeds: Feeds, thread: string, answered: readonly PublicGeneration[]): Feeds {
  const cached = feeds.byThread[thread] ?? NONE;
  const newest = answered[0] ? new Date(answered[0].createdAt).getTime() : -Infinity;
  const sentSince = cached.filter((x) => new Date(x.createdAt).getTime() > newest && !answered.some((a) => a.id === x.id));
  const done = answered.reduce((n, a) => n + finished(cached.find((x) => x.id === a.id), a), 0);
  return { byThread: { ...feeds.byThread, [thread]: [...sentSince, ...answered].slice(0, FEED_LIMIT) }, galleryTotal: feeds.galleryTotal + done };
}

export function withoutThread(feeds: Feeds, thread: string): Feeds {
  const byThread = { ...feeds.byThread };
  delete byThread[thread];
  return { ...feeds, byThread };
}
