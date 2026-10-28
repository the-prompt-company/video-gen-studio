/**
 * src/lib/storage.ts against the fake's Vercel Blob subset, through the real @vercel/blob client. Nothing here needs
 * the database or a real Blob store:
 *
 *   node --expose-gc --test --import tsx scripts/storage.test.ts
 *
 * The memory test copies 512 MB into a fake running in its own process, so only this process's side of the copy is
 * sampled. It takes a few seconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { put } from "@vercel/blob";
import { configFromEnv, createFakeHiggsfield } from "./fake-higgsfield";
import { byteLimit, copyVideo, deleteRefs, isRefPathname, putVideo, refPrefix, storageEnabled, videoKey, videoUrls } from "../src/lib/storage";
import { refUploadName } from "../src/lib/ref-name";

const MB = 1024 * 1024;
/** MAX_COPY_BYTES and COPY_TIMEOUT_MS in src/lib/generations.ts. */
const LIMITS = { maxBytes: 1024 ** 3, timeoutMs: 240_000 };
const TOKEN = "vercel_blob_rw_fakestore_secret";
const ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const OTHER = "00000000-0000-4000-8000-000000000000";
const OWNER = 7;
const MEMBER = 8;

const streamOf = (text: string) => new Blob([text]).stream();

/** One deterministic MB, repeated, so a body of any size costs no memory to serve or to hash. */
const PATTERN = Buffer.alloc(MB);
for (let i = 0; i < MB; i++) PATTERN[i] = (i * 2654435761) >>> 24;

function patternDigest(size: number): string {
  const hash = createHash("sha256");
  for (let at = 0; at < size; at += MB) hash.update(PATTERN.subarray(0, Math.min(MB, size - at)));
  return hash.digest("hex");
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server) {
  server.closeAllConnections();
  server.close();
}

/**
 * Serves /?size=N bytes of PATTERN, with Content-Length unless chunked=1, pausing stallMs halfway when asked. A
 * `declared` larger than size sends that Content-Length instead. `sent` counts what each request wrote.
 */
async function source() {
  const sent: number[] = [];
  const server = createServer(async (req, res) => {
    const q = new URL(req.url ?? "/", "http://source").searchParams;
    const size = Number(q.get("size"));
    const stallMs = Number(q.get("stall") ?? 0);
    const length = q.get("chunked") === "1" ? {} : { "Content-Length": q.get("declared") ?? String(size) };
    res.writeHead(200, { "Content-Type": "video/mp4", ...length });
    const n = sent.push(0) - 1;
    let stalled = false;
    while (sent[n] < size && !res.destroyed) {
      if (stallMs > 0 && !stalled && sent[n] >= size / 2) {
        stalled = true;
        await new Promise((r) => setTimeout(r, stallMs));
      }
      const chunk = PATTERN.subarray(0, Math.min(MB, size - sent[n]));
      const drained = res.write(chunk);
      sent[n] += chunk.length;
      if (!drained) await Promise.race([once(res, "drain"), once(res, "close")]);
    }
    res.end();
  });
  return { base: await listen(server), sent, close: () => close(server) };
}

/** The fake in this process, with the env storage.ts and @vercel/blob read pointed at it. */
async function blobFake() {
  const server = createFakeHiggsfield({ ...configFromEnv({}), durationMs: [100, 100] });
  const base = await listen(server);
  pointBlobAt(base);
  return { base, stats: () => blobStats(base), close: () => close(server) };
}

function pointBlobAt(base: string) {
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  process.env.VERCEL_BLOB_API_URL = `${base}/api/blob`;
  process.env.BLOB_PUBLIC_BASE_URL = `${base}/blob`;
}

type ByKey = Record<string, { writes: number; size: number; sha256: string; contentType: string; cacheControlMaxAge: number | null; parts: number }>;

async function blobStats(base: string) {
  return ((await (await fetch(`${base}/_stats`)).json()) as { storage: { deleted: string[]; deleteUrls: string[]; byKey: ByKey } }).storage;
}

test("videoUrls derives the public and download URLs from the token's store id, with no network call", () => {
  delete process.env.BLOB_PUBLIC_BASE_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.equal(storageEnabled(), false);
  assert.equal(videoUrls(videoKey(ID)), null);
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Ce0rCu23VrrDzQap_SECRETsecret";
  assert.equal(storageEnabled(), true);
  assert.equal(videoKey(ID), `videos/${ID}.mp4`);
  assert.deepEqual(videoUrls(videoKey(ID)), {
    url: `https://ce0rcu23vrrdzqap.public.blob.vercel-storage.com/videos/${ID}.mp4`,
    downloadUrl: `https://ce0rcu23vrrdzqap.public.blob.vercel-storage.com/videos/${ID}.mp4?download=1`,
  });
  process.env.BLOB_READ_WRITE_TOKEN = "not-a-blob-token";
  assert.equal(storageEnabled(), false, "a token without a store id turns storage off instead of deriving a wrong URL");
});

test("copyVideo streams a result to videos/<id>.mp4 with a one-year cache, and the derived URLs serve it", async () => {
  const fake = await blobFake();
  const src = await source();
  try {
    const size = 3 * MB + 17;
    const key = videoKey(ID);
    assert.equal(await copyVideo(`${src.base}/?size=${size}`, key, LIMITS), size);
    const object = (await fake.stats()).byKey[key];
    assert.deepEqual(
      { writes: object.writes, size: object.size, sha256: object.sha256, contentType: object.contentType, maxAge: object.cacheControlMaxAge, parts: object.parts },
      { writes: 1, size, sha256: patternDigest(size), contentType: "video/mp4", maxAge: 365 * 24 * 3600, parts: 1 },
      "a body that fits in one 8 MB part goes up in one put",
    );
    const urls = videoUrls(key);
    assert.ok(urls);
    assert.equal(urls.url, `${fake.base}/blob/${key}`);
    const served = await fetch(urls.url);
    assert.equal(createHash("sha256").update(Buffer.from(await served.arrayBuffer())).digest("hex"), object.sha256);
    const download = await fetch(urls.downloadUrl);
    await download.arrayBuffer();
    assert.equal(download.headers.get("content-disposition"), `attachment; filename="${ID}.mp4"`);

    assert.equal(await copyVideo(`${src.base}/?size=${size}`, key, LIMITS), size);
    assert.equal((await fake.stats()).byKey[key].writes, 2, "a retry after a lost lease overwrites the same key");

    const big = 20 * MB + 5;
    assert.equal(await copyVideo(`${src.base}/?size=${big}&chunked=1`, videoKey(OTHER), LIMITS), big);
    const parts = (await fake.stats()).byKey[videoKey(OTHER)];
    assert.deepEqual({ size: parts.size, sha256: parts.sha256, parts: parts.parts }, { size: big, sha256: patternDigest(big), parts: 3 }, "a larger body goes up in 8 MB parts, in order");
  } finally {
    src.close();
    fake.close();
  }
});

test("byteLimit passes exactly 1 GiB and errors the stream at the first byte past it", async () => {
  async function drain(chunks: number, max: number) {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i++ < chunks) c.enqueue(PATTERN);
        else c.close();
      },
    });
    let overCalled = false;
    const limit = byteLimit(max, () => (overCalled = true));
    const reader = body.pipeThrough(limit.stream).getReader();
    let error: unknown = null;
    try {
      while (!(await reader.read()).done);
    } catch (e) {
      error = e;
    }
    return { error, bytes: limit.bytes(), overCalled, recorded: limit.error() };
  }
  const exact = await drain(1024, LIMITS.maxBytes);
  assert.deepEqual(exact, { error: null, bytes: LIMITS.maxBytes, overCalled: false, recorded: null });
  const over = await drain(1025, LIMITS.maxBytes);
  assert.match(String(over.error), /result too large: over 1073741824 bytes/);
  assert.equal(over.bytes, LIMITS.maxBytes + MB, "it stops at the chunk that crossed the cap");
  assert.ok(over.overCalled && over.recorded === over.error);
});

test("a Content-Length over 1 GiB is refused before anything is uploaded", async () => {
  const fake = await blobFake();
  const src = await source();
  try {
    const key = videoKey(ID);
    await assert.rejects(copyVideo(`${src.base}/?size=${64 * MB}&declared=${LIMITS.maxBytes + 1}`, key, LIMITS), /result too large: 1073741825 bytes/);
    assert.equal((await fake.stats()).byKey[key], undefined);
  } finally {
    src.close();
    fake.close();
  }
});

test("a body of unknown length is cut off past the cap, the download stops, and nothing is stored", async () => {
  const fake = await blobFake();
  const src = await source();
  try {
    const key = videoKey(ID);
    await assert.rejects(copyVideo(`${src.base}/?size=${200 * MB}&chunked=1`, key, { ...LIMITS, maxBytes: 32 * MB }), /result too large: over 33554432 bytes/);
    assert.equal((await fake.stats()).byKey[key], undefined);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(src.sent[0] < 100 * MB, `the source wrote ${Math.round(src.sent[0] / MB)} MB of 200 MB before the copy hung up`);
  } finally {
    src.close();
    fake.close();
  }
});

test("a source that stalls mid-body fails at the timeout with its cause, in one put and in parts", async () => {
  const fake = await blobFake();
  const src = await source();
  try {
    for (const [query, key] of [
      [`size=${3 * MB}&stall=5000`, videoKey(ID)],
      [`size=${40 * MB}&chunked=1&stall=5000`, videoKey(OTHER)],
    ] as const) {
      const t0 = Date.now();
      await assert.rejects(copyVideo(`${src.base}/?${query}`, key, { ...LIMITS, timeoutMs: 1000 }), (e: Error) => e.name === "TimeoutError");
      const took = Date.now() - t0;
      assert.ok(took >= 950 && took < 3000, `${query} stopped after ${took} ms, not after SDK retries`);
      assert.equal((await fake.stats()).byKey[key], undefined);
    }
  } finally {
    src.close();
    fake.close();
  }
});

test("putVideo fails instead of recording a key when the store answers at a URL videoUrls would not derive", async () => {
  const fake = await blobFake();
  try {
    process.env.BLOB_PUBLIC_BASE_URL = `${fake.base.replace("127.0.0.1", "localhost")}/blob`;
    await assert.rejects(putVideo(videoKey(ID), streamOf("x"), { contentType: "video/mp4" }), /blob URL mismatch/);
  } finally {
    fake.close();
  }
});

test("deleteRefs deletes reference uploads in this store and never a stored video, however its URL is spelled", async () => {
  const fake = await blobFake();
  try {
    const key = videoKey(ID);
    await putVideo(key, streamOf("video bytes"), { contentType: "video/mp4" });
    const ref = await put(`refs/${OWNER}/1-clip.mp4`, Buffer.from("ref"), { access: "public", addRandomSuffix: true, token: TOKEN });
    const video = videoUrls(key)?.url ?? "";
    const spellings = [
      video,
      video.replace("/videos/", "/%76ideos/"),
      video.replace("/videos/", "/%2576ideos/"),
      video.replace("/videos/", "/VIDEOS/"),
      video.replace("/videos/", "/Videos%5C"),
      video.replace("/videos/", "//videos/"),
      video.replace("/videos/", "/refs/%2e%2e/videos/"),
      video.replace("/videos/", "/refs/%252e%252e/videos/"),
      video.replace("/videos/", "/refs%2Fvideos/"),
      video.replace("/videos/", "/refs/%E0%A4%A/"),
      video.replace("/videos/", `/refs/${OWNER}/%2e%2e/%2e%2e/videos/`),
      video.replace("/videos/", `/refs/${OWNER}/%252e%252e/%252e%252e/videos/`),
      video.replace("/videos/", `/refs/${OWNER}/..%5C..%5Cvideos/`),
      video.replace("/videos/", `/refs/${OWNER}/%E0%A4%A/`),
    ];
    const elsewhere = [`https://fakestore.public.blob.vercel-storage.com/${key}`, "https://cdn.higgsfield.ai/ref.png", "not a url"];
    const deleted = await deleteRefs([ref.url, ...spellings, ...elsewhere], OWNER);
    assert.deepEqual(deleted, [ref.url]);
    assert.deepEqual((await fake.stats()).deleted, [ref.pathname], "del() was asked for the reference alone");
    assert.equal((await fetch(video)).status, 200);
    assert.equal((await fetch(ref.url)).status, 404);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    assert.deepEqual(await deleteRefs([ref.url], OWNER), [], "with storage off nothing is deleted");
  } finally {
    fake.close();
  }
});

test("deleteRefs deletes the row owner's refs/<id>/ upload and never another member's, however its URL is spelled", async () => {
  const fake = await blobFake();
  try {
    const upload = (pathname: string) => put(pathname, Buffer.from(pathname), { access: "public", addRandomSuffix: true, token: TOKEN });
    const own = await upload(`refs/${OWNER}/1-clip.mp4`);
    const member = await upload(`refs/${MEMBER}/1-clip.mp4`);
    const kept = [member, await upload(`refs/${OWNER}${OWNER}/1-clip.mp4`), await upload("refs/1-clip.mp4"), await upload("1-clip.mp4")];
    const name = member.pathname.slice(`refs/${MEMBER}/`.length);
    const blob = `${fake.base}/blob`;
    const tricks = [
      `${blob}/refs/${OWNER}/../${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/%2e%2e/${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/%252e%252e/${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/..%2F${MEMBER}%2F${name}`,
      `${blob}/refs/${OWNER}/..%5C${MEMBER}%5C${name}`,
      `${blob}/refs/${OWNER}%2F..%2F${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/x/..%252F..%252F${MEMBER}%252F${name}`,
      `${blob}/refs/${OWNER}//../${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/%EF%BC%8E%EF%BC%8E/${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/．．/${MEMBER}/${name}`,
      `${blob}/refs/${OWNER}/..%2F${MEMBER}%2F${name}`,
      `${own.url}?p=../../${MEMBER}/${name}`,
      `${own.url}#/../../${MEMBER}/${name}`,
    ];
    const elsewhere = [
      own.url.replace("127.0.0.1", "localhost"),
      `https://fakestore.public.blob.vercel-storage.com/${own.pathname}`,
      `https://cdn.higgsfield.ai/${own.pathname}`,
    ];
    const deleted = await deleteRefs([...kept.map((b) => b.url), ...tricks, ...elsewhere, own.url], OWNER);
    assert.deepEqual(deleted, [own.url]);
    const store = await fake.stats();
    assert.deepEqual(store.deleteUrls, [own.url], "del() sent the store the owner's upload URL alone, spelled canonically");
    assert.deepEqual(store.deleted, [own.pathname], "del() was asked for the owner's upload alone");
    for (const b of kept) assert.equal((await fetch(b.url)).status, 200, `${b.pathname} is still served`);
    assert.equal((await fetch(own.url)).status, 404);
  } finally {
    fake.close();
  }
});

test("isRefPathname admits one plain file name under the uploader's refs/<id>/ and nothing else", () => {
  assert.equal(refPrefix(OWNER), `refs/${OWNER}/`);
  for (const p of [`refs/${OWNER}/1793200000000-clip.mp4`, `refs/${OWNER}/1793200000000-3f9a1c2b-0a1b2c3d4e5f.MP4`, `refs/${OWNER}/a..b.png`, `refs/${OWNER}/clip_1`]) {
    assert.equal(isRefPathname(p, OWNER), true, p);
  }
  for (const p of [
    "videos/x.mp4",
    videoKey(ID),
    `refs/${MEMBER}/x.mp4`,
    `refs/${OWNER}${OWNER}/x.mp4`,
    "refs/1793200000000-clip.mp4",
    `refs/${OWNER}/`,
    `refs/${OWNER}/.`,
    `refs/${OWNER}/..`,
    `refs/${OWNER}/../${MEMBER}/x.mp4`,
    `refs/${OWNER}/../../videos/x.mp4`,
    `refs/${OWNER}/a/b.mp4`,
    `refs/${OWNER}/..\\${MEMBER}\\x.mp4`,
    `/refs/${OWNER}/x.mp4`,
    `REFS/${OWNER}/x.mp4`,
    `x/refs/${OWNER}/x.mp4`,
    `refs/${OWNER}/레퍼런스 영상.mp4`,
    `refs/${OWNER}/clip 1.mp4`,
    `refs/${OWNER}/..%2F${MEMBER}%2Fx.mp4`,
    `refs/${OWNER}/%2e%2e`,
    `refs/${OWNER}/．．`,
    `refs/${OWNER}/.hidden.mp4`,
    `refs/${OWNER}/-x.mp4`,
    `refs/${OWNER}/${"a".repeat(201)}`,
  ]) {
    assert.equal(isRefPathname(p, OWNER), false, p);
  }
});

test("refUploadName gives every file, however it is named, a name the upload route accepts", () => {
  for (const file of ["레퍼런스 영상 최종본.MP4", "clip.mp4", "no extension", "../../videos/x.mp4", "a%2F..%2Fb.webp", "파일.MOV ", "．．.mp4"]) {
    const name = refUploadName(file, 1793200000000);
    assert.equal(isRefPathname(`${refPrefix(OWNER)}${name}`, OWNER), true, `${file} -> ${name}`);
  }
  assert.match(refUploadName("레퍼런스 영상 최종본.MP4", 1793200000000), /^1793200000000-[0-9a-f]{8}\.mp4$/);
  assert.notEqual(refUploadName("clip.mp4", 1), refUploadName("clip.mp4", 1), "two uploads in the same millisecond get different names");
});

/** The fake in its own process, so the bytes it keeps stay out of this process's memory samples. */
async function childFake() {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/fake-higgsfield.ts"], {
    env: { ...process.env, FAKE_HF_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const base = await new Promise<string>((resolve, reject) => {
    lines.on("line", (line) => {
      const m = /fake higgsfield on (http:\/\/\S+)/.exec(line);
      if (m) resolve(m[1]);
    });
    child.once("exit", (code) => reject(new Error(`the fake exited with ${code}`)));
  });
  return { base, stop: () => child.kill() };
}

test("copying 512 MB keeps this process's memory near the four-part window, far below the body", async () => {
  const fake = await childFake();
  const src = await source();
  try {
    pointBlobAt(fake.base);
    const size = 512 * MB;
    const key = videoKey(ID);
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const base = process.memoryUsage();
    const peak = { arrayBuffers: 0, rss: 0 };
    const sample = () => {
      const m = process.memoryUsage();
      peak.arrayBuffers = Math.max(peak.arrayBuffers, m.arrayBuffers - base.arrayBuffers);
      peak.rss = Math.max(peak.rss, m.rss - base.rss);
    };
    const timer = setInterval(sample, 5);
    const t0 = Date.now();
    const bytes = await copyVideo(`${src.base}/?size=${size}&chunked=1`, key, LIMITS);
    sample();
    clearInterval(timer);
    const mb = (n: number) => Math.round(n / MB);
    console.log(`COPY_PEAK ${JSON.stringify({ sizeMb: mb(size), ms: Date.now() - t0, gcBaseline: gc !== undefined, arrayBuffersPeakMb: mb(peak.arrayBuffers), rssPeakMb: mb(peak.rss) })}`);
    const object = (await blobStats(fake.base)).byKey[key];
    assert.deepEqual({ bytes, size: object.size, sha256: object.sha256 }, { bytes: size, size, sha256: patternDigest(size) });
    assert.ok(peak.rss < 192 * MB, `rss rose ${mb(peak.rss)} MB copying ${mb(size)} MB`);
    assert.ok(peak.arrayBuffers < 192 * MB, `arrayBuffers rose ${mb(peak.arrayBuffers)} MB copying ${mb(size)} MB`);
  } finally {
    src.close();
    fake.stop();
  }
});
