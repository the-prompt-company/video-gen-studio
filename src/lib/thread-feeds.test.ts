import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicGeneration } from "./generations";
import { withAnswer, withOlder, withoutThread, withRow, type Feeds } from "./thread-feeds";

const row = (id: string, minute: number, status: PublicGeneration["status"] = "completed") => ({ id, status, createdAt: new Date(Date.UTC(2026, 9, 31, 9, minute)) }) as PublicGeneration;
const feed = (rows: PublicGeneration[], more = false) => ({ rows, more });
const ids = (feeds: Feeds, thread: string) => feeds.byThread[thread]?.rows.map((x) => `${x.id}:${x.status}`);

test("a polled row lands in the thread that holds it, whichever thread is on the stage", () => {
  const feeds: Feeds = { byThread: { a: feed([row("a1", 5, "queued")]), b: feed([row("b1", 6)]) }, galleryTotal: 3 };
  const after = withRow(feeds, row("a1", 5, "completed"), "b");
  assert.deepEqual(ids(after, "a"), ["a1:completed"]);
  assert.deepEqual(ids(after, "b"), ["b1:completed"]);
  assert.equal(after.galleryTotal, 4);
});

test("a new row goes on top of the thread it was sent to and keeps every row the stream has loaded", () => {
  const loaded: Feeds = { byThread: { a: feed(Array.from({ length: 30 }, (_, i) => row(`a${i}`, 50 - i)), true) }, galleryTotal: 0 };
  const after = withRow(loaded, row("new", 59, "queued"), "a");
  assert.equal(after.byThread.a.rows.length, 31);
  assert.equal(after.byThread.a.rows[0].id, "new");
  assert.equal(after.byThread.a.more, true);
  assert.equal(after.galleryTotal, 0);
});

test("a row counts in the gallery once when it finishes, by poll or by its thread's next answer", () => {
  const start: Feeds = { byThread: { a: feed([row("a1", 5, "in_progress")]) }, galleryTotal: 2 };
  const answered = withAnswer(start, "a", [row("a1", 5, "completed")], false);
  assert.equal(answered.galleryTotal, 3);
  assert.equal(withAnswer(answered, "a", [row("a1", 5, "completed")], false).galleryTotal, 3);
  assert.equal(withRow(answered, row("a1", 5, "completed"), "a").galleryTotal, 3);
});

test("a thread's answer keeps only the rows this tab sent after the newest row the server named, and its more", () => {
  const cached: Feeds = { byThread: { a: feed([row("sent-just-now", 20, "queued"), row("old", 1)]) }, galleryTotal: 0 };
  const after = withAnswer(cached, "a", [row("s2", 10), row("s1", 8)], true);
  assert.deepEqual(ids(after, "a"), ["sent-just-now:queued", "s2:completed", "s1:completed"]);
  assert.equal(after.byThread.a.more, true);
});

test("an older page goes below the rows shown, once each, and says whether more remain", () => {
  const shown: Feeds = { byThread: { a: feed([row("n2", 30), row("n1", 20)], true) }, galleryTotal: 5 };
  const after = withOlder(shown, "a", "n1", [row("n1", 20), row("o2", 10), row("o1", 5)], false);
  assert.deepEqual(ids(after, "a"), ["n2:completed", "n1:completed", "o2:completed", "o1:completed"]);
  assert.equal(after.byThread.a.more, false);
  assert.equal(after.galleryTotal, 5, "rows that were finished before this tab saw them are not new in the gallery");
  assert.equal(withOlder(shown, "a", "o9", [row("o8", 1)], false), shown, "a page for a cursor the thread no longer ends at is dropped");
});

test("an empty answer keeps what this tab sent, and dropping a thread forgets its rows", () => {
  const cached: Feeds = { byThread: { a: feed([row("x", 3, "queued")]), b: feed([row("y", 4)]) }, galleryTotal: 0 };
  assert.deepEqual(ids(withAnswer(cached, "a", [], false), "a"), ["x:queued"]);
  const dropped = withoutThread(cached, "a");
  assert.equal(dropped.byThread.a, undefined);
  assert.deepEqual(ids(dropped, "b"), ["y:completed"]);
});
