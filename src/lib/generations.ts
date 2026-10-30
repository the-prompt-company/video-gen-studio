import { and, eq, getTableColumns, gt, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import {
  costUsd,
  describeModel,
  endpointsOfProvider,
  FAMILIES,
  resendRequest,
  type FamilyId,
  type ImageFormat,
  type ReadyPlan,
  type TokenUsage,
  type WireBody,
} from "@/lib/catalog";
import { decrypt, signToken, verifyToken } from "@/lib/crypto";
import { appError, type AppError, type Reason } from "@/lib/errors";
import { isLive, LIVE_STATUSES, predecessorsOf, RANK, type GenerationStatus } from "@/lib/generation-status";
import * as hf from "@/lib/higgsfield";
import * as openai from "@/lib/openai";
import * as storage from "@/lib/storage";

/** Runs slow follow-up work after the caller has its answer. Routes pass `after` from next/server. */
export type Scheduler = (task: () => Promise<void>) => void;

/** Where the browser plays the result from. `storing` says a copy into our bucket is still expected. */
export type PublicVideo =
  | { kind: "stored"; url: string; downloadUrl: string }
  | { kind: "provider"; url: string; downloadUrl: string; expiresAt: Date | null; storing: boolean };

/** Where the browser shows an image result. Always our bucket: OpenAI answers with bytes, not a URL. */
export type PublicImage = { url: string; downloadUrl: string; format: ImageFormat };

/** A live row is asked about at most once per CHECK_GAP_S, whoever asks. */
const CHECK_GAP_S = 15;
/** A forced check (a webhook, a refused cancel) skips the gap but not this floor, so replayed hooks share one call. */
const FORCED_CHECK_FLOOR_S = 1;
/** A submit claim holds this long, longer than the 20 s submit timeout, so an expired lease means the submitter died. */
const SUBMIT_LEASE_S = 30;
/** Higgsfield's Retry-After, clamped, is how long a deferred submit waits before anyone sends it again. */
const RESUBMIT_MIN_S = 5;
const RESUBMIT_MAX_S = 300;
/** The operator's call: a pending row older than this fails instead of starting a paid generation nobody expects now. */
const SUBMIT_DEADLINE_MIN = 30;
const SUBMIT_DEADLINE = appError("submitDeadline", { minutes: SUBMIT_DEADLINE_MIN });
/** A row Higgsfield may hold a job for, whose owner has no key, looks for the key again this often until the deadline. */
const NO_KEY_RETRY_S = 60;
/** A copy claim holds at least this long, longer than the 300 s maxDuration of every route that copies. */
const MIRROR_LEASE_S = 360;
const MIRROR_BACKOFF_CAP_S = 6 * 3600;
/** The whole copy, fetch and upload streamed together, stops after this. */
const COPY_TIMEOUT_MS = 240_000;
const MAX_COPY_BYTES = 1024 ** 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY = appError("noKey");

/**
 * The image call's clock. POST /api/generations runs the call in after(), inside its maxDuration = 300 s, and
 * lifecycle-check holds these against that literal.
 */
export const IMAGE_TIMING = {
  /** An unsent row nobody claimed by then never started, and fails at cost 0. */
  startGraceS: 60,
  /** A sent row's lease. Longer than maxDuration, so an expired lease means its runner is gone. */
  callLeaseS: 360,
  /** From submitGeneration's entry to the runner's last write. */
  runBudgetMs: 270_000,
  /** One OpenAI attempt at most. The guide's worst case is about 120 s. */
  callTimeoutMs: 225_000,
  /** Kept free after the call for the Blob puts and the completing UPDATE. */
  storeReserveMs: 40_000,
  storeAttemptMs: 15_000,
  /** A refused request is sent again only if a call this long still fits. */
  minResendCallMs: 120_000,
} as const;

export function isGenerationId(s: string): boolean {
  return UUID.test(s);
}

export function apiKeyFor(user: User): hf.ApiKey {
  const key = keyFrom(user.apiKeyEnc);
  if (!key) throw new HttpError(403, "noKey");
  return key;
}

export type Unavailable = { status: 403 | 503; error: AppError };

/**
 * Why `user` cannot generate with `family` now, or null. A Higgsfield model needs the member's own key (403). The
 * OpenAI model needs the server's OPENAI_API_KEY and Blob, since its image exists only in the runner's memory until it
 * is stored (503); the member's Higgsfield key is never consulted for it.
 */
export function unavailableFor(family: FamilyId, user: Pick<User, "apiKeyEnc">): Unavailable | null {
  if (FAMILIES[family].provider === "higgsfield") return user.apiKeyEnc ? null : { status: 403, error: appError("noKey") };
  if (!openai.serverKey()) return { status: 503, error: appError("noOpenAiKey") };
  if (!storage.storageEnabled()) return { status: 503, error: appError("noImageStore") };
  return null;
}

/**
 * Higgsfield: insert the planned row as pending, holding its submit lease, then submit once. Returns it queued
 * (accepted), failed (rejected), or still pending (deferred by a 429, 5xx, network error or timeout). A pending row is
 * sent again by the next poll, webhook or sweep, with the same Idempotency-Key, endpoint and body. The plan's estimate
 * is the row's cost from now on: completion keeps it, every other end sets it to 0. OpenAI: see startImage.
 */
export async function submitGeneration(user: User, plan: ReadyPlan, schedule: Scheduler): Promise<Generation> {
  if (FAMILIES[plan.family].provider === "openai") return startImage(user, plan, schedule);
  const key = apiKeyFor(user);
  const [row] = await getDb()
    .insert(schema.generations)
    .values({
      userId: user.id,
      modelId: plan.endpoint,
      prompt: plan.prompt,
      params: plan.params,
      requestBody: plan.body,
      imageRefs: [...plan.imageUrls],
      videoRefs: [...plan.videoUrls],
      status: "pending",
      nextCheckAt: sql`now() + make_interval(secs => ${SUBMIT_LEASE_S})`,
      durationS: plan.durationS,
      costUsd: plan.costUsd.toFixed(4),
    })
    .returning();
  return (await send(row, key, schedule)).row;
}

/** Bring the row as far forward as Higgsfield allows right now. Safe under any number of concurrent callers. */
export async function settle(gen: Generation, schedule: Scheduler): Promise<Generation> {
  return (await settleAs(gen, "poll", schedule)).row;
}

/**
 * Cancel while pending or queued. Returns the row afterwards: canceled, or wherever Higgsfield says the request went.
 * A pending row Higgsfield only ever refused is canceled here. One that Higgsfield may have accepted is sent again
 * with the same key first, and the request_id that comes back is canceled at Higgsfield. A cancel that cannot claim the
 * row (a submit is in flight) or whose resend gets no answer answers 409 and works a few seconds later. One whose owner
 * has no key answers 403 and keeps the row pending, because only that key can find and cancel the job.
 */
export async function cancelGeneration(gen: Generation, schedule: Scheduler): Promise<Generation> {
  if (gen.status === "pending") {
    const tried = (await resubmit(gen, schedule, "cancel")).row;
    const row = tried.status === "pending" ? await current(gen) : tried;
    if (row.status === "pending") throw row.errorCode === "noKey" ? new HttpError(403, "noKey") : new HttpError(409, "submitting");
    return row.status === "queued" ? cancelGeneration(row, schedule) : row;
  }
  if (gen.status !== "queued" || !gen.requestId) throw new HttpError(409, "notCancelable");
  const key = await ownerKey(gen.userId);
  if (!key) throw new HttpError(403, "noKey");
  let answer: Awaited<ReturnType<typeof hf.cancel>>;
  try {
    answer = await hf.cancel(key, gen.requestId);
  } catch (e) {
    if (e instanceof hf.ProviderUnavailable) throw new HttpError(502, "providerCancelFailed", { detail: e.message });
    throw e;
  }
  if (answer === "canceled") return apply(gen, decide(gen, { source: "cancel" }, { now: new Date() }), schedule);
  const look = await refresh(gen, { forceCheck: true }, schedule);
  return look.call === "answered" ? look.row : current(gen);
}

export type HookOutcome = "done" | "unauthorized" | "retry";

/**
 * Higgsfield's webhook is a doorbell and its body is never read. The token in the URL proves we issued the URL for
 * this row, and a forced status check with the owner's key decides what happened. A pending row is one whose accepted
 * submit we never recorded, so the hook sends it again first and gets the original request id back. Done means the
 * row is terminal, or gone: the row is inserted before its id reaches Higgsfield, so a missing row was deleted and no
 * redelivery can help. Anything else asks Higgsfield to deliver again: another caller holds the submit, the resend
 * was deferred, another caller claimed a status check within the last second, the row has no request id, or
 * Higgsfield gave no usable answer.
 */
export async function onProviderHook(url: URL, schedule: Scheduler): Promise<HookOutcome> {
  const id = url.searchParams.get("g") ?? "";
  if (!verifyToken("hf-hook", id, url.searchParams.get("t") ?? "")) {
    console.warn(JSON.stringify({ evt: "hook_unauthorized", id: id.slice(0, 36) }));
    return "unauthorized";
  }
  const g = schema.generations;
  const [row] = await getDb().select().from(g).where(eq(g.id, id)).limit(1);
  if (!row) {
    console.warn(JSON.stringify({ evt: "hook_missing", id }));
    return "done";
  }
  const seen = await settleAs(row, "hook", schedule);
  const now = seen.check === "answered" ? seen.row : await current(seen.row);
  if (!isLive(now.status)) return "done";
  console.warn(JSON.stringify({ evt: "hook_retry", id, status: now.status, submit: seen.submit, call: seen.check }));
  return "retry";
}

/**
 * submitted: submits Higgsfield accepted or refused. checked: status calls Higgsfield answered. moved: rows whose status
 * changed during the visit. stored: rows that gained a stored copy during the visit. failures: submits and status calls
 * with no usable answer, copies that failed, and visits that threw. truncated: the deadline stopped the sweep before
 * every due row was visited.
 */
export type SweepReport = {
  submitted: number;
  checked: number;
  moved: number;
  stored: number;
  failures: number;
  truncated: boolean;
};

/** Rows per due query. The sweep reads pages until none is left, so this bounds a query, not the work. */
const SWEEP_PAGE = 100;

/**
 * Visit every due row once, oldest first and one at a time, until none is left or `deadline` passes. A row is due
 * when it is pending and nobody is submitting it or waiting out a deferral, when it is live and its check clock ran
 * out, or when it is a completed result whose copy lease ran out. Copies run inline. Sweeps that overlap each other, a
 * hook, or a poll converge, because every step goes through the same claims.
 */
export async function sweep({ deadline }: { deadline: number }): Promise<SweepReport> {
  const started = Date.now();
  const report: SweepReport = { submitted: 0, checked: 0, moved: 0, stored: 0, failures: 0, truncated: false };
  const visited: string[] = [];
  while (!report.truncated) {
    const due = await dueRows(visited);
    if (due.length === 0) break;
    for (const row of due) {
      if (Date.now() >= deadline) {
        report.truncated = true;
        break;
      }
      visited.push(row.id);
      await visit(row, report);
    }
  }
  console.info(JSON.stringify({ evt: "sweep", ...report, ms: Date.now() - started }));
  return report;
}

/**
 * Stream the completed result into the Blob store. Any number of actors may call this: one conditional UPDATE on
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
    const key = storage.videoKey(claimed.id);
    const bytes = await storage.copyVideo(claimed.resultUrl, key, { maxBytes: MAX_COPY_BYTES, timeoutMs: COPY_TIMEOUT_MS });
    console.info(JSON.stringify({ evt: "video_stored", id: claimed.id, bytes, ms: Date.now() - t0, attempt }));
    const [row] = await getDb()
      .update(g)
      .set({ storagePath: key, sizeBytes: bytes, mirrorError: null })
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

/** Shape sent to the browser (never the request id or anything secret). An image row has `image`, a video row `video`. */
export function publicGeneration(g: Generation, username?: string) {
  const isImage = describeModel(g.modelId).output === "image";
  return {
    id: g.id,
    username,
    modelId: g.modelId,
    prompt: g.prompt,
    params: g.params,
    imageRefs: g.imageRefs,
    videoRefs: g.videoRefs,
    status: g.status,
    video: isImage ? null : publicVideo(g),
    image: isImage ? publicImage(g) : null,
    durationS: g.durationS,
    costUsd: Number(g.costUsd),
    reason: reasonOf(g),
    createdAt: g.createdAt,
    completedAt: g.completedAt,
  };
}

export type PublicGeneration = ReturnType<typeof publicGeneration>;

/** Why a row failed or waits, as stored: an error code the page translates, or text shown as written. */
export function reasonOf(g: Pick<Generation, "error" | "errorCode" | "errorParams">): Reason | null {
  if (g.errorCode) return appError(g.errorCode, g.errorParams ?? undefined);
  return g.error === null ? null : { text: g.error };
}

/** The three reason columns, always written together, so a row never keeps an old code beside new text. */
function reasonColumns(reason: Reason | null) {
  if (reason === null) return { error: null, errorCode: null, errorParams: null };
  if ("text" in reason) return { error: reason.text, errorCode: null, errorParams: null };
  return { error: null, errorCode: reason.code, errorParams: reason.params ?? null };
}

/** A pending row that waits out a deferral records why, in either form. */
function hasReason() {
  const g = schema.generations;
  return sql`(${g.error} is not null or ${g.errorCode} is not null)`;
}

/**
 * Stored once the copy landed and storage is still configured. Provider until then, or for good when storage is off
 * or the row has no request id (a mock row, which is never copied).
 */
function publicVideo(g: Generation): PublicVideo | null {
  if (g.status !== "completed") return null;
  const stored = g.storagePath && storage.objectUrls(g.storagePath);
  if (stored) return { kind: "stored", ...stored };
  if (!g.resultUrl) return null;
  const unexpired = g.expiresAt === null || g.expiresAt.getTime() > Date.now();
  const storing = storage.storageEnabled() && unexpired && g.requestId !== null;
  return { kind: "provider", url: g.resultUrl, downloadUrl: g.resultUrl, expiresAt: g.expiresAt, storing };
}

/** An image row completes only once its bytes are stored, so the key is all it takes. Null while storage is off. */
function publicImage(g: Generation): PublicImage | null {
  if (g.status !== "completed" || !g.storagePath) return null;
  const urls = storage.objectUrls(g.storagePath);
  const format = storage.imageFormatOf(g.storagePath);
  return urls && format ? { ...urls, format } : null;
}

/**
 * Who asks a row to move: an open tab, Higgsfield's webhook, or the cron sweep. Only the webhook forces a check,
 * because it rings once Higgsfield has an answer. Where the copy runs is the caller's Scheduler: `after` in a route,
 * inline in the sweep.
 */
type SettleReason = "poll" | "hook" | "sweep";
type Policy = { forceCheck: boolean };

const POLICY = {
  poll: { forceCheck: false },
  hook: { forceCheck: true },
  sweep: { forceCheck: false },
} as const satisfies Record<SettleReason, Policy>;

/** next_check_at is a claim clock, compared with the database's now(), so it is only ever written as SQL. */
type LifecyclePatch = Partial<
  Pick<typeof schema.generations.$inferInsert, "requestId" | "resultUrl" | "expiresAt" | "completedAt" | "costUsd" | "storagePath" | "sizeBytes">
> & { nextCheckAt?: SQL; reason?: Reason | null };

/**
 * What a caller learned: a submit answer, a status answer, a user's cancel, the clock, or that the owner has no key to
 * send with. The submit claim reads the clock on the database's clock (`late` means past the submit deadline).
 */
type Observation =
  | { source: "submit"; outcome: hf.SubmitOutcome }
  | { source: "status"; state: hf.ProviderState }
  | { source: "cancel" }
  | { source: "clock"; late: boolean }
  | { source: "noKey"; late: boolean };

/**
 * `wait` keeps a pending row pending, records why, and lets nobody send it again for `afterS`. `maybeAccepted` says the
 * answer was lost, so Higgsfield may hold a job for the row's key. `leaseAsSeen` makes a move match only while the
 * row's maybe_accepted is what the caller read and its lease has run out on the database's clock.
 */
type Step =
  | { kind: "move"; to: GenerationStatus; patch: LifecyclePatch; leaseAsSeen?: true }
  | { kind: "wait"; afterS: number; reason: Reason; maybeAccepted: boolean }
  | { kind: "none" };

/**
 * The whole transition table. Pure.
 *   terminal + anything                → none
 *   pending + submit accepted(id)      → move queued     { requestId, nextCheckAt now() in the database, reason null }
 *   pending + submit deferred(s)       → wait clamp(s, 5, 300) with the reason, maybe accepted unless it was a 429
 *   pending + submit rejected(reason)  → move failed     { reason, completedAt, costUsd 0 }
 *   pending maybe accepted + cancel    → none, so the caller sends it again and learns whether a job exists
 *   pending maybe accepted + clock     → none, likewise
 *   pending + clock late (DB clock)    → move failed     { reason submitDeadline, completedAt, costUsd 0 }
 *   pending maybe accepted + no key    → wait 60 s with the reason noKey, until the deadline (DB clock)
 *   pending + no key                   → move failed     { reason noKey, completedAt, costUsd 0 }
 *   live + running(s)                  → move s, only when s ranks above the row
 *   live + completed(url)              → move completed  { resultUrl, expiresAt, completedAt }, cost_usd keeps the quote
 *   live + ended(s, reason)            → move s          { reason, expiresAt, completedAt, costUsd 0 }
 *   live + missing                     → move failed     { reason providerRequestMissing, completedAt, costUsd 0 }
 *   live + cancel                      → move canceled   { completedAt, costUsd 0 }
 */
function decide(gen: Generation, obs: Observation, ctx: { now: Date }): Step {
  if (!isLive(gen.status)) return { kind: "none" };
  const end = (to: GenerationStatus, patch: LifecyclePatch): Step => ({
    kind: "move",
    to,
    patch: { completedAt: ctx.now, ...(to !== "completed" && { costUsd: "0" }), ...patch },
  });
  if ((obs.source === "cancel" || obs.source === "clock") && gen.status === "pending" && gen.maybeAccepted) return { kind: "none" };
  if (obs.source === "cancel") return end("canceled", {});
  if (obs.source === "clock") return gen.status === "pending" && obs.late ? end("failed", { reason: SUBMIT_DEADLINE }) : { kind: "none" };
  if (obs.source === "noKey") {
    if (gen.status !== "pending") return { kind: "none" };
    if (gen.maybeAccepted && !obs.late) return { kind: "wait", afterS: NO_KEY_RETRY_S, reason: NO_KEY, maybeAccepted: true };
    return end("failed", { reason: NO_KEY });
  }
  if (obs.source === "submit") {
    const o = obs.outcome;
    if (gen.status !== "pending") return { kind: "none" };
    if (o.kind === "accepted") return { kind: "move", to: "queued", patch: { requestId: o.requestId, nextCheckAt: sql`now()`, reason: null } };
    if (o.kind === "rejected") return end("failed", { reason: o.reason });
    const afterS = Math.min(RESUBMIT_MAX_S, Math.max(RESUBMIT_MIN_S, o.retryAfterS));
    return { kind: "wait", afterS, reason: o.reason, maybeAccepted: o.cause !== "rate_limited" };
  }
  const s = obs.state;
  switch (s.kind) {
    case "running":
      return RANK[s.status] > RANK[gen.status] ? { kind: "move", to: s.status, patch: {} } : { kind: "none" };
    case "completed":
      return end("completed", { resultUrl: s.videoUrl, expiresAt: s.expiresAt, reason: null });
    case "ended":
      return end(s.status, { reason: s.reason, expiresAt: s.expiresAt });
    case "missing":
      return end("failed", { reason: appError("providerRequestMissing") });
  }
}

/**
 * Writes a step. A move is the only statement that changes generations.status after insert. It matches only while the
 * row still ranks below the target, so a stale or repeated observation updates zero rows.
 * Zero rows means another caller already moved the row at least this far; the row is reread. Only the caller that
 * moved the row schedules the terminal follow-up. A wait touches only a pending row's clock and reason, and sets
 * maybe_accepted when the answer was lost.
 */
async function apply(gen: Generation, step: Step, schedule: Scheduler): Promise<Generation> {
  if (step.kind === "none") return gen;
  const g = schema.generations;
  if (step.kind === "wait") {
    const [waiting] = await getDb()
      .update(g)
      .set({
        nextCheckAt: sql`now() + make_interval(secs => ${step.afterS})`,
        ...reasonColumns(step.reason),
        ...(step.maybeAccepted && { maybeAccepted: true }),
      })
      .where(and(eq(g.id, gen.id), eq(g.status, "pending")))
      .returning();
    return waiting ?? current(gen);
  }
  const asSeen = step.leaseAsSeen ? and(eq(g.maybeAccepted, gen.maybeAccepted), lte(g.nextCheckAt, sql`now()`)) : undefined;
  const { reason, ...patch } = step.patch;
  const [row] = await getDb()
    .update(g)
    .set({ status: step.to, ...patch, ...(reason !== undefined && reasonColumns(reason)) })
    .where(and(eq(g.id, gen.id), inArray(g.status, predecessorsOf(step.to)), asSeen))
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

/** A visit does every step the row allows now: send a due pending row, then check a live one. An OpenAI row only ever finalizes. */
async function settleAs(gen: Generation, reason: SettleReason, schedule: Scheduler): Promise<Visit> {
  if (isOpenAiRow(gen)) return { row: await settleImage(gen, schedule), submit: "none", check: "none" };
  const submitted = await resubmit(gen, schedule);
  const checked = await refresh(submitted.row, POLICY[reason], schedule);
  return { row: checked.row, submit: submitted.call, check: checked.call };
}

/**
 * One call to Higgsfield, from this caller's side. `answered`: Higgsfield answered (a submit accepted or refused, or a
 * status). `unavailable`: this caller asked and got no usable answer (a deferred submit, a failed status call).
 * `none`: nothing to ask, no key, the deadline passed, or another caller holds the claim.
 */
type Call = "answered" | "unavailable" | "none";

/** What one submit or one refresh did, with the row as this caller now knows it. */
type Look = { row: Generation; call: Call };

/** What one visit did: the submit of a pending row, then the status check. */
type Visit = { row: Generation; submit: Call; check: Call };

/**
 * Send a pending row again, but only if this caller wins its submit claim. A cancel claims it even while it waits out
 * a deferral. The claimant stops the row instead (canceled for a cancel, failed past the deadline) only when Higgsfield
 * cannot hold a job for it, which is safe only because the claim proves no other submit of this row is in flight.
 * A row Higgsfield may have accepted is sent, because only the answer to the same key tells whether a job exists. If
 * the owner has no key (an admin removed it), that row waits for one until the deadline, and any other row fails.
 */
async function resubmit(gen: Generation, schedule: Scheduler, intent: "send" | "cancel" = "send"): Promise<Look> {
  if (gen.status !== "pending") return { row: gen, call: "none" };
  const claim = await claimSubmit(gen.id, intent === "cancel" ? notSubmitting() : submitDue());
  if (!claim) return { row: gen, call: "none" };
  const obs: Observation = intent === "cancel" ? { source: "cancel" } : { source: "clock", late: claim.late };
  const stop = decide(claim.row, obs, { now: new Date() });
  if (stop.kind !== "none") return { row: await apply(claim.row, stop, schedule), call: "none" };
  const key = await ownerKey(claim.row.userId);
  if (key) return send(claim.row, key, schedule);
  console.warn(JSON.stringify({ evt: "submit_skipped", id: claim.row.id, reason: "owner has no api key", maybeAccepted: claim.row.maybeAccepted }));
  const step = decide(claim.row, { source: "noKey", late: claim.late }, { now: new Date() });
  return { row: await apply(claim.row, step, schedule), call: "none" };
}

/**
 * One submit attempt for a row whose submit lease this caller holds. Idempotency-Key is the row id, and the endpoint
 * and body are the ones stored at insert, so every attempt is the same request and Higgsfield returns the original
 * request id for one it already accepted. A changed body gets 422, which fails the row.
 */
async function send(gen: Generation, key: hf.ApiKey, schedule: Scheduler): Promise<Look> {
  const outcome = await submitRow(gen, key);
  const detail = outcome.kind === "deferred" || outcome.kind === "rejected" ? outcome.reason : undefined;
  console.info(JSON.stringify({ evt: "generation_submit", id: gen.id, outcome: outcome.kind, detail }));
  const row = await apply(gen, decide(gen, { source: "submit", outcome }, { now: new Date() }), schedule);
  if (outcome.kind === "accepted" && row.requestId !== outcome.requestId) {
    console.warn(JSON.stringify({ evt: "submit_unrecorded", id: gen.id, requestId: outcome.requestId, status: row.status }));
  }
  return { row, call: outcome.kind === "deferred" ? "unavailable" : "answered" };
}

async function submitRow(gen: Generation, key: hf.ApiKey): Promise<hf.SubmitOutcome> {
  const request = resendRequest(gen);
  if (!request) return { kind: "rejected", reason: appError("noRequestBody", { model: gen.modelId }) };
  return hf.submit(key, request.endpoint, request.body, { idempotencyKey: gen.id, webhookUrl: hookUrl(gen.id) });
}

/** Ask Higgsfield about a live row, but only if this caller wins the row's check claim. Pending rows have nothing to ask. */
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
  const row = await apply(gen, decide(gen, { source: "status", state }, { now: new Date() }), schedule);
  return { row, call: "answered" };
}

/** A live row Higgsfield can be asked about. Mock rows carry no request id and are never asked. */
function checkable() {
  const g = schema.generations;
  return and(inArray(g.status, LIVE_STATUSES), isNotNull(g.requestId));
}

/** A pending row nobody is submitting and whose deferral has run out. The submit claim and the sweep read this rule. */
function submitDue() {
  const g = schema.generations;
  return and(eq(g.status, "pending"), lte(g.nextCheckAt, sql`now()`));
}

/**
 * A pending row nobody holds the submit lease of: its clock ran out, or it is waiting out a deferral, which records a
 * reason. A claim clears the reason, so a clock ahead with no reason means a submit is in flight. The cancel claim
 * reads this rule.
 */
function notSubmitting() {
  const g = schema.generations;
  return and(eq(g.status, "pending"), or(lte(g.nextCheckAt, sql`now()`), hasReason()));
}

/** A checkable row nobody claimed a check for within the last FORCED_CHECK_FLOOR_S. */
function forcedCheckDue() {
  const floor = sql`now() + make_interval(secs => ${CHECK_GAP_S - FORCED_CHECK_FLOOR_S})`;
  return and(checkable(), lte(schema.generations.nextCheckAt, floor));
}

/** A checkable row whose check clock has run out. The unforced check claim and the sweep read the same rule. */
function checkDue() {
  return and(checkable(), lte(schema.generations.nextCheckAt, sql`now()`));
}

/**
 * A completed Higgsfield result that is unstored, unexpired, and whose copy lease has run out. The copy claim and the
 * sweep read the same rule. Mock rows carry no request id and are never copied.
 */
function copyDue() {
  const g = schema.generations;
  return and(
    eq(g.status, "completed"),
    isNotNull(g.requestId),
    isNotNull(g.resultUrl),
    isNull(g.storagePath),
    or(isNull(g.mirrorNextAt), lte(g.mirrorNextAt, sql`now()`)),
    or(isNull(g.expiresAt), gt(g.expiresAt, sql`now()`)),
  );
}

/** Due rows this sweep has not visited, oldest first. Copies are due only while storage is configured. */
async function dueRows(visited: string[]): Promise<Generation[]> {
  const g = schema.generations;
  return getDb()
    .select()
    .from(g)
    .where(
      and(
        or(submitDue(), checkDue(), imageLeaseDue(), storage.storageEnabled() ? copyDue() : undefined),
        visited.length > 0 ? notInArray(g.id, visited) : undefined,
      ),
    )
    .orderBy(g.createdAt)
    .limit(SWEEP_PAGE);
}

/**
 * One sweep step: send a pending row, check a live row and await its copy, or copy a completed one. Counts into
 * `report`, never throws.
 */
async function visit(row: Generation, report: SweepReport): Promise<void> {
  try {
    let settled: Generation;
    if (isLive(row.status)) {
      const tasks: Promise<void>[] = [];
      const seen = await settleAs(row, "sweep", (task) => void tasks.push(task()));
      if (seen.submit === "answered") report.submitted++;
      if (seen.check === "answered") report.checked++;
      report.failures += [seen.submit, seen.check].filter((c) => c === "unavailable").length;
      if (seen.row.status !== row.status) report.moved++;
      await Promise.all(tasks);
      settled = tasks.length > 0 ? await current(seen.row) : seen.row;
    } else {
      settled = await storeVideo(row);
    }
    if (settled.storagePath && !row.storagePath) report.stored++;
    else if (settled.mirrorError && settled.mirrorAttempts > row.mirrorAttempts) report.failures++;
  } catch (e) {
    report.failures++;
    console.warn(JSON.stringify({ evt: "sweep_failed", id: row.id, error: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * The submit claim: push next_check_at SUBMIT_LEASE_S ahead and clear the last deferral reason, which marks the row as
 * being submitted. It matches only a row `rule` accepts (submitDue, or notSubmitting for a cancel), so of any number of
 * concurrent callers exactly one gets it. A row with no reason to clear had a submitter that died holding the lease,
 * after a send Higgsfield may have accepted, so the claim marks it maybe accepted. `late` is the submit deadline read on
 * the database's clock, the one that wrote created_at.
 */
async function claimSubmit(id: string, rule: SQL | undefined): Promise<{ row: Generation; late: boolean } | null> {
  const g = schema.generations;
  const [claimed] = await getDb()
    .update(g)
    .set({
      nextCheckAt: sql`now() + make_interval(secs => ${SUBMIT_LEASE_S})`,
      ...reasonColumns(null),
      maybeAccepted: sql`${g.maybeAccepted} or not ${hasReason()}`,
    })
    .where(and(eq(g.id, id), rule))
    .returning({ ...getTableColumns(g), late: sql<boolean>`${g.createdAt} <= now() - make_interval(mins => ${SUBMIT_DEADLINE_MIN})` });
  if (!claimed) return null;
  const { late, ...row } = claimed;
  return { row, late };
}

/**
 * Push next_check_at CHECK_GAP_S ahead. Unforced, it matches only when the row is due, so of any number of concurrent
 * callers exactly one wins per gap. Forced (the hook, or a cancel Higgsfield refused) it skips the gap but not the
 * floor: next_check_at more than CHECK_GAP_S - FORCED_CHECK_FLOOR_S ahead means a check was claimed within the last
 * FORCED_CHECK_FLOOR_S, so duplicated or replayed webhooks for a live row make at most one status call per second.
 */
async function claimCheck(id: string, force: boolean): Promise<boolean> {
  const g = schema.generations;
  const claimed = await getDb()
    .update(g)
    .set({ nextCheckAt: sql`now() + make_interval(secs => ${CHECK_GAP_S})` })
    .where(and(eq(g.id, id), force ? forcedCheckDue() : checkDue()))
    .returning({ id: g.id });
  return claimed.length > 0;
}

/**
 * The copy claim. It matches only a row that copyDue accepts, counts the attempt, and pushes the lease
 * max(MIRROR_LEASE_S, 60·2^attempts, capped at 6 h) ahead. Of any number of concurrent callers exactly one gets the
 * row back.
 */
async function claimCopy(id: string): Promise<Generation | null> {
  const g = schema.generations;
  const backoff = sql.raw(`greatest(${MIRROR_LEASE_S}, least(60 * power(2, mirror_attempts), ${MIRROR_BACKOFF_CAP_S}))`);
  const [row] = await getDb()
    .update(g)
    .set({ mirrorAttempts: sql`${g.mirrorAttempts} + 1`, mirrorNextAt: sql`now() + make_interval(secs => ${backoff})` })
    .where(and(eq(g.id, id), copyDue()))
    .returning();
  return row ?? null;
}

/**
 * An OpenAI image row. OpenAI answers one synchronous request with the image and keeps nothing to ask about later, and
 * documents no idempotency key, so a request sent twice may be billed twice. The row therefore has exactly one caller
 * of OpenAI, the runner this function schedules, and nothing ever sends it again:
 *   inserted   in_progress, maybe_accepted false (unsent), lease = start grace
 *   claimed    the runner flips maybe_accepted to true (sent) with the call lease, then sends
 *   answered   stored at images/<id>.<ext> and completed, or ended by what OpenAI said
 *   abandoned  after the lease, any poll or sweep ends it from the row and Blob alone (settleImage)
 */
async function startImage(user: User, plan: ReadyPlan, schedule: Scheduler): Promise<Generation> {
  const deadline = Date.now() + IMAGE_TIMING.runBudgetMs;
  const blocked = unavailableFor(plan.family, user);
  const key = openai.serverKey();
  if (blocked) throw HttpError.of(blocked.status, blocked.error);
  if (!key) throw new HttpError(503, "noOpenAiKey");
  const [row] = await getDb()
    .insert(schema.generations)
    .values({
      userId: user.id,
      modelId: plan.endpoint,
      prompt: plan.prompt,
      params: plan.params,
      requestBody: withSafetyIdentifier(plan.body, user.id),
      imageRefs: [...plan.imageUrls],
      videoRefs: [],
      status: "in_progress",
      maybeAccepted: false,
      nextCheckAt: sql`now() + make_interval(secs => ${IMAGE_TIMING.startGraceS})`,
      durationS: 0,
      costUsd: plan.costUsd.toFixed(4),
    })
    .returning();
  schedule(() => runImage(row, plan, key, deadline));
  return row;
}

/** OpenAI's per-member safety identifier, appended last, so abuse counts against one member instead of the shared key. */
function withSafetyIdentifier(body: WireBody, userId: number): WireBody {
  return JSON.stringify({ ...JSON.parse(body), safety_identifier: signToken("openai-safety", String(userId)) }) as WireBody;
}

/**
 * The only caller of OpenAI for a row, run once by the POST that inserted it. It sends only after winning the claim,
 * which a row grants once. Never throws: a row it could not end is ended by the lease.
 */
async function runImage(row: Generation, plan: ReadyPlan, key: openai.OpenAiKey, deadline: number): Promise<void> {
  try {
    const claimed = await claimImageCall(row.id);
    if (!claimed?.requestBody) {
      console.warn(JSON.stringify({ evt: "image_claim_lost", id: row.id }));
      return;
    }
    const started = Date.now();
    const format = imageFormatOf(claimed);
    const op = describeModel(claimed.modelId).mode === "r2i" ? "edits" : "generations";
    const { outcome, attempts } = await callWithinBudget(key, op, claimed.requestBody, format, deadline);
    const priced = (usage: TokenUsage | null) => (usage ? costUsd({ ...plan.costBasis, usage }, plan.rateUsd) : null);
    const obs: ImageObservation =
      outcome.kind === "image"
        ? await keepImage(claimed.id, outcome.bytes, format, priced(outcome.usage), deadline)
        : { source: "call", outcome, actualUsd: outcome.kind === "unknown" ? priced(outcome.usage) : null };
    const usage = outcome.kind === "image" || outcome.kind === "unknown" ? outcome.usage : null;
    const detail = outcome.kind === "refused" ? outcome.detail : outcome.kind === "unknown" ? outcome.why : outcome.kind === "rejected" ? outcome.reason : undefined;
    console.info(JSON.stringify({ evt: "image_call", id: claimed.id, op, outcome: outcome.kind, observed: obs.source, attempts, ms: Date.now() - started, usage, detail }));
    await apply(claimed, decideImage(claimed, obs, { now: new Date() }), () => {});
  } catch (e) {
    console.warn(JSON.stringify({ evt: "image_run_failed", id: row.id, error: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * The claim: maybe_accepted false → true, pushing the lease to IMAGE_TIMING.callLeaseS. It matches only an unsent
 * in_progress row, and nothing sets maybe_accepted back, so of any number of callers at most one ever wins it.
 */
async function claimImageCall(id: string): Promise<Generation | null> {
  const g = schema.generations;
  const [row] = await getDb()
    .update(g)
    .set({ maybeAccepted: true, nextCheckAt: sql`now() + make_interval(secs => ${IMAGE_TIMING.callLeaseS})` })
    .where(and(eq(g.id, id), eq(g.status, "in_progress"), eq(g.maybeAccepted, false)))
    .returning();
  return row ?? null;
}

/**
 * One send, and another only after OpenAI said it turned the request away before any work (a rate-limit 429 or an
 * overloaded 503), while a whole call still fits the budget. Every attempt sends the same stored bytes.
 */
async function callWithinBudget(
  key: openai.OpenAiKey,
  op: openai.ImageOp,
  body: WireBody,
  format: ImageFormat,
  deadline: number,
): Promise<{ outcome: openai.ImageOutcome; attempts: number }> {
  for (let attempts = 1; ; attempts++) {
    const timeoutMs = Math.min(IMAGE_TIMING.callTimeoutMs, deadline - Date.now() - IMAGE_TIMING.storeReserveMs);
    const outcome = await openai.createImage(key, op, body, { timeoutMs, format });
    if (outcome.kind !== "refused") return { outcome, attempts };
    const waitMs = Math.min(20, Math.max(1, outcome.retryAfterS)) * 1000;
    if (deadline - Date.now() - waitMs - IMAGE_TIMING.storeReserveMs < IMAGE_TIMING.minResendCallMs) return { outcome, attempts };
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** At most two puts inside the budget. The key is fixed by the row, so a repeat writes the same bytes to the same key. */
async function keepImage(id: string, bytes: Uint8Array, format: ImageFormat, actualUsd: number | null, deadline: number): Promise<ImageObservation> {
  const key = storage.imageKey(id, format);
  let detail: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ms = Math.min(IMAGE_TIMING.storeAttemptMs, deadline - Date.now());
    if (ms <= 0) break;
    try {
      await storage.putImage(key, bytes, format, { abortSignal: AbortSignal.timeout(ms) });
      return { source: "kept", key, bytes: bytes.byteLength, actualUsd };
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
  }
  const reason = detail === null ? appError("imageNotKept", { cause: "noTime" }) : appError("imageNotKept", { cause: "store", detail });
  return { source: "lost", reason, actualUsd };
}

/** What a caller learned about an image row. `actualUsd` is OpenAI's usage priced at the plan's rate, when it reported usage. */
type ImageObservation =
  | { source: "call"; outcome: Exclude<openai.ImageOutcome, { kind: "image" }>; actualUsd: number | null }
  | { source: "kept"; key: storage.ObjectKey; bytes: number; actualUsd: number | null }
  | { source: "lost"; reason: AppError; actualUsd: number | null }
  | { source: "lease"; kept: { key: storage.ObjectKey; bytes: number } | null };

/**
 * The image transition table. Pure. A patch without costUsd keeps the estimate written at insert.
 *   terminal + anything                → none
 *   call refused (no budget left)      → failed     { imageRefused, costUsd 0 }           turned away before any work
 *   call rejected moderation           → nsfw       { reason, costUsd 0 }
 *   call rejected key|quota|request    → failed     { reason, costUsd 0 }
 *   call unknown                       → failed     { imageUnanswered, costUsd usage ?? estimate }   maybe billed
 *   kept                               → completed  { storagePath, sizeBytes, costUsd usage ?? estimate }
 *   lost (stored nowhere)              → failed     { imageNotKept, costUsd usage ?? estimate }   billed, bytes gone
 *   lease, unsent                      → failed     { imageNeverSent, costUsd 0 }          as seen
 *   lease, sent, image in Blob         → completed  { storagePath, sizeBytes }, estimate   as seen
 *   lease, sent, nothing in Blob       → failed     { imageRunnerDied }, estimate          as seen
 * Every end sets completedAt.
 */
function decideImage(gen: Generation, obs: ImageObservation, ctx: { now: Date }): Step {
  if (!isLive(gen.status)) return { kind: "none" };
  const end = (to: GenerationStatus, patch: LifecyclePatch): Step => ({ kind: "move", to, patch: { completedAt: ctx.now, ...patch } });
  const billed = (usd: number | null) => (usd === null ? {} : { costUsd: usd.toFixed(4) });
  switch (obs.source) {
    case "kept":
      return end("completed", { storagePath: obs.key, sizeBytes: obs.bytes, reason: null, ...billed(obs.actualUsd) });
    case "lost":
      return end("failed", { reason: obs.reason, ...billed(obs.actualUsd) });
    case "call": {
      const o = obs.outcome;
      if (o.kind === "refused") return end("failed", { reason: appError("imageRefused", { detail: o.detail }), costUsd: "0" });
      if (o.kind === "rejected") return end(o.cause === "moderation" ? "nsfw" : "failed", { reason: o.reason, costUsd: "0" });
      return end("failed", { reason: appError("imageUnanswered", o.why), ...billed(obs.actualUsd) });
    }
    case "lease": {
      const step = !gen.maybeAccepted
        ? end("failed", { reason: appError("imageNeverSent"), costUsd: "0" })
        : obs.kept
          ? end("completed", { storagePath: obs.kept.key, sizeBytes: obs.kept.bytes, reason: null })
          : end("failed", { reason: appError("imageRunnerDied") });
      return step.kind === "move" ? { ...step, leaseAsSeen: true } : step;
    }
  }
}

/**
 * What a poll, the hook route or the sweep does with an image row: nothing while its lease runs, and never a call to
 * OpenAI. After the lease, a sent row first asks Blob whether its runner stored the image before dying (or before its
 * last write failed). A Blob that does not answer leaves the row for the next visit.
 */
async function settleImage(gen: Generation, schedule: Scheduler): Promise<Generation> {
  if (!isLive(gen.status) || gen.nextCheckAt.getTime() > Date.now()) return gen;
  let kept: { key: storage.ObjectKey; bytes: number } | null = null;
  if (gen.maybeAccepted) {
    const key = storage.imageKey(gen.id, imageFormatOf(gen));
    try {
      const bytes = await storage.storedSize(key);
      kept = bytes === null ? null : { key, bytes };
    } catch (e) {
      console.warn(JSON.stringify({ evt: "image_lease_check_failed", id: gen.id, error: e instanceof Error ? e.message : String(e) }));
      return gen;
    }
  }
  return apply(gen, decideImage(gen, { source: "lease", kept }, { now: new Date() }), schedule);
}

/** A live OpenAI row whose lease ran out. The sweep reads it beside submitDue and checkDue. */
function imageLeaseDue() {
  const g = schema.generations;
  return and(inArray(g.modelId, endpointsOfProvider("openai")), inArray(g.status, LIVE_STATUSES), lte(g.nextCheckAt, sql`now()`));
}

function isOpenAiRow(gen: Generation): boolean {
  return describeModel(gen.modelId).provider === "openai";
}

/** The output_format the row asked for, which is the stored file's format. */
function imageFormatOf(gen: Generation): ImageFormat {
  const f = gen.params.output_format;
  return f === "jpeg" || f === "webp" ? f : "png";
}

/**
 * Runs once per terminal move, by the caller that made it: ref cleanup, then the copy for a completed row. An OpenAI
 * row was stored before it moved, and its references, all in Blob, stay for the drawer's next attempt with them.
 */
async function onTerminal(row: Generation): Promise<void> {
  if (isOpenAiRow(row)) return;
  await cleanupRefs(row);
  if (row.status === "completed") await storeVideo(row);
}

/**
 * Delete the owner's temporary reference uploads from Vercel Blob once the request is finished. A ref can be any URL
 * the browser sent, including a stored video or another member's upload, so storage.deleteRefs deletes only what sits
 * under the row owner's refs/<user id>/.
 */
async function cleanupRefs(gen: Generation) {
  try {
    await storage.deleteRefs([...gen.imageRefs, ...gen.videoRefs], gen.userId);
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
