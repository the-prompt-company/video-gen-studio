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
 * Plus the subset of the Vercel Blob API that the real @vercel/blob client sends when VERCEL_BLOB_API_URL is
 * http://localhost:4010/api/blob, and public objects at BLOB_PUBLIC_BASE_URL http://localhost:4010/blob:
 *   PUT  /api/blob/?pathname=        one-request put: x-allow-overwrite, x-add-random-suffix, x-content-type and
 *                                    x-cache-control-max-age honored, the token must start with vercel_blob_rw_
 *   POST /api/blob/mpu?pathname=     multipart, x-mpu-action create, upload (x-mpu-part-number) and complete
 *   GET  /api/blob?url=              head
 *   POST /api/blob/delete            del, {"urls": [...]}; every pathname asked for is listed in /_stats
 *   GET  /blob/{pathname}            the stored bytes, Range honored, ?download=1 serves them as an attachment
 * Writes keep size and sha256 per pathname and count writes. Bytes stream in and are hashed as they arrive.
 * A browser upload carries a vercel_blob_client_ token from handleUpload instead. Like the real store, a write with it
 * must name the token's pathname and gets the token's addRandomSuffix. The fake reads the token without checking its
 * signature, and answers CORS preflights on /api/blob so a page on another port can upload
 * (NEXT_PUBLIC_VERCEL_BLOB_API_URL points the browser's @vercel/blob here).
 *
 *   npm run fake:hf   then   HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID, type Hash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getPayloadFromClientToken } from "@vercel/blob/client";

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

type BlobObject = {
  chunks: Buffer[];
  size: number;
  sha256: string;
  contentType: string;
  cacheControlMaxAge: number;
  etag: string;
  uploadedAt: Date;
};

type Multipart = { pathname: string; key: string; parts: Map<number, { chunks: Buffer[]; size: number; etag: string }> };

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
    /** byKey is per pathname. deleted lists every pathname a del() asked for, in order, whether or not it existed. */
    storage: {
      failed: 0,
      deleted: [] as string[],
      byKey: {} as Record<
        string,
        { writes: number; size: number; sha256: string; contentType: string; cacheControlMaxAge: number | null; allowOverwrite: boolean; parts: number }
      >,
    },
  };
}

export function createFakeHiggsfield(config: Config): Server {
  const jobs = new Map<string, Job>();
  const byIdempotencyKey = new Map<string, string>();
  const submitsByApiKey = new Map<string, number>();
  const pollSecond = new Map<string, { second: number; count: number }>();
  const uploads = new Map<string, { contentType: string; bytes: Buffer }>();
  const objects = new Map<string, BlobObject>();
  const multiparts = new Map<string, Multipart>();
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
    multiparts.clear();
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

  function blobError(res: ServerResponse, status: number, code: string, message: string) {
    return json(res, status, { error: { code, message } });
  }

  /** The public URL of a pathname, on the host the client called, which is the host BLOB_PUBLIC_BASE_URL names. */
  function blobUrl(req: IncomingMessage, pathname: string): string {
    return `http://${req.headers.host}/blob/${pathname}`;
  }

  function blobResult(req: IncomingMessage, pathname: string, object: BlobObject) {
    const url = blobUrl(req, pathname);
    const file = pathname.split("/").pop();
    return {
      url,
      downloadUrl: `${url}?download=1`,
      pathname,
      contentType: object.contentType,
      contentDisposition: `inline; filename="${file}"`,
      etag: object.etag,
    };
  }

  /** A pathname from a blob URL on this fake or on *.blob.vercel-storage.com, or the argument if it is not a URL. */
  function pathnameOf(urlOrPathname: string): string {
    try {
      const u = new URL(urlOrPathname);
      return decodeURIComponent(u.pathname.replace(/^\/blob\//, "/").slice(1));
    } catch {
      return urlOrPathname;
    }
  }

  /** Hash and keep a request body chunk by chunk, so a large upload is never concatenated. */
  async function receive(req: IncomingMessage): Promise<{ chunks: Buffer[]; size: number; hash: Hash }> {
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      const chunk = c as Buffer;
      hash.update(chunk);
      chunks.push(chunk);
      size += chunk.length;
    }
    return { chunks, size, hash };
  }

  /** The final pathname of a write, or an error answer when it would overwrite without x-allow-overwrite: 1. */
  function target(req: IncomingMessage, pathname: string, randomSuffix: boolean): string | null {
    let final = pathname;
    if (randomSuffix) {
      const dot = pathname.lastIndexOf(".");
      const suffix = `-${randomUUID().replace(/-/g, "").slice(0, 22)}`;
      final = dot > pathname.lastIndexOf("/") ? `${pathname.slice(0, dot)}${suffix}${pathname.slice(dot)}` : `${pathname}${suffix}`;
    }
    if (objects.has(final) && req.headers["x-allow-overwrite"] !== "1") return null;
    return final;
  }

  function store(req: IncomingMessage, pathname: string, chunks: Buffer[], size: number, sha256: string, parts: number): BlobObject {
    const maxAge = Number(req.headers["x-cache-control-max-age"] ?? 30 * 24 * 3600);
    const object: BlobObject = {
      chunks,
      size,
      sha256,
      contentType: String(req.headers["x-content-type"] ?? "application/octet-stream"),
      cacheControlMaxAge: maxAge,
      etag: `"${sha256.slice(0, 32)}"`,
      uploadedAt: new Date(),
    };
    objects.set(pathname, object);
    const entry = stats.storage.byKey[pathname];
    stats.storage.byKey[pathname] = {
      writes: (entry?.writes ?? 0) + 1,
      size,
      sha256,
      contentType: object.contentType,
      cacheControlMaxAge: req.headers["x-cache-control-max-age"] === undefined ? null : maxAge,
      allowOverwrite: req.headers["x-allow-overwrite"] === "1",
      parts,
    };
    return object;
  }

  async function blobApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/+$/, "");
    const auth = req.headers.authorization ?? "";
    const client = auth.startsWith("Bearer vercel_blob_client_") ? getPayloadFromClientToken(auth.slice("Bearer ".length)) : null;
    const writing = (method === "PUT" && path === "/api/blob") || (method === "POST" && path === "/api/blob/mpu");
    const pathname = url.searchParams.get("pathname") ?? "";
    const allowed = client ? writing && pathname === client.pathname : auth.startsWith("Bearer vercel_blob_rw_");
    if (!allowed) {
      req.resume();
      return blobError(res, 403, "forbidden", "Access denied, please provide a valid token for this resource.");
    }
    if (writing && ++storageWrites <= config.storageFailN) {
      await receive(req);
      stats.storage.failed++;
      return blobError(res, 400, "bad_request", "fake storage refused this write");
    }
    const randomSuffix = client ? client.addRandomSuffix === true : req.headers["x-add-random-suffix"] === "1";

    if (method === "PUT" && path === "/api/blob") {
      const final = target(req, pathname, randomSuffix);
      const body = await receive(req);
      if (final === null) return blobError(res, 400, "bad_request", "This blob already exists, use `allowOverwrite: true`");
      return json(res, 200, blobResult(req, final, store(req, final, body.chunks, body.size, body.hash.digest("hex"), 1)));
    }

    if (method === "POST" && path === "/api/blob/mpu") {
      const action = req.headers["x-mpu-action"];
      if (action === "create") {
        req.resume();
        const final = target(req, pathname, randomSuffix);
        if (final === null) return blobError(res, 400, "bad_request", "This blob already exists, use `allowOverwrite: true`");
        const uploadId = randomUUID();
        multiparts.set(uploadId, { pathname: final, key: `${final}#${uploadId}`, parts: new Map() });
        return json(res, 200, { key: `${final}#${uploadId}`, uploadId });
      }
      const upload = multiparts.get(String(req.headers["x-mpu-upload-id"] ?? ""));
      if (!upload || decodeURIComponent(String(req.headers["x-mpu-key"] ?? "")) !== upload.key) {
        req.resume();
        return blobError(res, 404, "not_found", "The multipart upload does not exist");
      }
      if (action === "upload") {
        const partNumber = Number(req.headers["x-mpu-part-number"]);
        const body = await receive(req);
        const etag = `"${body.hash.digest("hex").slice(0, 32)}"`;
        upload.parts.set(partNumber, { chunks: body.chunks, size: body.size, etag });
        return json(res, 200, { etag });
      }
      if (action === "complete") {
        const listed = JSON.parse((await readBody(req)) || "[]") as { partNumber: number; etag: string }[];
        listed.sort((a, b) => a.partNumber - b.partNumber);
        const hash = createHash("sha256");
        const chunks: Buffer[] = [];
        let size = 0;
        for (const p of listed) {
          const part = upload.parts.get(p.partNumber);
          if (!part || part.etag !== p.etag) return blobError(res, 400, "bad_request", `part ${p.partNumber} is missing or changed`);
          for (const c of part.chunks) hash.update(c);
          chunks.push(...part.chunks);
          size += part.size;
        }
        multiparts.delete(String(req.headers["x-mpu-upload-id"]));
        return json(res, 200, blobResult(req, upload.pathname, store(req, upload.pathname, chunks, size, hash.digest("hex"), listed.length)));
      }
      req.resume();
      return blobError(res, 400, "bad_request", `unknown x-mpu-action ${String(action)}`);
    }

    if (method === "GET" && path === "/api/blob") {
      const name = pathnameOf(url.searchParams.get("url") ?? "");
      const object = objects.get(name);
      if (!object) return blobError(res, 404, "not_found", "The requested blob does not exist");
      return json(res, 200, {
        ...blobResult(req, name, object),
        size: object.size,
        cacheControl: `public, max-age=${object.cacheControlMaxAge}`,
        uploadedAt: object.uploadedAt.toISOString(),
      });
    }

    if (method === "POST" && path === "/api/blob/delete") {
      const { urls = [] } = JSON.parse((await readBody(req)) || "{}") as { urls?: string[] };
      for (const u of urls) {
        const name = pathnameOf(u);
        stats.storage.deleted.push(name);
        objects.delete(name);
      }
      return json(res, 200, {});
    }
    req.resume();
    return blobError(res, 404, "not_found", `no fake for ${method} ${path}`);
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

    const publicObject = path.match(/^\/blob\/(.+)$/);
    if (method === "GET" && publicObject) {
      const pathname = decodeURIComponent(publicObject[1]);
      const object = objects.get(pathname);
      if (!object) return json(res, 404, { error: { code: "not_found", message: "The requested blob does not exist" } });
      const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
      return sendBytes(req, res, Buffer.concat(object.chunks), {
        "Content-Type": object.contentType,
        "Cache-Control": `public, max-age=${object.cacheControlMaxAge}`,
        "Content-Disposition": `${disposition}; filename="${pathname.split("/").pop()}"`,
        ETag: object.etag,
      });
    }
    if (path === "/api/blob" || path.startsWith("/api/blob/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (method !== "OPTIONS") return blobApi(req, res, url);
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, PUT, POST",
        "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "",
      });
      return res.end();
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
  const server = createFakeHiggsfield(config);
  server.listen(config.port, () => {
    console.log(`fake higgsfield on http://localhost:${(server.address() as AddressInfo).port}`);
  });
}
