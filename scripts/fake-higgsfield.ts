/**
 * Fake Higgsfield for local runs and tests. Same wire shapes as src/lib/higgsfield.ts:
 *   POST /{model_id}                 body = model arguments, Idempotency-Key honored
 *   GET  /requests/{id}/status       queued -> in_progress -> completed on a timer
 *   POST /requests/{id}/cancel       queued only
 *   GET  /media/{id}.mp4             deterministic bytes once completed
 *   POST /files/generate-upload-url  then PUT the bytes to upload_url, GET public_url
 *   GET  /_stats, POST /_reset       test hooks, not part of the real API
 *
 *   npm run fake:hf   then   HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export type Config = {
  port: number;
  durationMs: [number, number];
  firstN429: number;
  dropWebhooks: number;
  dupWebhooks: boolean;
  videoBytes: number;
  mediaDelayMs: number;
};

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const range = (env.FAKE_HF_DURATION_MS ?? "3000-8000").split("-").map(Number);
  return {
    port: Number(env.FAKE_HF_PORT ?? 4010),
    durationMs: [range[0], range[1] ?? range[0]],
    firstN429: Number(env.FAKE_HF_429_FIRST_N ?? 0),
    dropWebhooks: Number(env.FAKE_HF_DROP_WEBHOOKS ?? 0),
    dupWebhooks: env.FAKE_HF_DUP_WEBHOOKS === "1",
    videoBytes: Number(env.FAKE_HF_VIDEO_BYTES ?? 2 * 1024 * 1024),
    mediaDelayMs: Number(env.FAKE_HF_MEDIA_DELAY_MS ?? 0),
  };
}

type Status = "queued" | "in_progress" | "completed" | "canceled";

type StatusBody = {
  status: Status;
  request_id: string;
  error: null;
  video?: { url: string };
  expires_at?: string;
};

type Job = {
  id: string;
  modelId: string;
  body: string;
  idempotencyKey: string | null;
  apiKey: string;
  createdAt: number;
  startAt: number;
  doneAt: number;
  canceledAt: number | null;
  webhookUrl: string | null;
  webhookTimer: NodeJS.Timeout | null;
};

const EXPIRES_AFTER_S = 7 * 24 * 3600;

function statusOf(job: Job, now: number): Status {
  if (job.canceledAt !== null) return "canceled";
  if (now >= job.doneAt) return "completed";
  if (now >= job.startAt) return "in_progress";
  return "queued";
}

function deterministicBytes(n: number): Buffer {
  const buf = Buffer.alloc(n);
  const words = new Uint32Array(buf.buffer, buf.byteOffset, Math.floor(n / 4));
  let x = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x >>> 0;
  }
  return buf;
}

function newStats() {
  return {
    accepted: { total: 0, byIdempotencyKey: {} as Record<string, number> },
    rejected: { 429: 0, 422: 0 },
    statusPolls: {
      byRequest: {} as Record<string, { total: number; perSecondMax: number }>,
      byApiKey: {} as Record<string, number>,
    },
    webhooks: { sent: 0, dropped: 0, failed: 0 },
    media: { downloads: 0 },
  };
}

export function createFakeHiggsfield(config: Config): Server {
  const jobs = new Map<string, Job>();
  const byIdempotencyKey = new Map<string, string>();
  const submitsByApiKey = new Map<string, number>();
  const pollSecond = new Map<string, { second: number; count: number }>();
  const uploads = new Map<string, { contentType: string; bytes: Buffer }>();
  const video = deterministicBytes(config.videoBytes);
  let stats = newStats();
  const server = createHttpServer((req, res) => {
    const started = Date.now();
    res.on("finish", () => console.log(`${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - started}ms`));
    handle(req, res).catch((e) => json(res, 500, { detail: String(e) }));
  });

  function base(): string {
    const a = server.address();
    return `http://localhost:${a && typeof a === "object" ? a.port : config.port}`;
  }

  function reset() {
    for (const job of jobs.values()) if (job.webhookTimer) clearTimeout(job.webhookTimer);
    jobs.clear();
    byIdempotencyKey.clear();
    submitsByApiKey.clear();
    pollSecond.clear();
    uploads.clear();
    stats = newStats();
  }

  function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  function statusBody(job: Job, now: number): StatusBody {
    const status = statusOf(job, now);
    const body: StatusBody = { status, request_id: job.id, error: null };
    if (status === "completed") {
      body.video = { url: `${base()}/media/${job.id}.mp4` };
      body.expires_at = new Date(job.doneAt + EXPIRES_AFTER_S * 1000).toISOString();
    }
    return body;
  }

  async function fireWebhook(job: Job) {
    job.webhookTimer = null;
    if (!job.webhookUrl) return;
    if (Math.random() < config.dropWebhooks) {
      stats.webhooks.dropped++;
      return;
    }
    const { status, video: videoUrl, expires_at } = statusBody(job, Date.now());
    const payload = { request_id: job.id, status, error: null, payload: { video: videoUrl }, expires_at };
    for (let i = 0; i < (config.dupWebhooks ? 2 : 1); i++) {
      try {
        const r = await fetch(job.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) stats.webhooks.sent++;
        else stats.webhooks.failed++;
        console.log(`webhook ${job.id} -> ${job.webhookUrl} ${r.status}`);
      } catch (e) {
        stats.webhooks.failed++;
        console.log(`webhook ${job.id} -> ${job.webhookUrl} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function submit(req: IncomingMessage, res: ServerResponse, url: URL, apiKey: string) {
    const modelId = url.pathname.slice(1);
    let body: string;
    try {
      body = JSON.stringify(JSON.parse(await readBody(req)));
    } catch {
      return json(res, 400, { detail: "body must be JSON" });
    }
    const idempotencyKey = req.headers["idempotency-key"]?.toString() ?? null;
    const existingId = idempotencyKey ? byIdempotencyKey.get(idempotencyKey) : undefined;
    const existing = existingId ? jobs.get(existingId) : undefined;
    if (existing) {
      if (existing.body !== body) {
        stats.rejected[422]++;
        return json(res, 422, { detail: "Idempotency-Key reused with a different body" });
      }
      return json(res, 200, submitBody(existing));
    }
    const attempts = (submitsByApiKey.get(apiKey) ?? 0) + 1;
    submitsByApiKey.set(apiKey, attempts);
    if (attempts <= config.firstN429) {
      stats.rejected[429]++;
      return json(res, 429, { detail: "Too many requests" }, { "Retry-After": "5" });
    }
    const now = Date.now();
    const [lo, hi] = config.durationMs;
    const duration = lo + Math.random() * (hi - lo);
    const job: Job = {
      id: randomUUID(),
      modelId,
      body,
      idempotencyKey,
      apiKey,
      createdAt: now,
      startAt: now + duration * 0.3,
      doneAt: now + duration,
      canceledAt: null,
      webhookUrl: url.searchParams.get("hf_webhook"),
      webhookTimer: null,
    };
    if (job.webhookUrl) job.webhookTimer = setTimeout(() => fireWebhook(job), duration);
    jobs.set(job.id, job);
    if (idempotencyKey) byIdempotencyKey.set(idempotencyKey, job.id);
    stats.accepted.total++;
    if (idempotencyKey) stats.accepted.byIdempotencyKey[idempotencyKey] = (stats.accepted.byIdempotencyKey[idempotencyKey] ?? 0) + 1;
    return json(res, 200, submitBody(job));
  }

  function submitBody(job: Job) {
    return {
      status: "queued",
      request_id: job.id,
      status_url: `${base()}/requests/${job.id}/status`,
      cancel_url: `${base()}/requests/${job.id}/cancel`,
      expires_after: EXPIRES_AFTER_S,
    };
  }

  function countPoll(job: Job, apiKey: string) {
    const second = Math.floor(Date.now() / 1000);
    const bucket = pollSecond.get(job.id);
    const count = bucket && bucket.second === second ? bucket.count + 1 : 1;
    pollSecond.set(job.id, { second, count });
    const entry = (stats.statusPolls.byRequest[job.id] ??= { total: 0, perSecondMax: 0 });
    entry.total++;
    entry.perSecondMax = Math.max(entry.perSecondMax, count);
    stats.statusPolls.byApiKey[apiKey] = (stats.statusPolls.byApiKey[apiKey] ?? 0) + 1;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", base());
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/_stats") return json(res, 200, stats);
    if (method === "POST" && path === "/_reset") {
      reset();
      return json(res, 200, { ok: true });
    }

    const media = path.match(/^\/media\/([^/]+)\.mp4$/);
    if (method === "GET" && media) {
      const job = jobs.get(media[1]);
      if (!job || statusOf(job, Date.now()) !== "completed") return json(res, 404, { detail: "Not found" });
      stats.media.downloads++;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(video.length) });
        res.end(video);
      }, config.mediaDelayMs);
      return;
    }

    const file = path === "/files/generate-upload-url" ? null : path.match(/^\/files\/([^/]+)$/);
    const upload = file ? uploads.get(file[1]) : undefined;
    if (file && !upload) return json(res, 404, { detail: "Not found" });
    if (upload && method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      upload.bytes = Buffer.concat(chunks);
      res.writeHead(200).end();
      return;
    }
    if (upload && method === "GET") {
      res.writeHead(200, { "Content-Type": upload.contentType, "Content-Length": String(upload.bytes.length) });
      res.end(upload.bytes);
      return;
    }

    const auth = req.headers.authorization?.match(/^Key (.+)$/);
    if (!auth) return json(res, 401, { detail: "Unauthorized" });
    const apiKey = auth[1];

    const request = path.match(/^\/requests\/([^/]+)\/(status|cancel)$/);
    if (request) {
      const job = jobs.get(request[1]);
      if (!job) return json(res, 404, { detail: "Request not found" });
      if (request[2] === "status" && method === "GET") {
        countPoll(job, apiKey);
        return json(res, 200, statusBody(job, Date.now()));
      }
      if (request[2] === "cancel" && method === "POST") {
        const now = Date.now();
        if (statusOf(job, now) !== "queued") return json(res, 409, { detail: `Cannot cancel a ${statusOf(job, now)} request` });
        job.canceledAt = now;
        if (job.webhookTimer) clearTimeout(job.webhookTimer);
        job.webhookTimer = null;
        return json(res, 200, statusBody(job, now));
      }
      return json(res, 405, { detail: "Method not allowed" });
    }

    if (method === "POST" && path === "/files/generate-upload-url") {
      const id = randomUUID();
      let contentType = "application/octet-stream";
      try {
        contentType = String((JSON.parse(await readBody(req)) as { content_type?: string }).content_type ?? contentType);
      } catch {
        return json(res, 400, { detail: "body must be JSON" });
      }
      uploads.set(id, { contentType, bytes: Buffer.alloc(0) });
      return json(res, 200, { public_url: `${base()}/files/${id}`, upload_url: `${base()}/files/${id}`, content_type: contentType });
    }
    if (method === "POST" && path.length > 1) return submit(req, res, url, apiKey);
    return json(res, 404, { detail: "Not found" });
  }

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFromEnv(process.env);
  createFakeHiggsfield(config).listen(config.port, () => {
    console.log(`fake higgsfield on http://localhost:${config.port}`);
  });
}
