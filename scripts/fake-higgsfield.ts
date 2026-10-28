/**
 * Fake Higgsfield for local runs and tests. Same wire shapes as src/lib/higgsfield.ts:
 *   POST /{model_id}                 body = model arguments, Idempotency-Key honored
 *   GET  /requests/{id}/status       queued -> in_progress -> completed on a timer
 *   POST /requests/{id}/cancel       queued only
 *   GET  /media/{id}.mp4             deterministic bytes once completed
 *   POST /files/generate-upload-url  then PUT the bytes to upload_url, GET public_url
 *   GET  /_stats, POST /_reset       test hooks, not part of the real API
 *   POST /_config                    test hook: {"mediaDelayMs"?, "storageFailN"?, "statusFailN"?, "dropWebhooks"?,
 *                                    "dupWebhooks"?, "firstN429"?, "retryAfterS"?, "submitFailN"?, "submitDelayMs"?}
 *                                    changes those knobs while running and answers with all of them
 *
 * Webhooks go to ?hf_webhook=<url> when a request completes. Like Higgsfield, a 5xx or network error is redelivered
 * (here after FAKE_HF_WEBHOOK_RETRY_MS, doubling, for up to 2 hours) and a 4xx is not.
 *
 * Plus the subset of Supabase Storage that src/lib/storage.ts uses, so SUPABASE_URL can point here too:
 *   POST|PUT /storage/v1/object/{bucket}/{key}   x-upsert honored, sha256 and size kept, writes counted per key
 *   GET  /storage/v1/object/public/{bucket}/{key}  ?download=<name> adds Content-Disposition
 *
 *   npm run fake:hf   then   HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Config = {
  port: number;
  durationMs: [number, number];
  firstN429: number;
  retryAfterS: number;
  submitFailN: number;
  submitDelayMs: number;
  dropWebhooks: number;
  dupWebhooks: boolean;
  videoBytes: number;
  videoFile: string | null;
  mediaDelayMs: number;
  storageFailN: number;
  statusFailN: number;
  webhookRetryMs: number;
};

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const range = (env.FAKE_HF_DURATION_MS ?? "3000-8000").split("-").map(Number);
  return {
    port: Number(env.FAKE_HF_PORT ?? 4010),
    durationMs: [range[0], range[1] ?? range[0]],
    firstN429: Number(env.FAKE_HF_429_FIRST_N ?? 0),
    retryAfterS: Number(env.FAKE_HF_RETRY_AFTER_S ?? 5),
    submitFailN: Number(env.FAKE_HF_SUBMIT_FAIL_N ?? 0),
    submitDelayMs: Number(env.FAKE_HF_SUBMIT_DELAY_MS ?? 0),
    dropWebhooks: Number(env.FAKE_HF_DROP_WEBHOOKS ?? 0),
    dupWebhooks: env.FAKE_HF_DUP_WEBHOOKS === "1",
    videoBytes: Number(env.FAKE_HF_VIDEO_BYTES ?? 2 * 1024 * 1024),
    videoFile: env.FAKE_HF_VIDEO_FILE || null,
    mediaDelayMs: Number(env.FAKE_HF_MEDIA_DELAY_MS ?? 0),
    storageFailN: Number(env.FAKE_HF_STORAGE_FAIL_N ?? 0),
    statusFailN: Number(env.FAKE_HF_STATUS_FAIL_N ?? 0),
    webhookRetryMs: Number(env.FAKE_HF_WEBHOOK_RETRY_MS ?? 2000),
  };
}

/** The submit knobs. firstN429 set through /_config starts a fresh count for every key. */
type Submits = "firstN429" | "retryAfterS" | "submitFailN" | "submitDelayMs";

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
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_RETRY_WINDOW_MS = 2 * 3600_000;
const WEBHOOK_RETRY_CAP_MS = 5 * 60_000;

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
    rejected: { 429: 0, 422: 0, 503: 0 },
    statusPolls: {
      failed: 0,
      byRequest: {} as Record<string, { total: number; perSecondMax: number }>,
      byApiKey: {} as Record<string, number>,
    },
    /** byRequest lists the HTTP status of every delivery in order, 0 for a network error or timeout. */
    webhooks: { sent: 0, dropped: 0, failed: 0, retried: 0, byRequest: {} as Record<string, number[]> },
    media: { downloads: 0 },
    storage: {
      failed: 0,
      byKey: {} as Record<string, { writes: number; size: number; sha256: string; contentType: string; cacheControl: string | null; upsert: boolean }>,
    },
  };
}

export function createFakeHiggsfield(config: Config): Server {
  const jobs = new Map<string, Job>();
  const byIdempotencyKey = new Map<string, string>();
  const submitsByApiKey = new Map<string, number>();
  const pollSecond = new Map<string, { second: number; count: number }>();
  const uploads = new Map<string, { contentType: string; bytes: Buffer }>();
  const objects = new Map<string, { contentType: string; bytes: Buffer }>();
  const video = config.videoFile ? readFileSync(config.videoFile) : deterministicBytes(config.videoBytes);
  const videoType = config.videoFile?.endsWith(".webm") ? "video/webm" : "video/mp4";
  const redeliveries = new Set<NodeJS.Timeout>();
  let stats = newStats();
  let storageWrites = 0;
  let statusFails = config.statusFailN;
  let submitFails = config.submitFailN;
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
    for (const t of redeliveries) clearTimeout(t);
    redeliveries.clear();
    jobs.clear();
    byIdempotencyKey.clear();
    submitsByApiKey.clear();
    pollSecond.clear();
    uploads.clear();
    objects.clear();
    stats = newStats();
    storageWrites = 0;
    statusFails = config.statusFailN;
    submitFails = config.submitFailN;
  }

  function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  /** Serves bytes the way a CDN does. A <video> asks for `Range: bytes=0-` and holds a 200 open, so 206 matters. */
  function sendBytes(req: IncomingMessage, res: ServerResponse, bytes: Buffer, headers: Record<string, string>) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length && bytes.length > 0) {
      res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }).end();
      return;
    }
    res.writeHead(range ? 206 : 200, {
      ...headers,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      ...(range && { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }),
    });
    res.end(bytes.subarray(start, end + 1));
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

  function fireWebhook(job: Job) {
    job.webhookTimer = null;
    if (!job.webhookUrl) return;
    if (Math.random() < config.dropWebhooks) {
      stats.webhooks.dropped++;
      return;
    }
    const { status, video: videoUrl, expires_at } = statusBody(job, Date.now());
    const payload = JSON.stringify({ request_id: job.id, status, error: null, payload: { video: videoUrl }, expires_at });
    for (let i = 0; i < (config.dupWebhooks ? 2 : 1); i++) void deliver(job.id, job.webhookUrl, payload, Date.now(), 1);
  }

  async function deliver(requestId: string, url: string, payload: string, firstAt: number, attempt: number) {
    let status = 0;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      status = r.status;
      console.log(`webhook ${requestId} -> ${url} ${status}`);
    } catch (e) {
      console.log(`webhook ${requestId} -> ${url} failed: ${e instanceof Error ? e.message : e}`);
    }
    (stats.webhooks.byRequest[requestId] ??= []).push(status);
    if (status >= 200 && status < 300) {
      stats.webhooks.sent++;
      return;
    }
    stats.webhooks.failed++;
    const delay = Math.min(config.webhookRetryMs * 2 ** (attempt - 1), WEBHOOK_RETRY_CAP_MS);
    if ((status !== 0 && status < 500) || Date.now() + delay - firstAt > WEBHOOK_RETRY_WINDOW_MS) return;
    stats.webhooks.retried++;
    const timer = setTimeout(() => {
      redeliveries.delete(timer);
      void deliver(requestId, url, payload, firstAt, attempt + 1);
    }, delay);
    timer.unref();
    redeliveries.add(timer);
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
    if (config.submitDelayMs > 0) await new Promise((r) => setTimeout(r, config.submitDelayMs));
    const retryAfter = { "Retry-After": String(config.retryAfterS) };
    if (submitFails > 0) {
      submitFails--;
      stats.rejected[503]++;
      return json(res, 503, { detail: "fake submit refused this call" }, retryAfter);
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
      return json(res, 429, { detail: "Too many requests" }, retryAfter);
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
    if (method === "POST" && path === "/_config") {
      const patch = JSON.parse((await readBody(req)) || "{}") as Partial<
        Pick<Config, "mediaDelayMs" | "storageFailN" | "statusFailN" | "dropWebhooks" | "dupWebhooks" | Submits>
      >;
      if (typeof patch.mediaDelayMs === "number") config.mediaDelayMs = patch.mediaDelayMs;
      if (typeof patch.storageFailN === "number") {
        config.storageFailN = patch.storageFailN;
        storageWrites = 0;
      }
      if (typeof patch.statusFailN === "number") statusFails = config.statusFailN = patch.statusFailN;
      if (typeof patch.dropWebhooks === "number") config.dropWebhooks = patch.dropWebhooks;
      if (typeof patch.dupWebhooks === "boolean") config.dupWebhooks = patch.dupWebhooks;
      if (typeof patch.firstN429 === "number") {
        config.firstN429 = patch.firstN429;
        submitsByApiKey.clear();
      }
      if (typeof patch.retryAfterS === "number") config.retryAfterS = patch.retryAfterS;
      if (typeof patch.submitFailN === "number") submitFails = config.submitFailN = patch.submitFailN;
      if (typeof patch.submitDelayMs === "number") config.submitDelayMs = patch.submitDelayMs;
      const { mediaDelayMs, storageFailN, statusFailN, dropWebhooks, dupWebhooks, firstN429, retryAfterS, submitFailN, submitDelayMs } = config;
      return json(res, 200, { mediaDelayMs, storageFailN, statusFailN, dropWebhooks, dupWebhooks, firstN429, retryAfterS, submitFailN, submitDelayMs });
    }

    const publicObject = path.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (method === "GET" && publicObject) {
      const object = objects.get(`${publicObject[1]}/${publicObject[2]}`);
      if (!object) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      const download = url.searchParams.get("download");
      return sendBytes(req, res, object.bytes, {
        "Content-Type": object.contentType,
        "Cache-Control": "public, max-age=31536000",
        ...(download !== null && { "Content-Disposition": `attachment; filename="${download || publicObject[2]}"` }),
      });
    }
    const objectWrite = path.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if ((method === "POST" || method === "PUT") && objectWrite) {
      const key = `${objectWrite[1]}/${objectWrite[2]}`;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const bytes = Buffer.concat(chunks);
      if (++storageWrites <= config.storageFailN) {
        stats.storage.failed++;
        return json(res, 500, { statusCode: "500", error: "InternalError", message: "fake storage refused this write" });
      }
      const upsert = method === "PUT" || req.headers["x-upsert"] === "true";
      if (objects.has(key) && !upsert) return json(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const contentType = req.headers["content-type"] ?? "application/octet-stream";
      objects.set(key, { contentType, bytes });
      const entry = stats.storage.byKey[key];
      stats.storage.byKey[key] = {
        writes: (entry?.writes ?? 0) + 1,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        contentType,
        cacheControl: req.headers["cache-control"] ?? null,
        upsert,
      };
      return json(res, 200, { Key: key, Id: randomUUID() });
    }

    const media = path.match(/^\/media\/([^/]+)\.mp4$/);
    if (method === "GET" && media) {
      const job = jobs.get(media[1]);
      if (!job || statusOf(job, Date.now()) !== "completed") return json(res, 404, { detail: "Not found" });
      stats.media.downloads++;
      setTimeout(() => sendBytes(req, res, video, { "Content-Type": videoType }), config.mediaDelayMs);
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
        if (statusFails > 0) {
          statusFails--;
          stats.statusPolls.failed++;
          return json(res, 503, { detail: "fake status refused this call" });
        }
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
