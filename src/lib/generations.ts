import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { buildArguments, type ModelSpec } from "@/lib/catalog";
import { decrypt, signToken, verifyToken } from "@/lib/crypto";
import { isLive, LIVE_STATUSES, predecessorsOf, RANK, type GenerationStatus } from "@/lib/generation-status";
import * as hf from "@/lib/higgsfield";
import * as storage from "@/lib/storage";

/** Runs slow follow-up work after the caller has its answer. Routes pass `after` from next/server. */
export type Scheduler = (task: () => Promise<void>) => void;

export type GenerationRequest = {
  spec: ModelSpec;
  prompt: string;
  params: Record<string, unknown>;
  imageUrls: string[];
  videoUrls: string[];
};

/** Where the browser plays the result from. `storing` says a copy into our bucket is still expected. */
export type PublicVideo =
  | { kind: "stored"; url: string; downloadUrl: string }
  | { kind: "provider"; url: string; downloadUrl: string; expiresAt: Date | null; storing: boolean };

/** A live row is asked about at most once per CHECK_GAP_S, whoever asks. */
const CHECK_GAP_S = 15;
/** A copy claim holds at least this long, longer than the 300 s maxDuration of every route that copies. */
const MIRROR_LEASE_S = 360;
const MIRROR_BACKOFF_CAP_S = 6 * 3600;
const COPY_TIMEOUT_MS = 240_000;
const MAX_COPY_BYTES = 1024 ** 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY = "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요";

export function isGenerationId(s: string): boolean {
  return UUID.test(s);
}

export function apiKeyFor(user: User): hf.ApiKey {
  const key = keyFrom(user.apiKeyEnc);
  if (!key) throw new HttpError(403, NO_KEY);
  return key;
}

export async function priceFor(modelId: string): Promise<number> {
  const db = getDb();
  const [m] = await db.select().from(schema.models).where(eq(schema.models.modelId, modelId)).limit(1);
  return m ? Number(m.pricePerSecUsd) : 0;
}

/** Submit with Idempotency-Key = the new row's id, then insert the row as queued. */
export async function submitGeneration(user: User, req: GenerationRequest): Promise<Generation> {
  const { spec, prompt, params, imageUrls, videoUrls } = req;
  let args: Record<string, unknown>;
  try {
    args = buildArguments(spec, prompt, params, imageUrls, videoUrls);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  const id = randomUUID();
  const webhookUrl = hookUrl(id);
  const outcome = await hf.submit(apiKeyFor(user), spec.id, args, { idempotencyKey: id, webhookUrl });
  if (outcome.kind === "deferred") {
    const hint = outcome.cause === "rate_limited" ? ` (큐가 가득 참, ${outcome.retryAfterS}초 후 재시도)` : "";
    throw new HttpError(502, outcome.detail + hint);
  }
  if (outcome.kind === "rejected") throw new HttpError(502, outcome.error);
  const [row] = await getDb()
    .insert(schema.generations)
    .values({
      id,
      userId: user.id,
      modelId: spec.id,
      prompt,
      params,
      imageRefs: imageUrls,
      videoRefs: videoUrls,
      status: "queued",
      requestId: outcome.requestId,
      durationS: Number(params[spec.durationKey] ?? 0),
      costUsd: "0",
    })
    .returning();
  console.info(JSON.stringify({ evt: "generation_submitted", id, hookHost: webhookUrl && new URL(webhookUrl).host }));
  return row;
}

/** Bring the row as far forward as Higgsfield allows right now. Safe under any number of concurrent callers. */
export async function settle(gen: Generation, schedule: Scheduler): Promise<Generation> {
  return (await settleAs(gen, "poll", schedule)).row;
}

/** Cancel while queued. Returns the row afterwards: canceled, or wherever Higgsfield says the request went. */
export async function cancelGeneration(gen: Generation, schedule: Scheduler): Promise<Generation> {
  if (gen.status !== "queued" || !gen.requestId) throw new HttpError(409, "대기 중인 건만 취소할 수 있습니다");
  const key = await ownerKey(gen.userId);
  if (!key) throw new HttpError(403, NO_KEY);
  let answer: Awaited<ReturnType<typeof hf.cancel>>;
  try {
    answer = await hf.cancel(key, gen.requestId);
  } catch (e) {
    if (e instanceof hf.ProviderUnavailable) throw new HttpError(502, e.message);
    throw e;
  }
  if (answer === "canceled") return apply(gen, decide(gen, { source: "cancel" }, { now: new Date(), pricePerSecUsd: 0 }), schedule);
  const look = await refresh(gen, { forceCheck: true }, schedule);
  return look.call === "answered" ? look.row : current(gen);
}

export type HookOutcome = "done" | "unauthorized" | "retry";

/**
 * Higgsfield's webhook is a doorbell and its body is never read. The token in the URL proves we issued the URL for
 * this row, and a forced status check with the owner's key decides what happened. Done means the row is terminal.
 * Anything else asks Higgsfield to deliver again: the row is not inserted yet (submit inserts after Higgsfield
 * accepts), it has no request id, or Higgsfield gave no usable answer.
 */
export async function onProviderHook(url: URL, schedule: Scheduler): Promise<HookOutcome> {
  const id = url.searchParams.get("g") ?? "";
  if (!verifyToken("hf-hook", id, url.searchParams.get("t") ?? "")) {
    console.warn(JSON.stringify({ evt: "hook_unauthorized", id: id.slice(0, 36) }));
    return "unauthorized";
  }
  const g = schema.generations;
  const [row] = await getDb().select().from(g).where(eq(g.id, id)).limit(1);
  const look = row ? await settleAs(row, "hook", schedule) : null;
  if (look && !isLive(look.row.status)) return "done";
  console.warn(JSON.stringify({ evt: "hook_retry", id, status: look?.row.status ?? "missing", call: look?.call ?? "none" }));
  return "retry";
}

/**
 * Copy the completed result into our bucket. Any number of actors may call this: one conditional UPDATE on
 * mirror_next_at picks the single copier per lease, and an expired lease means that copier died, so the next
 * claimant uploads the same bytes to the same key again. Writes only the media columns, never status.
 */
export async function storeVideo(gen: Generation): Promise<Generation> {
  if (!storage.storageEnabled()) return gen;
  const claimed = await claimCopy(gen.id);
  if (!claimed?.resultUrl) return claimed ?? current(gen);
  const g = schema.generations;
  const attempt = claimed.mirrorAttempts;
  try {
    const t0 = Date.now();
    const { bytes, contentType } = await fetchResult(claimed.resultUrl);
    const fetchMs = Date.now() - t0;
    const key = storage.videoKey(claimed.id);
    const t1 = Date.now();
    await storage.putVideo(key, bytes, contentType);
    const uploadMs = Date.now() - t1;
    console.info(JSON.stringify({ evt: "video_stored", id: claimed.id, bytes: bytes.byteLength, fetchMs, uploadMs, attempt }));
    const [row] = await getDb()
      .update(g)
      .set({ storagePath: key, sizeBytes: bytes.byteLength, mirrorError: null })
      .where(eq(g.id, claimed.id))
      .returning();
    return row ?? claimed;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(JSON.stringify({ evt: "video_store_failed", id: claimed.id, attempt, error }));
    const [row] = await getDb().update(g).set({ mirrorError: error }).where(eq(g.id, claimed.id)).returning();
    return row ?? claimed;
  }
}

/** Shape sent to the browser (never the request id or anything secret). */
export function publicGeneration(g: Generation, username?: string) {
  return {
    id: g.id,
    username,
    modelId: g.modelId,
    prompt: g.prompt,
    params: g.params,
    imageRefs: g.imageRefs,
    videoRefs: g.videoRefs,
    status: g.status,
    video: publicVideo(g),
    durationS: g.durationS,
    costUsd: Number(g.costUsd),
    error: g.error,
    createdAt: g.createdAt,
    completedAt: g.completedAt,
  };
}

export type PublicGeneration = ReturnType<typeof publicGeneration>;

/** Stored once the copy landed and storage is still configured. Provider until then, or for good when storage is off. */
function publicVideo(g: Generation): PublicVideo | null {
  if (g.status !== "completed") return null;
  const stored = g.storagePath && storage.videoUrls(g.storagePath, `${g.id}.mp4`);
  if (stored) return { kind: "stored", ...stored };
  if (!g.resultUrl) return null;
  const unexpired = g.expiresAt === null || g.expiresAt.getTime() > Date.now();
  return { kind: "provider", url: g.resultUrl, downloadUrl: g.resultUrl, expiresAt: g.expiresAt, storing: storage.storageEnabled() && unexpired };
}

/** Who asks a row to move. The webhook forces a check, because it rings only once Higgsfield has an answer. */
type SettleReason = "poll" | "hook";
type Policy = { forceCheck: boolean };

const POLICY = {
  poll: { forceCheck: false },
  hook: { forceCheck: true },
} as const satisfies Record<SettleReason, Policy>;

type LifecyclePatch = Partial<
  Pick<typeof schema.generations.$inferInsert, "resultUrl" | "expiresAt" | "completedAt" | "costUsd" | "error">
>;

type Observation = { source: "status"; state: hf.ProviderState } | { source: "cancel" };

type Step = { kind: "move"; to: GenerationStatus; patch: LifecyclePatch } | { kind: "none" };

/**
 * The whole transition table. Pure.
 *   terminal + anything      → none
 *   live + running(s)        → move s, only when s ranks above the row
 *   live + completed(url)    → move completed  { resultUrl, expiresAt, completedAt, costUsd = price × durationS }
 *   live + ended(s, error)   → move s          { error, expiresAt, completedAt, costUsd 0 }
 *   live + missing           → move failed     { error "request not found", completedAt, costUsd 0 }
 *   live + cancel            → move canceled   { completedAt, costUsd 0 }
 */
function decide(gen: Generation, obs: Observation, ctx: { now: Date; pricePerSecUsd: number }): Step {
  if (!isLive(gen.status)) return { kind: "none" };
  const end = (to: GenerationStatus, patch: LifecyclePatch): Step => ({
    kind: "move",
    to,
    patch: { completedAt: ctx.now, costUsd: "0", ...patch },
  });
  if (obs.source === "cancel") return end("canceled", {});
  const s = obs.state;
  switch (s.kind) {
    case "running":
      return RANK[s.status] > RANK[gen.status] ? { kind: "move", to: s.status, patch: {} } : { kind: "none" };
    case "completed":
      return end("completed", {
        resultUrl: s.videoUrl,
        expiresAt: s.expiresAt,
        costUsd: (ctx.pricePerSecUsd * gen.durationS).toFixed(4),
        error: null,
      });
    case "ended":
      return end(s.status, { error: s.error, expiresAt: s.expiresAt });
    case "missing":
      return end("failed", { error: "request not found" });
  }
}

/**
 * The only statement that changes generations.status after insert. It matches only while the row still ranks below
 * the target, so a stale or repeated observation updates zero rows. Zero rows means another caller already moved the
 * row at least this far; the row is reread. Only the caller that moved the row schedules the terminal follow-up.
 */
async function apply(gen: Generation, step: Step, schedule: Scheduler): Promise<Generation> {
  if (step.kind === "none") return gen;
  const g = schema.generations;
  const [row] = await getDb()
    .update(g)
    .set({ status: step.to, ...step.patch })
    .where(and(eq(g.id, gen.id), inArray(g.status, predecessorsOf(step.to))))
    .returning();
  if (!row) return current(gen);
  if (!isLive(row.status)) schedule(() => onTerminal(row));
  return row;
}

async function current(gen: Generation): Promise<Generation> {
  const g = schema.generations;
  const [row] = await getDb().select().from(g).where(eq(g.id, gen.id)).limit(1);
  return row ?? gen;
}

function settleAs(gen: Generation, reason: SettleReason, schedule: Scheduler): Promise<Look> {
  return refresh(gen, POLICY[reason], schedule);
}

/**
 * What one refresh did, with the row as this caller now knows it. `answered`: Higgsfield answered this caller.
 * `unavailable`: this caller asked and got no usable answer. `none`: nothing to ask, no key, or another caller holds
 * the check, so the row is the one passed in.
 */
type Look = { row: Generation; call: "answered" | "unavailable" | "none" };

/** Ask Higgsfield about a live row, but only if this caller wins the row's check claim. */
async function refresh(gen: Generation, policy: Policy, schedule: Scheduler): Promise<Look> {
  const requestId = gen.requestId;
  if (!isLive(gen.status) || !requestId) return { row: gen, call: "none" };
  if (!(await claimCheck(gen.id, policy.forceCheck))) return { row: gen, call: "none" };
  const key = await ownerKey(gen.userId);
  if (!key) {
    console.warn(JSON.stringify({ evt: "status_skipped", id: gen.id, reason: "owner has no api key" }));
    return { row: gen, call: "none" };
  }
  let state: hf.ProviderState;
  try {
    state = await hf.status(key, requestId);
  } catch (e) {
    if (!(e instanceof hf.ProviderUnavailable)) throw e;
    console.warn(JSON.stringify({ evt: "status_unavailable", id: gen.id, error: e.message }));
    return { row: gen, call: "unavailable" };
  }
  const pricePerSecUsd = state.kind === "completed" ? await priceFor(gen.modelId) : 0;
  const row = await apply(gen, decide(gen, { source: "status", state }, { now: new Date(), pricePerSecUsd }), schedule);
  return { row, call: "answered" };
}

/**
 * Push next_check_at CHECK_GAP_S ahead. Unforced, it matches only when the row is due, so of any number of concurrent
 * callers exactly one wins per gap. Forced (a cancel Higgsfield refused) it always wins and resets the gap.
 */
async function claimCheck(id: string, force: boolean): Promise<boolean> {
  const g = schema.generations;
  const claimed = await getDb()
    .update(g)
    .set({ nextCheckAt: sql`now() + make_interval(secs => ${CHECK_GAP_S})` })
    .where(
      and(
        eq(g.id, id),
        inArray(g.status, LIVE_STATUSES),
        isNotNull(g.requestId),
        force ? undefined : lte(g.nextCheckAt, sql`now()`),
      ),
    )
    .returning({ id: g.id });
  return claimed.length > 0;
}

/**
 * The copy claim. It matches only a completed, unstored, unexpired row whose lease has run out, counts the attempt,
 * and pushes the lease max(MIRROR_LEASE_S, 60·2^attempts, capped at 6 h) ahead. Of any number of concurrent callers
 * exactly one gets the row back.
 */
async function claimCopy(id: string): Promise<Generation | null> {
  const g = schema.generations;
  const backoff = sql.raw(`greatest(${MIRROR_LEASE_S}, least(60 * power(2, mirror_attempts), ${MIRROR_BACKOFF_CAP_S}))`);
  const [row] = await getDb()
    .update(g)
    .set({ mirrorAttempts: sql`${g.mirrorAttempts} + 1`, mirrorNextAt: sql`now() + make_interval(secs => ${backoff})` })
    .where(
      and(
        eq(g.id, id),
        eq(g.status, "completed"),
        isNotNull(g.resultUrl),
        isNull(g.storagePath),
        or(isNull(g.mirrorNextAt), lte(g.mirrorNextAt, sql`now()`)),
        or(isNull(g.expiresAt), gt(g.expiresAt, sql`now()`)),
      ),
    )
    .returning();
  return row ?? null;
}

/** Buffer the result, refusing anything over MAX_COPY_BYTES before or while it streams in. */
async function fetchResult(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(COPY_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`result fetch failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_COPY_BYTES) throw new Error(`result too large: ${declared} bytes`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_COPY_BYTES) {
      await reader.cancel();
      throw new Error(`result too large: over ${MAX_COPY_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "video/mp4" };
}

/** Runs once per terminal move, by the caller that made it: ref cleanup, then the copy for a completed row. */
async function onTerminal(row: Generation): Promise<void> {
  await cleanupRefs(row);
  if (row.status === "completed") await storeVideo(row);
}

function isBlobUrl(u: string): boolean {
  return /\.blob\.vercel-storage\.com\//.test(u);
}

/** Delete temporary reference uploads from Vercel Blob once the request is finished. */
async function cleanupRefs(gen: Generation) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const urls = [...gen.imageRefs, ...gen.videoRefs].filter(isBlobUrl);
  if (urls.length === 0) return;
  try {
    await del(urls);
  } catch (e) {
    console.warn("blob cleanup failed", e);
  }
}

/**
 * Where Higgsfield rings for this row. Always the production host, because preview deployments sit behind Vercel's
 * deployment protection and cannot receive it. Null in local dev, where Higgsfield cannot reach this machine.
 */
function hookUrl(id: string): string | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = process.env.PUBLIC_BASE_URL || (host && `https://${host}`);
  if (!base) return null;
  const url = new URL("/api/hooks/higgsfield", base);
  url.searchParams.set("g", id);
  url.searchParams.set("t", signToken("hf-hook", id));
  return url.href;
}

async function ownerKey(userId: number): Promise<hf.ApiKey | null> {
  const [u] = await getDb()
    .select({ apiKeyEnc: schema.users.apiKeyEnc })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return keyFrom(u?.apiKeyEnc ?? null);
}

function keyFrom(enc: string | null): hf.ApiKey | null {
  return enc ? (decrypt(enc) as hf.ApiKey) : null;
}
