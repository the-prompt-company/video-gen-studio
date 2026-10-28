import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { StorageClient } from "@supabase/storage-js";
import { createFakeHiggsfield, configFromEnv, type Config } from "./fake-higgsfield";

const KEY = "fake:key";

async function listen(server: Server): Promise<string> {
  server.listen(0);
  await once(server, "listening");
  const a = server.address();
  return `http://localhost:${typeof a === "object" && a ? a.port : 0}`;
}

async function fake(overrides: Partial<Config> = {}) {
  const server = createFakeHiggsfield({ ...configFromEnv({}), durationMs: [100, 100], ...overrides });
  const base = await listen(server);
  return { base, close: () => server.close() };
}

async function submit(base: string, idempotencyKey: string, body: unknown, query = "") {
  const res = await fetch(`${base}/bytedance/seedance-2.0/reference-to-video${query}`, {
    method: "POST",
    headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as { request_id?: string } };
}

async function statusOf(base: string, id: string) {
  const res = await fetch(`${base}/requests/${id}/status`, { headers: { Authorization: `Key ${KEY}` } });
  return (await res.json()) as { status: string; video?: { url: string }; expires_at?: string };
}

async function stats(base: string) {
  return (await (await fetch(`${base}/_stats`)).json()) as {
    accepted: { total: number; byIdempotencyKey: Record<string, number> };
    rejected: { 429: number; 422: number; 503: number };
    webhooks: { sent: number; dropped: number; failed: number; retried: number; byRequest: Record<string, number[]> };
    media: { downloads: number };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("same Idempotency-Key and body returns the same request_id and counts one acceptance", async () => {
  const f = await fake();
  try {
    const a = await submit(f.base, "k1", { prompt: "a", duration: 5 });
    const b = await submit(f.base, "k1", { prompt: "a", duration: 5 });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.request_id, b.body.request_id);
    const s = await stats(f.base);
    assert.equal(s.accepted.total, 1);
    assert.equal(s.accepted.byIdempotencyKey.k1, 1);
  } finally {
    f.close();
  }
});

test("same Idempotency-Key with a different body is 422", async () => {
  const f = await fake();
  try {
    await submit(f.base, "k1", { prompt: "a", duration: 5 });
    const b = await submit(f.base, "k1", { prompt: "b", duration: 5 });
    assert.equal(b.status, 422);
    assert.equal((await stats(f.base)).rejected[422], 1);
  } finally {
    f.close();
  }
});

test("FAKE_HF_429_FIRST_N rejects the first N submits per key with Retry-After, then accepts", async () => {
  const f = await fake({ firstN429: 2 });
  try {
    const first = await submit(f.base, "k1", { prompt: "a" });
    const second = await submit(f.base, "k2", { prompt: "a" });
    const third = await submit(f.base, "k3", { prompt: "a" });
    assert.equal(first.status, 429);
    assert.equal(first.retryAfter, "5");
    assert.equal(second.status, 429);
    assert.equal(third.status, 200);
    const retry = await submit(f.base, "k1", { prompt: "a" });
    assert.equal(retry.status, 200, "a key that got 429 is not consumed");
    const s = await stats(f.base);
    assert.equal(s.rejected[429], 2);
    assert.equal(s.accepted.total, 2);
  } finally {
    f.close();
  }
});

test("POST /_config submitFailN answers 503 with Retry-After to that many submits, then the same key is accepted once", async () => {
  const f = await fake();
  try {
    await fetch(`${f.base}/_config`, { method: "POST", body: JSON.stringify({ submitFailN: 3, retryAfterS: 7 }) });
    const tries = [];
    for (let i = 0; i < 4; i++) tries.push(await submit(f.base, "k1", { prompt: "a" }));
    assert.deepEqual(tries.map((t) => t.status), [503, 503, 503, 200]);
    assert.equal(tries[0].retryAfter, "7");
    const s = await stats(f.base);
    assert.equal(s.rejected[503], 3);
    assert.equal(s.accepted.byIdempotencyKey.k1, 1);
  } finally {
    f.close();
  }
});

test("POST /_config submitDelayMs holds each submit answer, and firstN429 starts a fresh count with its Retry-After", async () => {
  const f = await fake();
  try {
    await submit(f.base, "k0", { prompt: "a" });
    await fetch(`${f.base}/_config`, { method: "POST", body: JSON.stringify({ submitDelayMs: 300, firstN429: 1, retryAfterS: 9 }) });
    const t0 = Date.now();
    const limited = await submit(f.base, "k1", { prompt: "a" });
    assert.ok(Date.now() - t0 >= 290, `answered after ${Date.now() - t0} ms`);
    assert.equal(limited.status, 429, "the key's earlier submit does not count toward the new firstN429");
    assert.equal(limited.retryAfter, "9");
    assert.equal((await submit(f.base, "k1", { prompt: "a" })).status, 200);
  } finally {
    f.close();
  }
});

test("FAKE_HF_DUP_WEBHOOKS posts the completion webhook twice", async () => {
  const received: { request_id: string; status: string; payload: { video: { url: string } } }[] = [];
  const hook = createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      received.push(JSON.parse(text));
      res.writeHead(204).end();
    });
  });
  const hookBase = await listen(hook);
  const f = await fake({ dupWebhooks: true });
  try {
    const a = await submit(f.base, "k1", { prompt: "a" }, `?hf_webhook=${encodeURIComponent(`${hookBase}/hook`)}`);
    await sleep(400);
    assert.equal(received.length, 2);
    for (const r of received) {
      assert.equal(r.request_id, a.body.request_id);
      assert.equal(r.status, "completed");
      assert.match(r.payload.video.url, /\/media\/.+\.mp4$/);
    }
    assert.equal((await stats(f.base)).webhooks.sent, 2);
  } finally {
    f.close();
    hook.close();
  }
});

test("a webhook answered with 5xx is redelivered until it gets a 2xx, and a 4xx is never redelivered", async () => {
  const answers: Record<string, number[]> = { "/retry": [503, 503, 204], "/reject": [401, 204] };
  const hook = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.writeHead(answers[req.url ?? ""]?.shift() ?? 500).end());
  });
  const hookBase = await listen(hook);
  const f = await fake({ webhookRetryMs: 50 });
  try {
    const retried = await submit(f.base, "k1", { prompt: "a" }, `?hf_webhook=${encodeURIComponent(`${hookBase}/retry`)}`);
    const rejected = await submit(f.base, "k2", { prompt: "a" }, `?hf_webhook=${encodeURIComponent(`${hookBase}/reject`)}`);
    await sleep(800);
    const s = (await stats(f.base)).webhooks;
    assert.deepEqual(s.byRequest[retried.body.request_id ?? ""], [503, 503, 204], "redelivered after each 503, 50 then 100 ms apart");
    assert.deepEqual(s.byRequest[rejected.body.request_id ?? ""], [401], "a 401 ends the delivery");
    assert.deepEqual({ sent: s.sent, failed: s.failed, retried: s.retried }, { sent: 1, failed: 3, retried: 2 });
  } finally {
    f.close();
    hook.close();
  }
});

test("POST /_config statusFailN answers 503 to that many status calls, and dropWebhooks stops deliveries", async () => {
  const delivered: string[] = [];
  const hook = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      delivered.push(req.url ?? "");
      res.writeHead(204).end();
    });
  });
  const hookBase = await listen(hook);
  const f = await fake();
  try {
    const knobs = await fetch(`${f.base}/_config`, { method: "POST", body: JSON.stringify({ statusFailN: 2, dropWebhooks: 1 }) });
    assert.deepEqual(await knobs.json(), {
      mediaDelayMs: 0,
      storageFailN: 0,
      statusFailN: 2,
      dropWebhooks: 1,
      dupWebhooks: false,
      firstN429: 0,
      retryAfterS: 5,
      submitFailN: 0,
      submitDelayMs: 0,
    });
    const { body } = await submit(f.base, "k1", { prompt: "a" }, `?hf_webhook=${encodeURIComponent(`${hookBase}/hook`)}`);
    const codes = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await fetch(`${f.base}/requests/${body.request_id}/status`, { headers: { Authorization: `Key ${KEY}` } })).status);
    }
    assert.deepEqual(codes, [503, 503, 200]);
    await sleep(400);
    assert.deepEqual(delivered, []);
    const s = (await (await fetch(`${f.base}/_stats`)).json()) as { statusPolls: { failed: number }; webhooks: { dropped: number } };
    assert.equal(s.statusPolls.failed, 2);
    assert.equal(s.webhooks.dropped, 1);
  } finally {
    f.close();
    hook.close();
  }
});

test("a request moves queued -> in_progress -> completed and then serves FAKE_HF_VIDEO_BYTES bytes", async () => {
  const f = await fake({ durationMs: [300, 300], videoBytes: 4096 });
  try {
    const { body } = await submit(f.base, "k1", { prompt: "a" });
    const id = body.request_id!;
    assert.equal((await statusOf(f.base, id)).status, "queued");
    await sleep(150);
    assert.equal((await statusOf(f.base, id)).status, "in_progress");
    await sleep(250);
    const done = await statusOf(f.base, id);
    assert.equal(done.status, "completed");
    assert.ok(done.expires_at && Date.parse(done.expires_at) > Date.now() + 6 * 86400_000);
    const media = await fetch(done.video!.url);
    assert.equal(media.status, 200);
    assert.equal((await media.arrayBuffer()).byteLength, 4096);
    assert.equal((await stats(f.base)).media.downloads, 1);
  } finally {
    f.close();
  }
});

test("cancel works while queued and is 409 afterwards", async () => {
  const f = await fake({ durationMs: [500, 500] });
  try {
    const { body } = await submit(f.base, "k1", { prompt: "a" });
    const id = body.request_id!;
    const cancel = await fetch(`${f.base}/requests/${id}/cancel`, { method: "POST", headers: { Authorization: `Key ${KEY}` } });
    assert.equal(cancel.status, 200);
    assert.equal((await statusOf(f.base, id)).status, "canceled");
    const again = await fetch(`${f.base}/requests/${id}/cancel`, { method: "POST", headers: { Authorization: `Key ${KEY}` } });
    assert.equal(again.status, 409);
  } finally {
    f.close();
  }
});

test("reference upload: ticket, PUT bytes, then GET public_url returns them", async () => {
  const f = await fake();
  try {
    const ticket = (await (
      await fetch(`${f.base}/files/generate-upload-url`, {
        method: "POST",
        headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: "image/png" }),
      })
    ).json()) as { public_url: string; upload_url: string; content_type: string };
    assert.equal(ticket.content_type, "image/png");
    const put = await fetch(ticket.upload_url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.from("png-bytes") });
    assert.equal(put.status, 200);
    const got = await fetch(ticket.public_url);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.equal(await got.text(), "png-bytes");
  } finally {
    f.close();
  }
});

test("the Supabase Storage subset answers the real storage-js client", async () => {
  const f = await fake();
  const bucket = new StorageClient(`${f.base}/storage/v1`, { apikey: "k", Authorization: "Bearer k" }).from("videos");
  const opts = { contentType: "video/mp4", cacheControl: "31536000" };
  const first = Buffer.from("first bytes");
  const second = Buffer.from("second, longer bytes");
  try {
    assert.equal((await bucket.upload("a.mp4", first, opts)).error, null);
    assert.ok((await bucket.upload("a.mp4", second, opts)).error, "a second write without upsert is refused");
    assert.equal((await bucket.upload("a.mp4", second, { ...opts, upsert: true })).error, null);
    const s = (await (await fetch(`${f.base}/_stats`)).json()) as {
      storage: { byKey: Record<string, { writes: number; size: number; sha256: string; cacheControl: string; upsert: boolean }> };
    };
    assert.deepEqual(s.storage.byKey["videos/a.mp4"], {
      writes: 2,
      size: second.length,
      sha256: createHash("sha256").update(second).digest("hex"),
      contentType: "video/mp4",
      cacheControl: "max-age=31536000",
      upsert: true,
    });
    const download = await fetch(bucket.getPublicUrl("a.mp4", { download: "a.mp4" }).data.publicUrl);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="a.mp4"');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), second);
    const part = await fetch(bucket.getPublicUrl("a.mp4").data.publicUrl, { headers: { Range: "bytes=0-4" } });
    assert.equal(part.status, 206, "a <video> range request gets a partial answer, as from a CDN");
    assert.equal(part.headers.get("content-range"), `bytes 0-4/${second.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), second.subarray(0, 5));
    await fetch(`${f.base}/_config`, { method: "POST", body: JSON.stringify({ storageFailN: 1 }) });
    assert.match((await bucket.upload("b.mp4", first, { ...opts, upsert: true })).error?.message ?? "", /refused/);
    assert.equal((await bucket.upload("b.mp4", first, { ...opts, upsert: true })).error, null, "only the next N writes fail");
  } finally {
    f.close();
  }
});
