import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicGeneration } from "./generations";
import { FEED_LIMIT, withAnswer, withoutThread, withRow, type Feeds } from "./thread-feeds";

const row = (id: string, minute: number, status: PublicGeneration["status"] = "completed") => ({ id, status, createdAt: new Date(Date.UTC(2026, 9, 31, 9, minute)) }) as PublicGeneration;
const ids = (feeds: Feeds, thread: string) => feeds.byThread[thread]?.map((x) => `${x.id}:${x.status}`);

test("a polled row lands in the thread that holds it, whichever thread is on the stage", () => {
  const feeds: Feeds = { byThread: { a: [row("a1", 5, "queued")], b: [row("b1", 6)] }, galleryTotal: 3 };
  const after = withRow(feeds, row("a1", 5, "completed"), "b");
  assert.deepEqual(ids(after, "a"), ["a1:completed"]);
  assert.deepEqual(ids(after, "b"), ["b1:completed"]);
  assert.equal(after.galleryTotal, 4);
});

test("a new row goes on top of the thread it was sent to, and the feed keeps the newest twelve", () => {
  const full: Feeds = { byThread: { a: Array.from({ length: FEED_LIMIT }, (_, i) => row(`a${i}`, 30 - i)) }, galleryTotal: 0 };
  const after = withRow(full, row("new", 40, "queued"), "a");
  assert.equal(after.byThread.a.length, FEED_LIMIT);
  assert.equal(after.byThread.a[0].id, "new");
  assert.ok(!after.byThread.a.some((x) => x.id === `a${FEED_LIMIT - 1}`));
  assert.equal(after.galleryTotal, 0);
});

test("a row counts in the gallery once when it finishes, by poll or by its thread's next answer", () => {
  const start: Feeds = { byThread: { a: [row("a1", 5, "in_progress")] }, galleryTotal: 2 };
  const answered = withAnswer(start, "a", [row("a1", 5, "completed")]);
  assert.equal(answered.galleryTotal, 3);
  assert.equal(withAnswer(answered, "a", [row("a1", 5, "completed")]).galleryTotal, 3);
  assert.equal(withRow(answered, row("a1", 5, "completed"), "a").galleryTotal, 3);
});

test("a thread's answer keeps only the rows this tab sent after the newest row the server named", () => {
  const cached: Feeds = { byThread: { a: [row("sent-just-now", 20, "queued"), row("old", 1)] }, galleryTotal: 0 };
  const after = withAnswer(cached, "a", [row("s2", 10), row("s1", 8)]);
  assert.deepEqual(ids(after, "a"), ["sent-just-now:queued", "s2:completed", "s1:completed"]);
});

test("an empty answer keeps what this tab sent, and dropping a thread forgets its rows", () => {
  const cached: Feeds = { byThread: { a: [row("x", 3, "queued")], b: [row("y", 4)] }, galleryTotal: 0 };
  assert.deepEqual(ids(withAnswer(cached, "a", []), "a"), ["x:queued"]);
  const dropped = withoutThread(cached, "a");
  assert.equal(dropped.byThread.a, undefined);
  assert.deepEqual(ids(dropped, "b"), ["y:completed"]);
});
