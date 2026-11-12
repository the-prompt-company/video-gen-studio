import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultParams, type FamilyId } from "./catalog";
import type { AppError } from "./errors";
import { composerReducer, fit, modeOf, newComposer, pastedFiles, planOf, reuseOf, rolesOf, takes, unsent, uploading, type Action, type Attachment, type Composer, type Turn } from "./composer";

const SEEDANCE: FamilyId = "bytedance/seedance-2.0";
const H3: FamilyId = "minimax/h3";
const GPT: FamilyId = "openai/gpt-image-2.6-flare";

let n = 0;
const image = (url: string | null = `https://cdn.test/i${++n}.jpg`, refUpload = false): Attachment => ({ id: `img-${++n}`, kind: "image", name: "a.jpg", preview: `blob:${n}`, url, refUpload, w: 1280, h: 720 });
const video = (seconds = 3, refUpload = false): Attachment => ({ id: `vid-${++n}`, kind: "video", name: "c.mp4", preview: `blob:${n}`, url: `https://cdn.test/v${n}.mp4`, refUpload, seconds });
const run = (c: Composer, ...actions: Action[]) => actions.reduce(composerReducer, c);
const ids = (c: Composer) => c.items.map((a) => a.id);
const mark = (role: "start" | "end", a: Attachment | null): Action => ({ type: "frame", role, id: a?.id ?? null });
/** A Generate that carried everything attached now. */
const send = (c: Composer) => composerReducer(c, { type: "sent", ids: ids(c) });

/** What Generate would post: the endpoint and the provider body, or the reason it is off. */
function sends(c: Composer, prompt = "비 오는 밤 다리"): { endpoint: string; body: Record<string, unknown> } | { blocker: AppError } {
  const { plan } = planOf(c, prompt, 0.0985);
  return plan.ready ? { endpoint: plan.endpoint, body: JSON.parse(plan.body) as Record<string, unknown> } : { blocker: plan.blocker };
}

test("with nothing attached the prompt goes alone to the text endpoint", () => {
  assert.deepEqual(sends(newComposer(SEEDANCE)), { endpoint: "bytedance/seedance-2.0/text-to-video", body: { ...defaultParams(SEEDANCE), prompt: "비 오는 밤 다리" } });
  const gpt = sends(newComposer(GPT));
  assert.ok("endpoint" in gpt && gpt.endpoint === "openai/gpt-image-2.6-flare/generations" && !("images" in gpt.body), JSON.stringify(gpt));
});

test("attached files land as references with no frame mark, and go out as image_urls and video_urls", () => {
  const [a, b, clip] = [image(), image(), video(4.5)];
  const c = run(newComposer(SEEDANCE), { type: "add", items: [a, clip, b] });
  assert.equal(modeOf(c), "r2v");
  assert.deepEqual([rolesOf(c, a.id), rolesOf(c, b.id)], [[], []]);
  const sent = sends(c);
  assert.ok("body" in sent, JSON.stringify(sent));
  assert.deepEqual([sent.endpoint, sent.body.image_urls, sent.body.video_urls], ["bytedance/seedance-2.0/reference-to-video", [a.url, b.url], [clip.url]]);

  const gpt = sends(run(newComposer(GPT), { type: "add", items: [a, b] }), "우산을 든 사람");
  assert.ok("body" in gpt, JSON.stringify(gpt));
  assert.deepEqual([gpt.endpoint, gpt.body.images], ["openai/gpt-image-2.6-flare/edits", [{ image_url: a.url }, { image_url: b.url }]]);
});

test("marking an image 시작 and another 끝 sends image to video with exactly those two", () => {
  const [a, b] = [image(), image()];
  const c = run(newComposer(SEEDANCE), { type: "add", items: [a, b] }, mark("end", b), mark("start", a));
  assert.equal(modeOf(c), "i2v");
  const sent = sends(c);
  assert.ok("body" in sent, JSON.stringify(sent));
  assert.equal(sent.endpoint, "bytedance/seedance-2.0/image-to-video");
  assert.deepEqual([sent.body.image_url, sent.body.end_image_url, "image_urls" in sent.body], [a.url, b.url, false]);
});

test("marking a second image 시작 moves the label, so there is only ever one 시작 and one 끝", () => {
  const [a, b, c] = [image(), image(), image()];
  const marked = run(newComposer(H3), { type: "add", items: [a, b, c] }, mark("start", a), mark("end", b), mark("start", c));
  assert.deepEqual([rolesOf(marked, a.id), rolesOf(marked, b.id), rolesOf(marked, c.id)], [[], ["end"], ["start"]]);
  assert.deepEqual(marked.frames, { start: c.id, end: b.id });
  const cleared = run(marked, mark("start", null), mark("end", null));
  assert.deepEqual([cleared.frames, modeOf(cleared)], [{ start: null, end: null }, "r2v"]);
});

test("one image may hold both frames, which loops the video", () => {
  const a = image();
  const sent = sends(run(newComposer(SEEDANCE), { type: "add", items: [a] }, mark("start", a), mark("end", a)));
  assert.ok("body" in sent, JSON.stringify(sent));
  assert.deepEqual([sent.body.image_url, sent.body.end_image_url], [a.url, a.url]);
});

test("a video never takes a frame, and an unknown id changes nothing", () => {
  const clip = video();
  const c = run(newComposer(SEEDANCE), { type: "add", items: [clip] });
  assert.equal(run(c, mark("start", clip)), c);
  assert.equal(run(c, { type: "frame", role: "start", id: "nope" }), c);
});

test("끝 without 시작 keeps Generate off with the start-frame reason", () => {
  const a = image();
  assert.deepEqual(sends(run(newComposer(SEEDANCE), { type: "add", items: [a] }, mark("end", a))), { blocker: { code: "startFrameRequired" } });
});

test("frames beside other attachments are refused, never sent without them, until the others go or the marks come off", () => {
  const [a, b, x, clip] = [image(), image(), image(), video()];
  const both = run(newComposer(SEEDANCE), { type: "add", items: [a, x, b, clip] }, mark("start", a), mark("end", b));
  assert.deepEqual(unsent(both).map((i) => i.id), [x.id, clip.id]);
  assert.deepEqual(sends(both), { blocker: { code: "framesWithOthers", params: { count: 2 } } });

  const endOnly = run(newComposer(SEEDANCE), { type: "add", items: [a, x] }, mark("end", a));
  assert.deepEqual(sends(endOnly), { blocker: { code: "framesWithOthers", params: { count: 1 } } }, "the conflict is named before the missing start");

  const trimmed = run(both, { type: "remove", id: x.id }, { type: "remove", id: clip.id });
  assert.ok("body" in sends(trimmed));
  const unmarked = run(both, mark("start", null), mark("end", null));
  const asRefs = sends(unmarked);
  assert.ok("body" in asRefs && asRefs.endpoint.endsWith("/reference-to-video"), JSON.stringify(asRefs));
});

test("a model without frames takes the marks off and says so; a model with frames keeps them", () => {
  const [a, b] = [image(), image()];
  const frames = run(newComposer(SEEDANCE), { type: "add", items: [a, b] }, mark("start", a), mark("end", b), { type: "param", key: "duration", value: 9 });
  const h3 = run(frames, { type: "family", family: H3 });
  assert.deepEqual([h3.params, modeOf(h3), h3.frames, h3.note], [defaultParams(H3), "i2v", frames.frames, null]);
  const gpt = run(frames, { type: "family", family: GPT });
  assert.deepEqual([modeOf(gpt), ids(gpt), gpt.frames, gpt.note], ["r2i", [a.id, b.id], { start: null, end: null }, { kind: "unmarked", family: GPT }]);
  assert.equal(run(gpt, mark("start", a)), gpt, "GPT Image 2.6 Flare offers no frame to mark");
  const plain = run(run(newComposer(SEEDANCE), { type: "add", items: [a] }), { type: "family", family: GPT });
  assert.equal(plain.note, null, "nothing was marked, so there is nothing to say");
});

test("taking a marked image off takes its mark with it", () => {
  const [a, b] = [image(), image()];
  const c = run(newComposer(SEEDANCE), { type: "add", items: [a, b] }, mark("start", a), { type: "remove", id: a.id });
  assert.deepEqual([ids(c), c.frames, modeOf(c)], [[b.id], { start: null, end: null }, "r2v"]);
  const failed = run(newComposer(SEEDANCE), { type: "add", items: [a] }, mark("start", a), { type: "failed", id: a.id });
  assert.deepEqual([ids(failed), failed.frames, modeOf(failed)], [[], { start: null, end: null }, "t2v"]);
});

const OFFERED: FamilyId[] = [SEEDANCE, H3, GPT];
const turn = (modelId: string, imageRefs: string[] = [], videoRefs: string[] = [], params: Record<string, unknown> = {}): Turn => ({ modelId, params, imageRefs, videoRefs });
const kept = () => false;
/** 다시, then each frame it put back answering with a size, as the browser's image load does. */
const reuse = (c: Composer, t: Turn, temporary: (url: string) => boolean = kept) => {
  const action = reuseOf(t, OFFERED, c.family, temporary);
  const after = composerReducer(c, action);
  return { action, pending: after, loaded: run(after, ...after.items.map((a): Action => ({ type: "loaded", id: a.id, size: { w: 1280, h: 720 } }))) };
};
const at = (c: Composer, url: string) => c.items.find((a) => a.preview === url);

test("다시 on an image-to-video turn marks its first image 시작 and its second 끝, and Generate waits until both load", () => {
  const [s1, e1] = ["https://hf.test/s.jpg", "https://hf.test/e.jpg"];
  const { pending, loaded } = reuse(newComposer(GPT), turn("bytedance/seedance-2.0/image-to-video", [s1, e1], [], { duration: 8 }));
  assert.deepEqual([pending.family, pending.params.duration, pending.note], [SEEDANCE, 8, { kind: "reused", refs: "frames" }]);
  assert.deepEqual([pending.frames.start, pending.frames.end], [at(pending, s1)?.id, at(pending, e1)?.id]);
  assert.equal(uploading(pending), true, "a frame not yet known to load keeps Generate waiting");
  assert.equal(modeOf(loaded), "i2v");
  const sent = sends(loaded);
  assert.ok("body" in sent, JSON.stringify(sent));
  assert.deepEqual([sent.body.image_url, sent.body.end_image_url], [s1, e1]);

  const loop = reuse(newComposer(SEEDANCE), turn("minimax/h3/image-to-video", [s1, s1])).loaded;
  assert.deepEqual([loop.items.length, loop.frames.start, loop.frames.end], [1, at(loop, s1)?.id, at(loop, s1)?.id]);
});

test("a frame 다시 cannot load any more comes off and the note says to attach again", () => {
  const [s1, e1] = ["https://hf.test/s.jpg", "https://hf.test/gone.jpg"];
  const { pending } = reuse(newComposer(SEEDANCE), turn("bytedance/seedance-2.0/image-to-video", [s1, e1]));
  const gone = run(pending, { type: "loaded", id: at(pending, e1)!.id, size: null }, { type: "loaded", id: at(pending, s1)!.id, size: { w: 1, h: 1 } });
  assert.deepEqual([gone.items.map((a) => a.preview), gone.frames.end, gone.note], [[s1], null, { kind: "reused", refs: "missing" }]);
  assert.ok("body" in sends(gone), "the start frame alone still makes image to video");
  const late = run(newComposer(SEEDANCE), { type: "loaded", id: "an earlier 다시", size: null });
  assert.deepEqual(late, newComposer(SEEDANCE), "an answer for a frame no longer attached changes nothing");
});

test("a frame uploaded under refs/ does not come back, because its row deletes it when it ends", () => {
  const blob = "https://store.test/refs/7/1-big.jpg";
  const { action, loaded } = reuse(newComposer(SEEDANCE), turn("bytedance/seedance-2.0/image-to-video", [blob, "https://hf.test/e.jpg"]), (u) => u.includes("/refs/7/"));
  assert.deepEqual([action.start, action.end?.preview, action.missing], [null, "https://hf.test/e.jpg", true]);
  assert.deepEqual([loaded.note, sends(loaded)], [{ kind: "reused", refs: "missing" }, { blocker: { code: "startFrameRequired" } }]);
});

test("다시 on a text or reference turn brings back the settings only, and says when attachments did not come back", () => {
  const text = reuse(newComposer(SEEDANCE), turn("minimax/h3/text-to-video")).loaded;
  assert.deepEqual([text.family, modeOf(text), text.note], [H3, "t2v", { kind: "reused", refs: "none" }]);
  const refs = reuse(newComposer(SEEDANCE), turn("bytedance/seedance-2.0/reference-to-video", ["https://hf.test/a.jpg"], ["https://hf.test/v.mp4"])).loaded;
  assert.deepEqual([refs.items, refs.note], [[], { kind: "reused", refs: "missing" }]);
  const edit = reuse(newComposer(SEEDANCE), turn("openai/gpt-image-2.6-flare/edits", ["https://blob.test/refs/1/a.png"])).loaded;
  assert.deepEqual([edit.family, edit.items, edit.note], [GPT, [], { kind: "reused", refs: "missing" }]);
});

test("다시 on a turn whose model is not offered keeps the current model and its defaults, and frames only where it takes them", () => {
  const hidden = reuseOf(turn("bytedance/seedance-2.0/image-to-video", ["https://hf.test/s.jpg"], [], { duration: 9 }), [GPT], GPT, kept);
  assert.deepEqual([hidden.family, hidden.params, hidden.start, hidden.missing], [GPT, {}, null, true]);
  const onH3 = reuseOf(turn("minimax/hailuo-2.3/standard/image-to-video", ["https://hf.test/s.jpg"], [], { duration: 6 }), OFFERED, H3, kept);
  assert.deepEqual([onH3.family, onH3.params, onH3.start?.preview, onH3.missing], [H3, {}, "https://hf.test/s.jpg", false], "a retired model's image-to-video turn keeps its start frame on the current model");
});

test("다시 keeps only the settings the model takes, so a stored 20 s falls back to the default", () => {
  const reused = reuse(newComposer(SEEDANCE), turn("bytedance/seedance-2.0/text-to-video", [], [], { duration: 20, resolution: "720p", seed: 7 })).loaded;
  assert.deepEqual(reused.params, { ...defaultParams(SEEDANCE), resolution: "720p" });
});

test("a paste attaches its files unless it carries other text, as Word, Excel and PowerPoint do", () => {
  const shot = { name: "image.png" };
  assert.deepEqual(pastedFiles([shot], ""), [shot], "a screenshot");
  assert.deepEqual(pastedFiles([shot], "넓은 들판, 해 질 녘"), [], "a picture of copied text pastes as the text");
  const copied = [{ name: "a.jpg" }, { name: "b.mp4" }];
  assert.deepEqual(pastedFiles(copied, "a.jpg\nb.mp4"), copied, "files copied in a file manager carry their names");
  assert.deepEqual(pastedFiles([], "글자만"), []);
});

const result = (kind: "image" | "video", url: string): Attachment =>
  kind === "image" ? { id: `res-${++n}`, kind, name: "결과", preview: url, url, refUpload: false, w: 1536, h: 1024 } : { id: `res-${++n}`, kind, name: "결과", preview: url, url, refUpload: false, seconds: 5 };

test("a reused result always lands as a reference, even beside marked frames, and the same one twice is refused", () => {
  const still = result("image", "https://blob.test/images/a.png");
  const clip = result("video", "https://blob.test/videos/b.mp4");
  const a = image();
  const framed = run(newComposer(H3), { type: "add", items: [a] }, mark("start", a));
  const placed = fit(framed, [still, clip]);
  assert.deepEqual([placed.refused, ids(placed.composer), placed.composer.frames], [[], [a.id, still.id, clip.id], { start: a.id, end: null }]);
  assert.deepEqual(planOf(placed.composer, "x", 0).draft.videos, [], "image to video sends the frame alone");
  assert.deepEqual(unsent(placed.composer).map((i) => i.id), [still.id, clip.id]);

  const refs = fit(newComposer(SEEDANCE), [still, clip]).composer;
  assert.deepEqual(planOf(refs, "", 0).draft.videos, [{ url: clip.url, seconds: 5 }], "the video counts its stored length");
  assert.deepEqual(fit(refs, [result("image", still.url as string)]).refused, [{ reason: "attached" }]);
  assert.deepEqual(fit(newComposer(GPT), [clip]).refused, [{ reason: "noVideos" }]);
});

test("references stop at the model's limits, image and video counted apart, in the order attached", () => {
  const seven = Array.from({ length: 7 }, () => image());
  const vids = Array.from({ length: 4 }, () => video());
  const { composer, placed, refused } = fit(newComposer(SEEDANCE), [...seven, ...vids]);
  assert.deepEqual(placed.map((p) => p.id), [...seven.slice(0, 6), ...vids.slice(0, 3)].map((p) => p.id));
  assert.deepEqual(refused, [
    { reason: "full", kind: "image", max: 6 },
    { reason: "full", kind: "video", max: 3 },
  ]);
  assert.equal(composer.items.length, 9);
});

test("an upload lands by id, and the composer waits for it", () => {
  const pending = image(null);
  const added = run(newComposer(SEEDANCE), { type: "add", items: [pending] }, mark("start", pending));
  assert.equal(uploading(added), true);
  const landed = run(added, { type: "uploaded", id: pending.id, url: "https://cdn.test/done.jpg" });
  assert.deepEqual([uploading(landed), landed.items[0].url, landed.frames.start], [false, "https://cdn.test/done.jpg", pending.id]);
});

test("after a Higgsfield send the Blob references leave, marks included, and say so; other attachments stay", () => {
  const [small, large, clip] = [image(), image("https://blob.test/refs/1/large.jpg", true), video(4, true)];
  const sent = send(run(newComposer(SEEDANCE), { type: "add", items: [small, large, clip] }));
  assert.deepEqual([ids(sent), sent.note], [[small.id], { kind: "spent", count: 2 }]);
  const framed = send(run(newComposer(SEEDANCE), { type: "add", items: [large] }, mark("start", large)));
  assert.deepEqual([framed.frames, modeOf(framed)], [{ start: null, end: null }, "t2v"]);
  const gpt = send(run(newComposer(GPT), { type: "add", items: [image("https://blob.test/refs/1/a.png", true)] }));
  assert.deepEqual([gpt.items.length, gpt.note], [1, null], "an OpenAI row keeps its Blob references for the next attempt");
  const items = [result("image", "https://blob.test/images/a.png"), result("video", "https://blob.test/videos/b.mp4")];
  const kept = send(run(newComposer(SEEDANCE), { type: "add", items }));
  assert.deepEqual([ids(kept), kept.note], [items.map((x) => x.id), null], "a reused result is not an upload, so it stays");
});

test("a Blob file dropped while a send is in flight was not sent, so it stays", () => {
  const sentOne = image("https://blob.test/refs/1/one.jpg", true);
  const before = run(newComposer(SEEDANCE), { type: "add", items: [sentOne] });
  const dropped = image(null, true);
  const after = run(before, { type: "add", items: [dropped] }, { type: "sent", ids: ids(before) });
  assert.deepEqual([ids(after), after.note], [[dropped.id], { kind: "spent", count: 1 }]);
});

test("the picker offers videos unless the model takes none, frames or not", () => {
  const a = image();
  assert.deepEqual(takes(newComposer(SEEDANCE)), ["image", "video"]);
  assert.deepEqual(takes(run(newComposer(SEEDANCE), { type: "add", items: [a] }, mark("start", a))), ["image", "video"]);
  assert.deepEqual(takes(newComposer(GPT)), ["image"]);
});
