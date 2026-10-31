import { test } from "node:test";
import assert from "node:assert/strict";
import type { Generation } from "@/db/schema";
import { HttpError } from "./auth";
import type { Draft } from "./catalog";
import { checkRefs, refProblem, resultRef, type Reference } from "./references";
import { storedObjectOf, type ObjectKey } from "./storage";

process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store_secret";
process.env.BLOB_PUBLIC_BASE_URL = "https://blob.test";

const ME = 7;
const TEAMMATE = 8;
const NOW = Date.parse("2026-10-31T09:00:00Z");
const HOUR = 3600_000;
const VIDEO_ID = "6f1e2a5c-1d1b-4c55-9a59-6c3f1f1c2b10";
const IMAGE_ID = "0b6a3f8e-3c2d-4e1f-8a9b-7c6d5e4f3a2b";
const HF = "https://cdn.higgsfield.test/out/clip.mp4";
const STORED_VIDEO = `https://blob.test/videos/${VIDEO_ID}.mp4`;
const STORED_IMAGE = `https://blob.test/images/${IMAGE_ID}.png`;

const row = (over: Partial<Generation>): Generation =>
  ({
    id: VIDEO_ID,
    userId: ME,
    modelId: "bytedance/seedance-2.0/text-to-video",
    status: "completed",
    durationS: 5,
    resultUrl: HF,
    expiresAt: new Date(NOW + 6 * 24 * HOUR),
    completedAt: new Date(NOW - 24 * HOUR),
    storagePath: `videos/${VIDEO_ID}.mp4` as ObjectKey,
    ...over,
  }) as Generation;
const video = row({});
const image = row({ id: IMAGE_ID, modelId: "openai/gpt-image-2/generations", durationS: 0, resultUrl: null, expiresAt: null, storagePath: `images/${IMAGE_ID}.png` as ObjectKey });
const providerOnly = row({ storagePath: null });

const asVideo = (url: string, seconds = 5): Reference => ({ kind: "video", url, seconds });
const asImage = (url: string): Reference => ({ kind: "image", url });
/** What the route decides for one reference, given the row its URL names. */
const verdict = (ref: Reference, named?: Generation) => refProblem(ME, ref, storedObjectOf(ref.url), named, NOW);

const draft = (over: Partial<Draft>): Draft => ({ family: "bytedance/seedance-2.0", mode: "r2v", prompt: "", params: {}, images: [], videos: [], endImage: null, ...over });
/** checkRefs against these rows, as the database would return them for the ids and paths asked. */
const check = (d: Draft, rows: Generation[]) =>
  checkRefs(ME, d, async (ids, paths) => rows.filter((r) => ids.includes(r.id) || paths.some((p) => r.resultUrl?.includes(p))), NOW).then(
    () => null,
    (e: unknown) => (e instanceof HttpError ? [e.status, e.error] : Promise.reject(e)),
  );

test("a finished result offers its stored copy, with a video's length; Higgsfield's copy only while it has an hour left", () => {
  assert.deepEqual(resultRef(video, NOW), { kind: "video", url: STORED_VIDEO, seconds: 5 });
  assert.deepEqual(resultRef(image, NOW), { kind: "image", url: STORED_IMAGE });
  assert.deepEqual(resultRef(providerOnly, NOW), { kind: "video", url: HF, seconds: 5 });
  assert.equal(resultRef(row({ storagePath: null, expiresAt: new Date(NOW + 50 * 60_000) }), NOW), null, "Higgsfield deletes it within the hour");
  assert.equal(resultRef(row({ storagePath: null, expiresAt: new Date(NOW - HOUR) }), NOW), null, "expired");
  assert.equal(resultRef(row({ storagePath: null, expiresAt: null, completedAt: new Date(NOW - 7 * 24 * HOUR) }), NOW), null, "no expiry recorded: 7 days after it finished");
});

test("nothing is offered for a result that is not finished, has no media, or is a mock clip at a relative URL", () => {
  for (const status of ["pending", "queued", "in_progress", "failed", "nsfw", "canceled"] as const) assert.equal(resultRef(row({ status }), NOW), null, status);
  assert.equal(resultRef(row({ storagePath: null, resultUrl: null }), NOW), null);
  assert.equal(resultRef(row({ storagePath: null, resultUrl: "/mock/result-landscape.webm" }), NOW), null);
});

test("the member's own results are accepted at every URL the row still offers, however the URL is spelled", () => {
  assert.equal(verdict(asVideo(STORED_VIDEO), video), null);
  assert.equal(verdict(asImage(STORED_IMAGE), image), null);
  assert.equal(verdict(asVideo(HF), video), null, "a turn attached before the stored copy landed still sends Higgsfield's URL");
  assert.equal(verdict(asVideo(STORED_VIDEO.replace("https:", "http:")), video), null);
});

test("a result whose media is gone is refused as resultGone", () => {
  const gone = { code: "resultGone" };
  assert.deepEqual(verdict(asVideo(HF), row({ storagePath: null, expiresAt: new Date(NOW - HOUR) })), gone, "Higgsfield deleted it");
  assert.deepEqual(verdict(asVideo(HF), row({ expiresAt: new Date(NOW + 10 * 60_000) })), gone, "too close to Higgsfield's deletion, even with a stored copy");
  assert.deepEqual(verdict(asVideo(STORED_VIDEO), row({ storagePath: null })), gone, "a stored key the row never wrote");
  assert.deepEqual(verdict(asVideo(STORED_VIDEO)), gone, "a stored key no row has");
  assert.deepEqual(verdict(asImage(`https://blob.test/images/${IMAGE_ID}.webp`), image), gone, "another format than the row stored");
});

test("a reused result sent as another kind or another length is refused as refMismatch, so the estimate counts the stored length", () => {
  const mismatch = { code: "refMismatch" };
  assert.deepEqual(verdict(asImage(STORED_VIDEO), video), mismatch, "a video sent as an image");
  assert.deepEqual(verdict(asVideo(STORED_VIDEO, 1), video), mismatch, "a 5 s video priced as 1 s");
  assert.deepEqual(verdict(asVideo(STORED_IMAGE, 5), image), mismatch, "an image sent as a video");
});

test("another member's upload or result is refused as refNotYours, wherever it is kept", () => {
  const notYours = (kind: "image" | "video") => ({ code: "refNotYours", params: { kind } });
  assert.deepEqual(verdict(asVideo(STORED_VIDEO), row({ userId: TEAMMATE })), notYours("video"));
  assert.deepEqual(verdict(asVideo(HF), row({ userId: TEAMMATE })), notYours("video"));
  assert.deepEqual(verdict(asImage(`https://blob.test/refs/${TEAMMATE}/1-a.jpg`)), notYours("image"));
  assert.deepEqual(verdict(asImage("https://blob.test/avatars/7/0123456789abcdef0123456789abcdef.webp")), notYours("image"), "nothing but refs/ and results");
  assert.deepEqual(verdict(asImage(`https://blob.test/refs/${ME}/%2e%2e/${TEAMMATE}/1-a.jpg`)), notYours("image"), "an escaped path is no upload of mine");
  assert.deepEqual(verdict(asImage(`http://blob.test./refs/${TEAMMATE}/1-a.jpg`)), notYours("image"), "another scheme and a trailing dot are still the store");
});

test("the member's own uploads pass as before, and so does a URL this app cannot place, such as a Higgsfield upload", () => {
  assert.equal(verdict(asImage(`https://blob.test/refs/${ME}/1730000000000-ab12cd34-Xy9.jpg`)), null);
  assert.equal(verdict(asImage("https://cdn.higgsfield.test/input/upload.jpeg")), null);
});

test("a draft is checked in every field, the end frame included, against the rows its URLs name", async () => {
  const theirs = row({ id: IMAGE_ID, userId: TEAMMATE, modelId: "openai/gpt-image-2/generations", resultUrl: null, storagePath: `images/${IMAGE_ID}.png` as ObjectKey });
  assert.deepEqual(await check(draft({ mode: "i2v", images: [`https://blob.test/refs/${ME}/1-a.jpg`], endImage: STORED_IMAGE }), [theirs]), [400, { code: "refNotYours", params: { kind: "image" } }]);
  assert.deepEqual(await check(draft({ videos: [{ url: `${HF}?x=1#t`, seconds: 5 }] }), [row({ userId: TEAMMATE })]), [400, { code: "refNotYours", params: { kind: "video" } }], "a query or fragment does not hide a teammate's result");
  assert.deepEqual(await check(draft({ videos: [{ url: STORED_VIDEO, seconds: 2 }] }), [video]), [400, { code: "refMismatch" }]);
  assert.equal(await check(draft({ images: [STORED_IMAGE, "https://cdn.higgsfield.test/input/upload.jpeg"], videos: [{ url: HF, seconds: 5 }] }), [image, video]), null);
  assert.equal(await check(draft({ mode: "t2v" }), []), null);
});
