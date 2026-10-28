import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
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
    rejected: { 429: number; 422: number };
    webhooks: { sent: number; dropped: number; failed: number };
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
