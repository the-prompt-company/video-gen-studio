import test from "node:test";
import assert from "node:assert/strict";
import { attachmentMentions, insertMention, orderedAttachments, remapMentions } from "./attachment-mentions";
import { mentionQuery } from "./result-picker";

const items = [
  { id: "a", kind: "image" as const },
  { id: "v", kind: "video" as const },
  { id: "b", kind: "image" as const },
];

test("mixed attachments have independent image and video numbering", () => {
  assert.deepEqual(attachmentMentions(items).map((a) => a.token), ["@image 1", "@video 1", "@image 2"]);
});
test("selection replacement preserves following text and returns the caret after the mention", () => {
  assert.deepEqual(insertMention("Use @im here", 4, 7, "@image 2"), { text: "Use @image 2  here", caret: 13 });
  assert.equal(insertMention("Use", 3, 3, "@video 1").text, "Use @video 1 ");
});
test("removal remaps all remaining occurrences without renumbering video references", () => {
  assert.equal(remapMentions("@image 2 follows @image 1 and @video 1; @image 2", items, items.slice(1)), "@image 1 follows  and @video 1; @image 1");
  assert.equal(remapMentions("@image 20", items, items.slice(1)), "@image 20");
});
test("numbered queries remain open while ordinary spaces close the result search", () => {
  assert.equal(mentionQuery("@image 2", 0, 8), "image 2");
  assert.equal(mentionQuery("@video ", 0, 7), "video ");
  assert.equal(mentionQuery("@other words", 0, 12), null);
});

test("frame numbering follows request order and remaps the prompt to the same image", () => {
  const ordered = orderedAttachments(items, { start: "b", end: "a" });
  assert.deepEqual(ordered.map((a) => a.id), ["b", "a", "v"]);
  assert.equal(remapMentions("@image 2 to @image 1", items, ordered), "@image 1 to @image 2");
  assert.deepEqual(orderedAttachments(items, { start: "a", end: "a" }), items);
});
