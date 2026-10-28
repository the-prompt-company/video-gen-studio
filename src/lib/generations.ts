import { and, eq, getTableColumns, gt, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { buildArguments, findModel, type ModelSpec } from "@/lib/catalog";
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
/** A forced check (a webhook, a refused cancel) skips the gap but not this floor, so replayed hooks share one call. */
const FORCED_CHECK_FLOOR_S = 1;
/** A submit claim holds this long, longer than the 20 s submit timeout, so an expired lease means the submitter died. */
const SUBMIT_LEASE_S = 30;
/** Higgsfield's Retry-After, clamped, is how long a deferred submit waits before anyone sends it again. */
const RESUBMIT_MIN_S = 5;
const RESUBMIT_MAX_S = 300;
/** The operator's call: a pending row older than this fails instead of starting a paid generation nobody expects now. */
const SUBMIT_DEADLINE_MIN = 30;
const SUBMIT_DEADLINE_ERROR = `Higgsfield가 ${SUBMIT_DEADLINE_MIN}분 동안 요청을 받지 않았습니다`;
/** A copy claim holds at least this long, longer than the 300 s maxDuration of every route that copies. */
const MIRROR_LEASE_S = 360;
const MIRROR_BACKOFF_CAP_S = 6 * 3600;
const COPY_TIMEOUT_MS = 240_000;
const MAX_COPY_BYTES = 1024 ** 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY = "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요";
const SUBMITTING = "제출 중입니다. 몇 초 뒤 다시 취소하세요";

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

/**
 * Insert the row as pending, holding its submit lease, then submit once. Returns it queued (accepted), failed
 * (rejected), or still pending (deferred by a 429, 5xx, network error or timeout). A pending row is sent again by the
 * next poll, webhook or sweep, with the same Idempotency-Key and the same body.
 */
export async function submitGeneration(user: User, req: GenerationRequest, schedule: Scheduler): Promise<Generation> {
  const { spec, prompt, params, imageUrls, videoUrls } = req;
  const key = apiKeyFor(user);
  try {
    buildArguments(spec, prompt, params, imageUrls, videoUrls);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  const [row] = await getDb()
    .insert(schema.generations)
    .values({
      userId: user.id,
      modelId: spec.id,
      prompt,
      params,
      imageRefs: imageUrls,
      videoRefs: videoUrls,
      status: "pending",
      nextCheckAt: sql`now() + make_interval(secs => ${SUBMIT_LEASE_S})`,
      durationS: Number(params[spec.durationKey] ?? 0),
      costUsd: "0",
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
 * row (a submit is in flight) or whose resend gets no answer answers 409 and works a few seconds later.
 */
export async function cancelGeneration(gen: Generation, schedule: Scheduler): Promise<Generation> {
  if (gen.status === "pending") {
    const tried = (await resubmit(gen, schedule, "cancel")).row;
    const row = tried.status === "pending" ? await current(gen) : tried;
    if (row.status === "pending") throw new HttpError(409, SUBMITTING);
    return row.status === "queued" ? cancelGeneration(row, schedule) : row;
  }
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

/**
 * Stored once the copy landed and storage is still configured. Provider until then, or for good when storage is off
 * or the row has no request id (a mock row, which is never copied).
 */
function publicVideo(g: Generation): PublicVideo | null {
  if (g.status !== "completed") return null;
  const stored = g.storagePath && storage.videoUrls(g.storagePath, `${g.id}.mp4`);
  if (stored) return { kind: "stored", ...stored };
  if (!g.resultUrl) return null;
  const unexpired = g.expiresAt === null || g.expiresAt.getTime() > Date.now();
  const storing = storage.storageEnabled() && unexpired && g.requestId !== null;
  return { kind: "provider", url: g.resultUrl, downloadUrl: g.resultUrl, expiresAt: g.expiresAt, storing };
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
  Pick<typeof schema.generations.$inferInsert, "requestId" | "resultUrl" | "expiresAt" | "completedAt" | "costUsd" | "error">
> & { nextCheckAt?: SQL };

/**
 * What a caller learned: a submit answer, a status answer, a user's cancel, or the clock, which the submit claim reads
 * on the database's clock (`late` means past the submit deadline).
 */
type Observation =
  | { source: "submit"; outcome: hf.SubmitOutcome }
  | { source: "status"; state: hf.ProviderState }
  | { source: "cancel" }
  | { source: "clock"; late: boolean };

/**
 * `wait` keeps a pending row pending, records why, and lets nobody send it again for `afterS`. `maybeAccepted` says the
 * answer was lost, so Higgsfield may hold a job for the row's key.
 */
type Step =
  | { kind: "move"; to: GenerationStatus; patch: LifecyclePatch }
  | { kind: "wait"; afterS: number; reason: string; maybeAccepted: boolean }
  | { kind: "none" };

/**
 * The whole transition table. Pure.
 *   terminal + anything                → none
 *   pending + submit accepted(id)      → move queued     { requestId, nextCheckAt now() in the database, error null }
 *   pending + submit deferred(s)       → wait clamp(s, 5, 300) with the reason, maybe accepted unless it was a 429
 *   pending + submit rejected(error)   → move failed     { error, completedAt, costUsd 0 }
 *   pending maybe accepted + cancel    → none, so the caller sends it again and learns whether a job exists
 *   pending maybe accepted + clock     → none, likewise
 *   pending + clock late (DB clock)    → move failed     { error "Higgsfield가 30분 동안…", completedAt, costUsd 0 }
 *   live + running(s)                  → move s, only when s ranks above the row
 *   live + completed(url)              → move completed  { resultUrl, expiresAt, completedAt, costUsd = price × durationS }
 *   live + ended(s, error)             → move s          { error, expiresAt, completedAt, costUsd 0 }
 *   live + missing                     → move failed     { error "request not found", completedAt, costUsd 0 }
 *   live + cancel                      → move canceled   { completedAt, costUsd 0 }
 */
function decide(gen: Generation, obs: Observation, ctx: { now: Date; pricePerSecUsd: number }): Step {
  if (!isLive(gen.status)) return { kind: "none" };
  const end = (to: GenerationStatus, patch: LifecyclePatch): Step => ({
    kind: "move",
    to,
    patch: { completedAt: ctx.now, costUsd: "0", ...patch },
  });
  if ((obs.source === "cancel" || obs.source === "clock") && gen.status === "pending" && gen.maybeAccepted) return { kind: "none" };
  if (obs.source === "cancel") return end("canceled", {});
  if (obs.source === "clock") return gen.status === "pending" && obs.late ? end("failed", { error: SUBMIT_DEADLINE_ERROR }) : { kind: "none" };
  if (obs.source === "submit") {
    const o = obs.outcome;
    if (gen.status !== "pending") return { kind: "none" };
    if (o.kind === "accepted") return { kind: "move", to: "queued", patch: { requestId: o.requestId, nextCheckAt: sql`now()`, error: null } };
    if (o.kind === "rejected") return end("failed", { error: o.error });
    const afterS = Math.min(RESUBMIT_MAX_S, Math.max(RESUBMIT_MIN_S, o.retryAfterS));
    return { kind: "wait", afterS, reason: o.detail, maybeAccepted: o.cause !== "rate_limited" };
  }
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
        error: step.reason,
        ...(step.maybeAccepted && { maybeAccepted: true }),
      })
      .where(and(eq(g.id, gen.id), eq(g.status, "pending")))
      .returning();
    return waiting ?? current(gen);
  }
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

/** A visit does every step the row allows now: send a due pending row, then check a live one. */
async function settleAs(gen: Generation, reason: SettleReason, schedule: Scheduler): Promise<Visit> {
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
 * A row Higgsfield may have accepted is sent, because only the answer to the same key tells whether a job exists.
 */
async function resubmit(gen: Generation, schedule: Scheduler, intent: "send" | "cancel" = "send"): Promise<Look> {
  if (gen.status !== "pending") return { row: gen, call: "none" };
  const claim = await claimSubmit(gen.id, intent === "cancel" ? notSubmitting() : submitDue());
  if (!claim) return { row: gen, call: "none" };
  const obs: Observation = intent === "cancel" ? { source: "cancel" } : { source: "clock", late: claim.late };
  const stop = decide(claim.row, obs, { now: new Date(), pricePerSecUsd: 0 });
  if (stop.kind !== "none") return { row: await apply(claim.row, stop, schedule), call: "none" };
  return send(claim.row, await ownerKey(claim.row.userId), schedule);
}

/**
 * One submit attempt for a row whose submit lease this caller holds. Idempotency-Key is the row id and the body is
 * rebuilt from the stored row, so every attempt is the same request and Higgsfield returns the original request id
 * for one it already accepted. A changed body gets 422, which fails the row.
 */
async function send(gen: Generation, key: hf.ApiKey | null, schedule: Scheduler): Promise<Look> {
  const outcome: hf.SubmitOutcome = key ? await submitRow(gen, key) : { kind: "rejected", error: NO_KEY };
  const detail = outcome.kind === "deferred" ? outcome.detail : outcome.kind === "rejected" ? outcome.error : undefined;
  console.info(JSON.stringify({ evt: "generation_submit", id: gen.id, outcome: outcome.kind, detail }));
  const row = await apply(gen, decide(gen, { source: "submit", outcome }, { now: new Date(), pricePerSecUsd: 0 }), schedule);
  if (outcome.kind === "accepted" && row.requestId !== outcome.requestId) {
    console.warn(JSON.stringify({ evt: "submit_unrecorded", id: gen.id, requestId: outcome.requestId, status: row.status }));
  }
  return { row, call: outcome.kind === "deferred" ? "unavailable" : "answered" };
}

async function submitRow(gen: Generation, key: hf.ApiKey): Promise<hf.SubmitOutcome> {
  const spec = findModel(gen.modelId);
  if (!spec) return { kind: "rejected", error: `카탈로그에 없는 모델입니다: ${gen.modelId}` };
  let args: Record<string, unknown>;
  try {
    args = buildArguments(spec, gen.prompt, gen.params, gen.imageRefs, gen.videoRefs);
  } catch (e) {
    return { kind: "rejected", error: e instanceof Error ? e.message : String(e) };
  }
  return hf.submit(key, spec.id, args, { idempotencyKey: gen.id, webhookUrl: hookUrl(gen.id) });
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
  const pricePerSecUsd = state.kind === "completed" ? await priceFor(gen.modelId) : 0;
  const row = await apply(gen, decide(gen, { source: "status", state }, { now: new Date(), pricePerSecUsd }), schedule);
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
  return and(eq(g.status, "pending"), or(lte(g.nextCheckAt, sql`now()`), isNotNull(g.error)));
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
        or(submitDue(), checkDue(), storage.storageEnabled() ? copyDue() : undefined),
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
      error: null,
      maybeAccepted: sql`${g.maybeAccepted} or ${g.error} is null`,
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
