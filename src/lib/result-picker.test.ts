import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicGeneration } from "./generations";
import { mentionQuery, pickable, typedMention, withoutMention } from "./result-picker";

const row = (id: string, prompt: string, ref: PublicGeneration["ref"]) => ({ id, prompt, ref }) as PublicGeneration;
const image = (id: string, prompt = `prompt ${id}`) => row(id, prompt, { kind: "image", url: `https://blob.test/images/${id}.png` });
const video = (id: string, prompt = `prompt ${id}`) => row(id, prompt, { kind: "video", url: `https://blob.test/videos/${id}.mp4`, seconds: 5 });
const ids = (rows: PublicGeneration[]) => rows.map((g) => g.id);

test("an @ right before the caret opens the picker only where a word starts, so an email address in the prompt does not", () => {
  assert.equal(typedMention("@", 1), 0);
  assert.equal(typedMention("비 오는 밤 @", 8), 7);
  assert.equal(typedMention("line\n@", 6), 5);
  assert.equal(typedMention("me@", 3), null);
  assert.equal(typedMention("a @b", 3), 2, "typed in the middle of the prompt");
  assert.equal(typedMention("@x", 1), 0, "deleting back to the @ opens it again");
  assert.equal(typedMention("@x", 2), null, "the caret is past the @");
});

test("the query is the word after the @ up to the caret, and the picker closes once the caret leaves it", () => {
  assert.equal(mentionQuery("다리 @한강", 3, 6), "한강");
  assert.equal(mentionQuery("다리 @", 3, 4), "");
  assert.equal(mentionQuery("다리 @한강 밤", 3, 9), null, "a space ends the word");
  assert.equal(mentionQuery("다리 @한강", 3, 2), null, "the caret moved before the @");
  assert.equal(mentionQuery("다리 한강", 3, 5), null, "the @ was deleted");
});

test("a pick takes the @ word out of the prompt and leaves the caret where it was", () => {
  assert.deepEqual(withoutMention("다리 @한강 위로", 3, 6), { text: "다리  위로", caret: 3 });
  assert.deepEqual(withoutMention("@", 0, 1), { text: "", caret: 0 });
});

test("this thread's results come first, then other recent ones once each, newest first as given", () => {
  const thread = [image("t2"), row("live", "still running", null), video("t1")];
  const recent = [image("r3"), image("t2"), video("r1")];
  const both = pickable(thread, recent, ["image", "video"], "");
  assert.deepEqual([ids(both.thread), ids(both.recent)], [["t2", "t1"], ["r3", "r1"]]);
});

test("the picker shows only the kinds the composer takes, and filters by the prompt", () => {
  const thread = [image("a", "Rainy Bridge at night"), video("b", "rainy bridge, wider")];
  assert.deepEqual(ids(pickable(thread, [], ["image"], "").thread), ["a"]);
  assert.deepEqual(ids(pickable(thread, [], ["image", "video"], "wider").thread), ["b"]);
  assert.deepEqual(ids(pickable(thread, [], ["image", "video"], "RAINY").thread), ["a", "b"], "case does not matter");
  assert.deepEqual(pickable(thread, [], ["image", "video"], "snow"), { thread: [], recent: [] });
});

test("a row from a server that does not send ref yet is left out instead of breaking the list", () => {
  const old = { id: "old", prompt: "before the deploy" } as PublicGeneration;
  assert.deepEqual(pickable([old], [old], ["image", "video"], ""), { thread: [], recent: [] });
});
