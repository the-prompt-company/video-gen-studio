import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { buildArguments, type ModelSpec } from "@/lib/catalog";
import { decrypt } from "@/lib/crypto";
import { isLive, LIVE_STATUSES, predecessorsOf, RANK, type GenerationStatus } from "@/lib/generation-status";
import * as hf from "@/lib/higgsfield";

/** Runs slow follow-up work after the caller has its answer. Routes pass `after` from next/server. */
export type Scheduler = (task: () => Promise<void>) => void;

export type GenerationRequest = {
  spec: ModelSpec;
  prompt: string;
  params: Record<string, unknown>;
  imageUrls: string[];
  videoUrls: string[];
};

/** A live row is asked about at most once per CHECK_GAP_S, whoever asks. */
const CHECK_GAP_S = 15;
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
  const outcome = await hf.submit(apiKeyFor(user), spec.id, args, { idempotencyKey: id, webhookUrl: null });
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
  return row;
}

/** Bring the row as far forward as Higgsfield allows right now. Safe under any number of concurrent callers. */
export function settle(gen: Generation, schedule: Scheduler): Promise<Generation> {
  return settleAs(gen, "poll", schedule);
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
  return refresh(gen, { ...POLICY.poll, forceCheck: true }, schedule);
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
    resultUrl: g.blobUrl ?? g.resultUrl,
    expiresAt: g.expiresAt,
    durationS: g.durationS,
    costUsd: Number(g.costUsd),
    error: g.error,
    createdAt: g.createdAt,
    completedAt: g.completedAt,
  };
}

export type PublicGeneration = ReturnType<typeof publicGeneration>;

type SettleReason = "poll";
type Policy = { forceCheck: boolean };

const POLICY = {
  poll: { forceCheck: false },
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
  const db = getDb();
  const g = schema.generations;
  const [row] = await db
    .update(g)
    .set({ status: step.to, ...step.patch })
    .where(and(eq(g.id, gen.id), inArray(g.status, predecessorsOf(step.to))))
    .returning();
  if (!row) {
    const [current] = await db.select().from(g).where(eq(g.id, gen.id)).limit(1);
    return current ?? gen;
  }
  if (!isLive(row.status)) schedule(() => onTerminal(row));
  return row;
}

function settleAs(gen: Generation, reason: SettleReason, schedule: Scheduler): Promise<Generation> {
  return refresh(gen, POLICY[reason], schedule);
}

/** Ask Higgsfield about a live row, but only if this caller wins the row's check claim. */
async function refresh(gen: Generation, policy: Policy, schedule: Scheduler): Promise<Generation> {
  const requestId = gen.requestId;
  if (!isLive(gen.status) || !requestId) return gen;
  if (!(await claimCheck(gen.id, policy.forceCheck))) return gen;
  const key = await ownerKey(gen.userId);
  if (!key) {
    console.warn(JSON.stringify({ evt: "status_skipped", id: gen.id, reason: "owner has no api key" }));
    return gen;
  }
  let state: hf.ProviderState;
  try {
    state = await hf.status(key, requestId);
  } catch (e) {
    if (!(e instanceof hf.ProviderUnavailable)) throw e;
    console.warn(JSON.stringify({ evt: "status_unavailable", id: gen.id, error: e.message }));
    return gen;
  }
  const pricePerSecUsd = state.kind === "completed" ? await priceFor(gen.modelId) : 0;
  return apply(gen, decide(gen, { source: "status", state }, { now: new Date(), pricePerSecUsd }), schedule);
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

async function onTerminal(row: Generation): Promise<void> {
  await cleanupRefs(row);
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
