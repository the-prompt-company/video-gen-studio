import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultParams, planGeneration, type FamilyId } from "./catalog";
import { attachmentsOf, composerReducer, draftOf, fit, modeOfComposer, newComposer, uploading, type Action, type Attachment, type Composer } from "./composer";

const SEEDANCE: FamilyId = "bytedance/seedance-2.0";
const H3: FamilyId = "minimax/h3";
const GPT: FamilyId = "openai/gpt-image-2";

let n = 0;
const image = (url: string | null = `https://cdn.test/i${++n}.jpg`): Attachment => ({ id: `img-${++n}`, kind: "image", name: "a.jpg", preview: `blob:${n}`, url, w: 1280, h: 720 });
const video = (seconds = 3): Attachment => ({ id: `vid-${++n}`, kind: "video", name: "c.mp4", preview: `blob:${n}`, url: `https://cdn.test/v${n}.mp4`, seconds });
const run = (c: Composer, ...actions: Action[]) => actions.reduce(composerReducer, c);
const ids = (c: Composer) => attachmentsOf(c.attach).map((a) => a.id);

test("a reference added in text mode switches to the model's reference mode and says so", () => {
  const a = image();
  const c = run(newComposer(SEEDANCE), { type: "add", items: [a] });
  assert.equal(modeOfComposer(c), "r2v");
  assert.deepEqual(c.note, { kind: "switched", mode: "r2v" });
  assert.deepEqual(ids(c), [a.id]);
  const gpt = run(newComposer(GPT), { type: "add", items: [image()] });
  assert.deepEqual([modeOfComposer(gpt), gpt.note], ["r2i", { kind: "switched", mode: "r2i" }]);
});

test("a file the mode cannot take is refused and changes nothing, not even the mode", () => {
  const start = newComposer(GPT);
  const { composer, placed, refused } = fit(start, [video()]);
  assert.equal(composer, start);
  assert.deepEqual([placed, refused], [[], [{ reason: "noVideos" }]]);
});

test("references stop at the model's limits, image and video counted apart, in the order attached", () => {
  const six = Array.from({ length: 7 }, () => image());
  const vids = Array.from({ length: 4 }, () => video());
  const c = run(newComposer(SEEDANCE), { type: "mode", kind: "reference" });
  const { composer, placed, refused } = fit(c, [...six, ...vids]);
  assert.deepEqual(placed.map((p) => p.id), [...six.slice(0, 6), ...vids.slice(0, 3)].map((p) => p.id));
  assert.deepEqual(refused, [
    { reason: "full", kind: "image", max: 6 },
    { reason: "full", kind: "video", max: 3 },
  ]);
  assert.equal(attachmentsOf(composer.attach).length, 9);
});

test("frames take images only: the start first, then the end, and a named empty slot first", () => {
  const c = run(newComposer(SEEDANCE), { type: "mode", kind: "firstFrame" });
  const [a, b, x] = [image(), image(), image()];
  const filled = fit(c, [video(), a, b, x]);
  assert.deepEqual(filled.refused, [{ reason: "framesTakeImages" }, { reason: "framesFull" }]);
  assert.ok(filled.composer.attach.kind === "firstFrame");
  assert.deepEqual([filled.composer.attach.start?.id, filled.composer.attach.end?.id], [a.id, b.id]);

  const endFirst = fit(c, [a], "end").composer.attach;
  assert.ok(endFirst.kind === "firstFrame");
  assert.deepEqual([endFirst.start, endFirst.end?.id], [null, a.id]);
});

test("choosing text takes the references away, and 되돌리기 puts back the mode and every reference", () => {
  const refs = [image(), video(), image()];
  const before = run(newComposer(SEEDANCE), { type: "add", items: refs });
  const text = run(before, { type: "mode", kind: "text" });
  assert.equal(modeOfComposer(text), "t2v");
  assert.deepEqual(attachmentsOf(text.attach), []);
  assert.deepEqual(text.note, { kind: "removed", count: 3, restore: before.attach });
  const back = run(text, { type: "undo" });
  assert.deepEqual([modeOfComposer(back), ids(back), back.note], ["r2v", refs.map((r) => r.id), null]);
});

test("references to frames keep the first two images as start and end; what is left over can come back", () => {
  const [a, v, b, c] = [image(), video(), image(), image()];
  const refs = run(newComposer(H3), { type: "add", items: [a, v, b, c] });
  const frames = run(refs, { type: "mode", kind: "firstFrame" });
  assert.ok(frames.attach.kind === "firstFrame");
  assert.deepEqual([frames.attach.start?.id, frames.attach.end?.id], [a.id, b.id]);
  assert.deepEqual(frames.note && frames.note.kind === "removed" && frames.note.count, 2);
  assert.deepEqual(ids(run(frames, { type: "undo" })), [a.id, v.id, b.id, c.id]);

  const back = run(frames, { type: "mode", kind: "reference" });
  assert.deepEqual([ids(back), back.note], [[a.id, b.id], null], "frames become references in order and nothing is lost");
});

test("an upload that answers after a switch still lands, in the composer and in what 되돌리기 restores", () => {
  const pending = image(null);
  const added = run(newComposer(SEEDANCE), { type: "add", items: [pending] });
  assert.equal(uploading(added), true);
  const text = run(added, { type: "mode", kind: "text" }, { type: "uploaded", id: pending.id, url: "https://cdn.test/done.jpg" });
  const back = run(text, { type: "undo" });
  assert.equal(uploading(back), false);
  assert.equal(attachmentsOf(back.attach)[0].url, "https://cdn.test/done.jpg");

  const failed = run(added, { type: "mode", kind: "text" }, { type: "failed", id: pending.id }, { type: "undo" });
  assert.deepEqual(ids(failed), [], "a failed upload leaves nothing to restore");
});

test("taking a reference off ends the chance to undo the last switch", () => {
  const [a, b, c] = [image(), image(), image()];
  const frames = run(newComposer(SEEDANCE), { type: "add", items: [a, b, c] }, { type: "mode", kind: "firstFrame" });
  const removed = run(frames, { type: "remove", id: b.id });
  assert.equal(removed.note, null);
  assert.deepEqual(ids(run(removed, { type: "undo" })), [a.id]);
});

test("a model change resets the parameters, keeps the attachments, and turns frames into references for an image model", () => {
  const [a, b] = [image(), image()];
  const frames = run(newComposer(SEEDANCE), { type: "mode", kind: "firstFrame" }, { type: "add", items: [a, b] }, { type: "param", key: "duration", value: 9 });
  const h3 = run(frames, { type: "family", family: H3 });
  assert.deepEqual([h3.params, modeOfComposer(h3), ids(h3)], [defaultParams(H3), "i2v", [a.id, b.id]]);
  const gpt = run(frames, { type: "family", family: GPT });
  assert.deepEqual([modeOfComposer(gpt), ids(gpt)], ["r2i", [a.id, b.id]]);
});

test("the composer's draft is what the plan reads: start frame, end frame, references and their lengths", () => {
  const [start, end] = [image(), image()];
  const frames = run(newComposer(SEEDANCE), { type: "mode", kind: "firstFrame" }, { type: "add", items: [start, end] });
  const plan = planGeneration(draftOf(frames, "우산을 펼치는 순간"), 0.0985);
  assert.ok(plan.ready, plan.ready ? "" : JSON.stringify(plan.blocker));
  assert.deepEqual([plan.endpoint, JSON.parse(plan.body).image_url, JSON.parse(plan.body).end_image_url], ["bytedance/seedance-2.0/image-to-video", start.url, end.url]);

  const empty = run(newComposer(SEEDANCE), { type: "mode", kind: "firstFrame" });
  const blocked = planGeneration(draftOf(empty, "x"), 0);
  assert.deepEqual(!blocked.ready && blocked.blocker, { code: "startFrameRequired" });

  const clip = video(4.5);
  const refs = run(newComposer(SEEDANCE), { type: "add", items: [image(), clip] });
  assert.deepEqual(draftOf(refs, "").videos, [{ url: clip.url, seconds: 4.5 }]);
});

test("다시 sets the row's model, mode and settings with empty attachments, and a mode the model lacks becomes references", () => {
  const reused = run(newComposer(GPT), { type: "reuse", family: SEEDANCE, kind: "firstFrame", params: { duration: 8 } });
  assert.deepEqual([modeOfComposer(reused), reused.params.duration, attachmentsOf(reused.attach), reused.note], ["i2v", 8, [], { kind: "reused", needsAttachments: true }]);
  const text = run(newComposer(SEEDANCE), { type: "reuse", family: H3, kind: "text", params: {} });
  assert.deepEqual(text.note, { kind: "reused", needsAttachments: false });
  assert.equal(modeOfComposer(run(newComposer(SEEDANCE), { type: "reuse", family: GPT, kind: "firstFrame", params: {} })), "r2i");
});
