# Candidate 2. The row is the job: one reducer, three kickers

User goal, restated. Make the generation phase of Video Gen Studio work well on Vercel despite the 300 s function limit, survive a burst of ~300 generations from 20 users in a few hours, and decide whether Supabase is the right place to store and serve the resulting videos. The deliverable is a multi-phase plan with one section per PR. This file is one candidate design that plan can be written from.

## Problem

Today a generation's lifecycle is driven by exactly one actor, the owner's open browser tab. `GET /api/generations/:id` calls `syncStatus`, which does one Higgsfield status read and writes the row. Nothing else ever writes `status`, `resultUrl`, `costUsd` or `expiresAt`. Three consequences follow. A closed tab leaves rows in `queued`/`in_progress` indefinitely, so the dashboard under-counts cost until the owner comes back. Results live only 7 days at Higgsfield and nothing copies them. And the `blobUrl` column reserved for a mirror has no writer.

Premise check on constraint 1. "The generation call may exceed 300 s" does not bind this design. No function waits for a generation. Submit and each status read finish in seconds. The 300 s limit binds exactly one step, copying a finished result into our storage, which must complete inside one invocation. Everything else attributed to the 300 s constraint is really the absence of a server-side driver, which is what this design adds.

One more defect surfaced during grounding, inferred from code and not run. `Playground.tsx` line 384 maps live ids through `Number`, but ids are UUIDs, so the poller fetches `/api/generations/NaN`. In production no real key has been assigned, so this has never been observable. The design treats the client poll as one kicker among three, and PR 1 fixes it.

Constraints the design honors. Per-user Higgsfield keys stay (the server decrypts per request, so any server actor can act for any user). The `generations` row stays the only record of a generation. The existing status enum stays. The client polling loop stays for local development and as a kicker. Target Vercel Pro, degrade on Hobby.

## Usage (caller's view)

Every route becomes a thin kicker. The lifecycle module owns every write to a generation row. Callers never touch `status`, `resultUrl`, `mirrorUrl`, `costUsd` or `completedAt` directly.

```ts
// src/app/api/generations/route.ts  (POST)
import * as lifecycle from "@/lib/lifecycle";
const gen = await lifecycle.create({ user, spec, prompt, params, imageUrls, videoUrls });
return Response.json({ item: publicGeneration(gen), estimatedCostUsd }, { status: 201 });
```

```ts
// src/app/api/generations/[id]/route.ts  (GET, the client poll)
import { after } from "next/server";
let row = await ownRow(id, user.id, user.role);
if (row.userId === user.id) row = await lifecycle.advance(row, apiKeyFor(user), after);
return Response.json({ item: publicGeneration(row) });
```

```ts
// src/app/api/hooks/higgsfield/route.ts  (POST, Higgsfield's terminal-status webhook)
const { gen, user } = await lifecycle.lookupKick(url.searchParams.get("g"), url.searchParams.get("t")); // 401 on bad token
after(() => lifecycle.advance(gen, apiKeyFor(user), (t) => t()));
return new Response(null, { status: 200 });   // inside Higgsfield's 10 s deadline
```

```ts
// src/app/api/cron/drain/route.ts  (GET every minute on Pro, daily on Hobby)
const report = await lifecycle.drain({ budgetMs: 240_000, concurrency: 8 });
return Response.json(report);   // { checked, advanced, mirrored, failed, skipped }
```

What a caller learns from the interface. One function, `advance`, moves a row as far forward as the world allows right now, with at most one Higgsfield status read, and hands any slow follow-up (the mirror copy) to a scheduler the caller supplies. `drain` is `advance` over every row that is due. Running either twice, concurrently, or after a crash is safe. That is the whole contract.

## Shape

### Data structures first

The `generations` row is the job record and the state machine. There is no second table and no second store of lifecycle state. Three columns are added and one renamed.

```
status             queued | in_progress | completed | failed | nsfw | canceled   (unchanged enum)
request_id         null while "accepted by us, not yet by Higgsfield"           (now a legitimate transient)
checked_at         last moment any actor read Higgsfield status for this row    (poll claim token)
mirror_url         public URL of our copy, null until mirrored                   (renamed from blob_url)
mirror_lease_until a mirror copy is in flight until this time                    (mirror claim token)
mirror_attempts    count of mirror tries, cap 5
```

Rank the statuses `queued < in_progress < terminal`. Every status write is a forward-only compare-and-swap whose precondition lists the statuses of lower rank. A stale observation can never move a row backward, so a webhook and a poll racing with different views converge on the higher one, per **make-operations-idempotent**.

The two claim columns are what make the DB a work queue without a queue table. `checked_at` is claimed by `UPDATE ... SET checked_at = now() WHERE id = $1 AND status IN ('queued','in_progress') AND (checked_at IS NULL OR checked_at < now() - interval '2 seconds') RETURNING *`. Zero rows affected means another actor read Higgsfield in the last 2 s, so this actor returns the row as it stands without a Higgsfield call. `mirror_lease_until` is claimed the same way with a 6 minute horizon, longer than any invocation can live, so a crashed copy is recognizably stale by time alone, per **make-operations-idempotent** ("judge staleness by evidence that stays true wherever the previous run could have stopped"). This is **separate-before-serializing-shared-state** applied honestly. The row is a real single write target (one generation has one status), so serialization is structural, in the WHERE clause, not in convention.

### The reducer

`src/lib/lifecycle.ts` is the single owner of generation transitions. Its core is a pure planner and a pure patch builder, with the DB and Higgsfield calls in a thin shell, per **boundary-discipline**.

```
plan(gen, now, storageOn) →
  'fail-unsubmitted'  queued, request_id null, created_at < now - 10 min
  'check'             queued | in_progress, request_id set
  'mirror'            completed, result_url set, mirror_url null, attempts < 5, expires_at > now, storageOn
  'none'              otherwise
```

`advance(gen, apiKey, schedule)` runs `plan`, does the one step it names, and if that step produced `completed` with no mirror, schedules the mirror step through `schedule`. The route passes Next's `after`, so the client gets its JSON in milliseconds and the copy runs in the remainder of the invocation's 300 s. The cron passes an inline awaiter. The lifecycle module never imports `next/server`, so it is callable from scripts and tests.

### Three kickers, one path

| kicker | when | what it costs |
| --- | --- | --- |
| client poll `GET /:id` | tab open, 2 s to 10 s backoff | 1 status read per row per tick (coalesced across tabs by `checked_at`) |
| webhook `POST /api/hooks/higgsfield?g=<id>&t=<hmac>` | Higgsfield says terminal | 1 status read, then the mirror |
| cron `GET /api/cron/drain` | every minute on Pro | status reads only for rows not checked in 45 s (closed tabs), plus leftover mirrors |

The webhook is a kick, not a source of truth. Its body is ignored. The Higgsfield status endpoint, read with the owner's key, is the only authority. This sidesteps the per-account `whsec_` secret (20 users means 20 Higgsfield consoles to harvest) and leaves exactly one code path for all three kickers. The kick is authenticated by `t = HMAC-SHA256(AUTH_SECRET, generationId)[0..32]`, computed at submit time and embedded in the `hf_webhook` URL. No new column, no shared secret with Higgsfield. A forged kick without the token is a 401 (4xx, so Higgsfield will not retry). A replayed valid kick is bounded by the 2 s `checked_at` claim.

Webhook URLs are attached only when `VERCEL_ENV === "production"`, using `VERCEL_PROJECT_PRODUCTION_URL`. Preview deployments are behind deployment protection and would 401 the delivery, and localhost has no public URL. Both fall back to poll plus cron, which is today's behavior made reliable.

### Submit order changes

`create` inserts the row first (status `queued`, `request_id` null, `id` pre-generated), submits to Higgsfield with `Idempotency-Key = id` and the webhook URL, then writes `request_id`. If the submit fails, the row is marked `failed` with the Higgsfield message and the user sees it (a 429 still surfaces the retry hint, as today). If the function dies between submit and the `request_id` write, `plan` names `fail-unsubmitted` after 10 minutes and the row stops being live. The old order (submit then insert) could leave a charged generation with no row, which breaks the product's per-person cost promise silently. This order can only leave an uncharged row that says failed, which is visible. Per **redesign-from-first-principles**, this is also what makes the row id available for the webhook URL and makes "our own submission queue" a future `plan` branch instead of a new subsystem.

### The mirror step

```
claim lease (CAS)                        → 0 rows: someone else is copying, return
GET result_url                           → ArrayBuffer (≤ 150 MB guessed, 2 GB memory ceiling)
PUT storage/<id>.mp4, upsert             → same bytes land on the same key no matter who wins
UPDATE SET mirror_url = $url WHERE id = $1 AND mirror_url IS NULL
on error: UPDATE SET mirror_attempts = mirror_attempts + 1, mirror_lease_until = now() + 6 min * attempts
```

The whole step is one invocation and is the only place the 300 s limit is load-bearing. The lease horizon doubles as retry backoff. After 5 failures the row keeps its Higgsfield URL and the admin log shows `mirror_attempts = 5`, which is the signal to investigate before the 7 day expiry.

### What is encoded where

Types encode the forward-only rank table and the `Step` union. The DB encodes the claims (WHERE clauses) and the partial index for pending mirrors. `publicGeneration` derives, never syncs. `resultUrl` is `mirrorUrl ?? resultUrl` as today and `expiresAt` becomes null once `mirrorUrl` is set, so the gallery's "보관 N일 남음" disappears for mirrored rows without a second flag.

What the system deliberately does not do. No queue table or queue service. No webhook signature verification in v1. No workflow engine. No push channel to the browser. No retention or deletion of mirrored videos. No shared submission queue of our own.

Interface depth. The public surface is four functions (`create`, `advance`, `cancel`, `drain`) plus `lookupKick`. Behind them sit the claim protocol, the rank table, the cost rule, the mirror lease and retry policy, reference cleanup, and the Higgsfield status parsing. Callers see none of it. The `schedule` parameter is the one piece of policy pushed to the edge, because only the caller knows whether it is inside a request that must answer fast or a cron that can wait.

## Synthesis decision

(Left empty for arena.)

## Tradeoffs accepted

- We accept one extra Higgsfield status read per webhook delivery in exchange for not storing or verifying 20 per-account webhook secrets and having one code path for every kicker.
- We accept a 10 minute window in which a crashed-mid-submit row shows "대기" before turning failed, in exchange for never losing a charged generation from the accounting.
- We accept that a copy in flight when the function dies is retried only after a 6 minute lease, in exchange for never running two copies of the same row at once and never needing to inspect the storage bucket to decide.
- We accept buffering the whole result in memory (no streaming upload) in exchange for one code path with no TUS or multipart dependency. This looks like premature simplification. It is a 2 GB memory ceiling against a 150 MB guessed maximum, and the measurement script in PR 5 will say whether it holds.
- We accept that mirrored playback URLs change from Higgsfield CDN to Supabase Storage on the next page load after mirroring, not live, in exchange for the client stopping its poll at the first terminal status.
- We accept cron-driven closed-tab latency of up to 60 s on Pro (24 h on Hobby) when the webhook does not arrive, in exchange for correctness that does not depend on the one empirical question we cannot test now (webhook delivery).
- We accept moving all functions to `icn1` (inferred, not measured, that every query today crosses the Pacific to a Supabase project in `ap-northeast-2`) in exchange for the copy step and every DB query being in-region. If the inference is wrong the setting is a one-line revert.

## Alternatives considered

- **Durable workflow per generation (Vercel Workflows).** One `'use workflow'` function per generation that submits, sleeps or waits on a hook, then mirrors. Hides retries and sleeps well, but exposes a second runtime (queues), usage billing, a workflow dev server for local work, and a second place where lifecycle state lives next to the row. It also still needs the webhook and the same mirror step. Interface depth is good, but the surface it adds is a deployment unit, not a function. Lost on cost of ownership for a one-person operator and on split ownership of status.
- **Webhook + cron reconciler with a trusted, signed webhook payload.** The obvious shape. It differs from this design in trusting the payload (requires per-account secrets stored encrypted per user and revealed one by one in 20 consoles) and in having two write paths, the webhook writer and the reconciler. Lost on the split-ownership red flag and on operational setup that scales with headcount.
- **Pure client-driven, smarter reconcile on page load.** No cron, no webhook. Any page load drains every user's due rows. Cheapest surface. Lost because dashboard correctness and the 7 day mirror window would depend on who happens to be online, and a Monday-morning load would trigger 300 copies from one request. It survives inside this design as the Hobby degradation (daily cron is a scheduled page load).
- **Our own submission queue (hold rows, submit from drain).** Would absorb Higgsfield 429s invisibly. Higgsfield per-key limits are undocumented and the user-visible "N초 후 재시도" gives a clear next action. Deferred. The insert-first order makes it a one-branch addition to `plan` later (`request_id null` plus a `next_submit_at` column), not a redesign.
- **Push status to the browser via Supabase Realtime instead of polling.** Removes ~3 req/s of polling at peak. Adds the anon key, RLS on `generations`, and a second auth model to the browser. Polling at this scale is cheap (numbers below). Lost on surface added for load that does not exist.

## Open questions and risks

- Real result file sizes per model, resolution and duration. Everything in the storage arithmetic is a guess until `scripts/measure-copy.ts` runs with a real key.
- Does Higgsfield deliver `hf_webhook` to a Vercel production route reliably, and what is the per-key concurrency and queue depth? No key is assigned yet. The design does not depend on the answer for correctness, only for latency.
- Copy time for a 100 MB result from the Higgsfield CDN into Supabase Storage from `icn1` versus `iad1`. The 6 minute lease and the 300 s cap assume tens of seconds.
- Does a replayed `Idempotency-Key` return the same `request_id` at Higgsfield? Only matters if the own-queue branch is ever built.
- Is Vercel Pro confirmed? `PRODUCT.md` says Hobby was confirmed by the user and Pro is undecided, while the grounding targets Pro. This design works on both with the Hobby degradations listed in the PR split. The ToS question is the operator's to settle.
- Is a public bucket with unguessable `<uuid>.mp4` keys acceptable for internal team content, or should the gallery mint 1 hour signed URLs per render? Signed URLs cost one batched storage call per gallery page and remove the "anyone with the link" property.
- Is function outbound transfer (the download half of the copy) metered on Vercel Pro? Not verified. At 30 GB/month in the worst scenario it would be a line item, not a blocker.
- Retention. "Keep indefinitely" is the default taken. Who can delete, and does deleting a row delete the object?

## Next implementation step

Write `src/lib/lifecycle.ts` with `plan`, `statusPatch` and the three CAS statements as `not implemented` bodies, plus `scripts/hf-stub.ts`, a local fake Higgsfield that serves submit, status with scripted timings, cancel, and posts webhooks, so every later PR can be proven without a real key.

---

# Type sketch and signatures

## `src/lib/lifecycle.ts` (new, single owner of generation writes)

```ts
import type { Generation, User } from "@/db/schema";
import type { ModelSpec } from "@/lib/catalog";
import * as hf from "@/lib/higgsfield";

/** A caller-supplied way to run slow follow-up work after the fast part returns. */
export type Scheduler = (task: () => Promise<void>) => void;

export type Step = "fail-unsubmitted" | "check" | "mirror" | "none";

/** Forward-only rank. A status write's precondition is "current rank < new rank". */
const RANK = { queued: 0, in_progress: 1, completed: 2, failed: 2, nsfw: 2, canceled: 2 } as const;
export function allowedFrom(next: Generation["status"]): Generation["status"][] {
  throw new Error("not implemented"); // statuses with RANK strictly below RANK[next]
}

/** Pure. Decide the one thing this row needs right now. */
export function plan(gen: Generation, now: Date, storageOn: boolean): Step {
  throw new Error("not implemented");
  // queued && !requestId && createdAt < now-10min        → "fail-unsubmitted"
  // live && requestId                                     → "check"
  // completed && resultUrl && !mirrorUrl && mirrorAttempts < 5
  //   && (expiresAt == null || expiresAt > now) && storageOn → "mirror"
  // else                                                  → "none"
}

/** Pure. The patch a Higgsfield status observation implies for this row. Null when nothing changes. */
export function statusPatch(
  gen: Generation,
  s: hf.HfStatusResponse,
  pricePerSecUsd: number,
  now: Date,
): Partial<Generation> | null {
  throw new Error("not implemented");
  // same status → null
  // terminal: completedAt=now, error, expiresAt, resultUrl (completed only), costUsd = price*durationS (completed) else "0"
}

export type CreateInput = {
  user: User; spec: ModelSpec; prompt: string; params: Record<string, unknown>;
  imageUrls: string[]; videoUrls: string[];
};

/** Insert row (queued, request_id null) → submit with Idempotency-Key = id and hf_webhook → write request_id.
 *  On submit failure the row becomes failed with the Higgsfield message and the error is rethrown for the route. */
export async function create(input: CreateInput): Promise<Generation> {
  throw new Error("not implemented");
}

/** Move the row as far forward as the world allows, with at most one Higgsfield status read.
 *  Returns the row after the fast step. If the fast step reached completed without a mirror,
 *  the mirror runs through `schedule`. Safe to run twice or concurrently (claims in WHERE clauses). */
export async function advance(gen: Generation, apiKey: string, schedule: Scheduler): Promise<Generation> {
  throw new Error("not implemented");
  // switch (plan(gen, now, storage.enabled())) {
  //   "fail-unsubmitted": CAS status→failed WHERE status='queued' AND request_id IS NULL
  //   "check":  claim checked_at (2 s) → 0 rows ⇒ return gen
  //             s = hf.status(apiKey, requestId)   (404 ⇒ failed "request not found", as today)
  //             patch = statusPatch(...) → CAS UPDATE ... WHERE id AND status IN allowedFrom(patch.status)
  //             terminal ⇒ cleanupRefs; completed && !mirrorUrl ⇒ schedule(() => mirror(row))
  //   "mirror": schedule(() => mirror(gen))
  // }
}

/** Cancel while queued. hf.cancel then CAS status→canceled WHERE status='queued'. A lost race returns the current row. */
export async function cancel(gen: Generation, apiKey: string): Promise<Generation> {
  throw new Error("not implemented");
}

export type DrainReport = { checked: number; advanced: number; mirrored: number; failed: number; skipped: number };

/** advance() over every due row of every user, bounded by time and concurrency. Overlapping drains are safe. */
export async function drain(opts: { budgetMs: number; concurrency?: number }): Promise<DrainReport> {
  throw new Error("not implemented");
  // SELECT g.*, u.api_key_enc FROM generations g JOIN users u ON u.id = g.user_id
  // WHERE (g.status IN ('queued','in_progress') AND (g.checked_at IS NULL OR g.checked_at < now() - interval '45 seconds'))
  //    OR (g.status = 'completed' AND g.mirror_url IS NULL AND g.result_url IS NOT NULL
  //        AND g.mirror_attempts < 5 AND (g.mirror_lease_until IS NULL OR g.mirror_lease_until < now())
  //        AND (g.expires_at IS NULL OR g.expires_at > now()))
  // ORDER BY g.created_at LIMIT 200
  // rows without a key → skipped; each row → advance(row, decrypt(key), inline awaiter); stop launching after budgetMs
}

/** Webhook kick: resolve (generation, owner) from the URL's id and HMAC token. Throws HttpError(401) on a bad token. */
export async function lookupKick(id: string | null, token: string | null): Promise<{ gen: Generation; user: User }> {
  throw new Error("not implemented");
}

/** The URL Higgsfield will POST to. Null when no public production URL exists (local, preview). */
export function webhookUrlFor(id: string): string | null {
  throw new Error("not implemented"); // VERCEL_ENV==='production' ? https://${VERCEL_PROJECT_PRODUCTION_URL}/api/hooks/higgsfield?g=${id}&t=${kickToken(id)} : null
}

/** HMAC-SHA256(AUTH_SECRET, id), first 32 hex chars. */
function kickToken(id: string): string { throw new Error("not implemented"); }

/** The only 300 s-bound step. Claim lease → download → upsert → CAS mirror_url. Attempts and lease double as backoff. */
async function mirror(gen: Generation): Promise<void> {
  throw new Error("not implemented");
}
```

## `src/lib/storage.ts` (new, Supabase Storage behind a two-function surface)

```ts
export type StoredObject = { url: string };

/** True when SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_VIDEO_BUCKET are all set. */
export function enabled(): boolean { throw new Error("not implemented"); }

/** Upsert `body` at `key` in the video bucket. Returns the public URL. One REST call:
 *  POST {SUPABASE_URL}/storage/v1/object/{bucket}/{key}  headers: Bearer service role, Content-Type, x-upsert: true
 *  Public URL: {SUPABASE_URL}/storage/v1/object/public/{bucket}/{key}
 *  (endpoint shapes from memory, verify in PR 3; fall back to @supabase/storage-js if the raw call misbehaves) */
export async function putObject(key: string, body: ArrayBuffer, contentType: string): Promise<StoredObject> {
  throw new Error("not implemented");
}

/** `url?download=<filename>` so the gallery's download button gets Content-Disposition from the CDN. */
export function downloadUrl(url: string, filename: string): string { throw new Error("not implemented"); }
```

## `src/lib/higgsfield.ts` (changed)

```ts
export async function submit(
  apiKey: string, modelId: string, args: Record<string, unknown>, idempotencyKey: string,
  webhookUrl?: string,   // appended as ?hf_webhook=<encoded>
): Promise<HfSubmitResponse>

/** Base URL override so scripts/hf-stub.ts can stand in for Higgsfield. */
const BASE = process.env.HIGGSFIELD_BASE_URL ?? "https://api.higgsfield.ai";
```

## `src/lib/generations.ts` (changed)

```ts
// keep: apiKeyFor, priceFor, publicGeneration, PublicGeneration
// delete: syncStatus (moved into lifecycle.advance), cleanupRefs (moved into lifecycle)
export function publicGeneration(g: Generation, username?: string) {
  // resultUrl: g.mirrorUrl ?? g.resultUrl
  // expiresAt: g.mirrorUrl ? null : g.expiresAt        ← derived, no new flag
  // downloadUrl: g.mirrorUrl ? storage.downloadUrl(g.mirrorUrl, `${g.id}.mp4`) : g.resultUrl
}
```

## Routes

```ts
// src/app/api/generations/route.ts         POST → lifecycle.create (validation stays here, at the boundary)
// src/app/api/generations/[id]/route.ts    GET → lifecycle.advance(row, key, after); DELETE → lifecycle.cancel
//                                           export const maxDuration = 300   (after() may run the mirror)
// src/app/api/hooks/higgsfield/route.ts    POST → lookupKick → after(advance) → 200; export const maxDuration = 300
// src/app/api/cron/drain/route.ts          GET → bearer CRON_SECRET → lifecycle.drain({ budgetMs: 240_000 }); maxDuration = 300
```

## `vercel.json` (new)

```json
{ "regions": ["icn1"], "crons": [{ "path": "/api/cron/drain", "schedule": "* * * * *" }] }
```

On Hobby the schedule becomes `0 3 * * *` (once per day is the plan's limit). Region selection on Hobby is allowed for a single region per my memory, verify.

## `scripts/hf-stub.ts` (new, the lever)

A local HTTP server that implements `POST /{model}`, `GET /requests/{id}/status`, `POST /requests/{id}/cancel`, serves a result file of configurable size, and POSTs the webhook to the `hf_webhook` URL it was given, with scripted timings (`--queued 3s --running 20s --fail-every 7 --dup-webhooks`). `HIGGSFIELD_BASE_URL=http://localhost:8787` points the app at it. Every PR's proof runs against this stub, and the same proof runs against the real API once a key exists.

# Schema diff (Drizzle)

```ts
export const generations = pgTable("generations", {
  // ... unchanged columns ...
  requestId: text("request_id"),                       // unchanged; null now means "not yet submitted"
  resultUrl: text("result_url"),
  mirrorUrl: text("mirror_url"),                       // RENAMED from blob_url
  mirrorLeaseUntil: timestamp("mirror_lease_until", { withTimezone: true }),   // NEW
  mirrorAttempts: integer("mirror_attempts").notNull().default(0),            // NEW
  checkedAt: timestamp("checked_at", { withTimezone: true }),                 // NEW
  // ...
}, (t) => [
  index("generations_user_created_idx").on(t.userId, t.createdAt),
  index("generations_status_idx").on(t.status),
  index("generations_pending_mirror_idx").on(t.createdAt).where(sql`status = 'completed' AND mirror_url IS NULL`),  // NEW partial
]);
```

Migration `drizzle/0001_lifecycle.sql`, hand-written because drizzle-kit cannot tell a rename from drop-and-add:

```sql
ALTER TABLE generations RENAME COLUMN blob_url TO mirror_url;
ALTER TABLE generations ADD COLUMN mirror_lease_until timestamptz, ADD COLUMN mirror_attempts integer NOT NULL DEFAULT 0, ADD COLUMN checked_at timestamptz;
CREATE INDEX generations_pending_mirror_idx ON generations (created_at) WHERE status = 'completed' AND mirror_url IS NULL;
```

# Files touched

- `src/db/schema.ts`, `drizzle/0001_lifecycle.sql`, `drizzle/meta/*`
- `src/lib/lifecycle.ts` (new), `src/lib/storage.ts` (new)
- `src/lib/generations.ts` (shrinks), `src/lib/higgsfield.ts` (webhook param, base URL override)
- `src/app/api/generations/route.ts`, `src/app/api/generations/[id]/route.ts`
- `src/app/api/hooks/higgsfield/route.ts` (new), `src/app/api/cron/drain/route.ts` (new)
- `src/components/Playground.tsx` (poller id bug), `src/components/Gallery.tsx` (download URL, mirrored rows show no expiry)
- `vercel.json` (new), `.env.example`, `README.md`, `PRODUCT.md` (operating context paragraph)
- `scripts/hf-stub.ts` (new), `scripts/verify-lifecycle.ts` (new), `scripts/measure-copy.ts` (new)
- `package.json` only if the raw storage REST call is replaced by `@supabase/storage-js`

# Ownership and convergence

Single owner. `src/lib/lifecycle.ts` is the only module that writes `status`, `request_id`, `result_url`, `mirror_url`, `cost_usd`, `completed_at`, `expires_at`, `error`, `checked_at`, `mirror_lease_until`, `mirror_attempts`. The routes call it. `scripts/mock.ts` inserts rows that are already terminal with no `request_id`, so `plan` returns `none` for them and nothing ever calls Higgsfield for a mock row, as today. The `fail-unsubmitted` branch requires `queued`, so it never touches them.

Running a transition twice. `check` begins with the `checked_at` claim. The second run inside 2 s affects 0 rows and returns. Outside 2 s it reads Higgsfield again and computes the same patch, whose CAS precondition `status IN allowedFrom(next)` no longer holds, so 0 rows. Terminal is absorbing. `mirror` begins with the lease claim. The second run affects 0 rows and returns. If the first run crashed, the lease expires in 6 minutes and the second run redoes the copy to the same key with upsert, then sets `mirror_url WHERE mirror_url IS NULL`. Same end state.

Webhook and poll racing. Both call `advance` with the same key. Within 2 s one wins the `checked_at` claim and the other returns the row unchanged. Outside 2 s both read Higgsfield. The observations may differ in rank (one `in_progress`, one `completed`). The lower-ranked write's precondition fails because the row already holds the higher rank, or it lands first and the higher one lands after. Either order ends at `completed` with one `completedAt`, one `costUsd`. The mirror then runs under the lease, so at most one copy is in flight. Cron overlapping either of them is the same argument a third time.

Cancel racing a status read. `hf.cancel` succeeds, then `CAS status→canceled WHERE status='queued'`. If a poll already wrote `in_progress`, the CAS fails and the route returns 409 as today. Higgsfield will then report `canceled` on the next read, and `check` records it. No path writes `costUsd > 0` except `completed`.

# Storage decision with arithmetic

All sizes are guesses from the grounding file until measured. 300 videos per month, 20 viewers, each video watched 5 times on average (guess).

| scenario | per video | added per month | after 12 months | egress per month |
| --- | --- | --- | --- | --- |
| 480p 5 s | 2 MB | 0.6 GB | 7 GB | 3 GB |
| 1080p 10 s | 15 MB | 4.5 GB | 54 GB | 23 GB |
| 4k 15 s | 100 MB | 30 GB | 360 GB | 150 GB |

- **Supabase Free.** 1 GB storage, 5 GB egress, 50 MB per upload, paused after 7 idle days. The mid scenario exceeds storage in month 1, the small one in month 2, the large one cannot upload at all. Not viable for mirroring. The DB side is also marginal (500 MB, pausing). Reject.
- **Supabase Pro, $25/month.** 100 GB storage and 250 GB egress included, then $0.0213/GB-month and $0.09/GB. Small and mid scenarios never leave the included amounts in year 1. Large scenario crosses 100 GB in month 4 and ends year 1 at 360 GB, so about 260 GB × $0.0213 ≈ $5.5/month of overage by month 12. Egress stays inside 250 GB in every scenario. Year-1 ceiling about $31/month. Objects are served from Supabase's CDN with range requests, so `<video>` scrubbing works. One vendor, one bill, and the plan is needed anyway so the DB stops pausing.
- **Vercel Blob.** Hobby caps at 1 GB, a hard block. Pro per-GB prices (from memory, verify) are in the same band as Supabase's overage with no included egress to speak of, so the large scenario costs more, and it adds a second data vendor beside the DB.
- **Cloudflare R2.** Cheapest per GB and zero egress, but a new vendor, a new account, and an S3 signing dependency, for a one-person operator. Worth it only if the measured sizes land in the 4k scenario and the team watches a lot.

Decision. Supabase Storage on Supabase Pro. Public bucket `videos`, keys `<generation uuid>.mp4` (unguessable, 122 bits of entropy), `upsert` on write. Signed URLs are the documented alternative if the "anyone with the link" property is unacceptable.

What changes for the gallery and feed. Today both play the Higgsfield CDN URL and show "보관 N일 남음". After mirroring, `publicGeneration` returns the Supabase URL and a null `expiresAt`, so the label vanishes and the copy under the list ("결과는 Higgsfield에 7일간만 보관되니…") changes to say results are kept. The download button uses `?download=<id>.mp4`, which today's cross-origin `download` attribute cannot do.

Burst arithmetic at the API. 300 submissions in an hour, each polled 20 to 40 times while a tab is open, is about 10k requests/hour, about 3 req/s. Each is one session read, one row read, at most one Higgsfield read, one update. About 10 queries/s against the pooler. postgres-js holds 5 connections per instance and Fluid compute serves many requests per instance, so even five instances use 25 of the ~200 pooler connections. Cron at peak with every tab closed is 300 status reads per tick at concurrency 8 and ~200 ms each, about 8 s of a 240 s budget. Per key, 15 rows × 1 read/min from cron plus 6 reads/min from an open tab is far under any plausible limit. Mirrors: 300 copies spread over the burst, each under ~20 s guessed, run first inside the kicker's `after()` and otherwise by cron at concurrency 8, so a backlog of 300 clears in roughly 300 × 20 s / 8 ≈ 13 minutes. Monthly invocations at a few such bursts are tens of thousands, against Pro's million.

# Proposed PR split

Each PR is one change with its own proof, in dependency order. Proofs run against `scripts/hf-stub.ts` so no Higgsfield key is needed.

1. **Lifecycle owner, stub, and poller fix.** Add `lifecycle.ts` with `plan`, `statusPatch`, `allowedFrom`, `advance` (check step only), `cancel`, `create` (insert-first order, no webhook yet). Add `checked_at`. Move `syncStatus` and `cleanupRefs` out of `generations.ts`. Fix `Playground.tsx` `map(Number)`. Add `scripts/hf-stub.ts` and `HIGGSFIELD_BASE_URL`. Proof: `scripts/verify-lifecycle.ts` runs 10 concurrent `advance` calls on one row against the stub and asserts exactly one status read reached the stub and the row ends `completed` with one cost; a second pass with the stub returning `in_progress` and `completed` out of order asserts the row never regresses. Playground in dev against the stub shows a row go 대기 → 생성 중 → 완료 with the tab open.
2. **Cron drain.** `api/cron/drain`, `CRON_SECRET`, `vercel.json` with per-minute cron and `icn1`, `fail-unsubmitted` rule, `maxDuration` exports. Proof: seed three live rows for two users, close every tab, `curl` the drain with the secret, assert all three terminal and the stub saw three reads; a row with `request_id` null and `created_at` 11 minutes ago turns `failed`; two drains launched together produce one read per row (claim). Hobby degradation written in README: daily schedule, closed-tab rows complete within 24 h.
3. **Mirror to Supabase Storage.** `storage.ts`, mirror step in `advance`, rename `blob_url → mirror_url`, lease and attempts columns, partial index, `after()` in the `[id]` route, gallery download URL and derived expiry, env vars and bucket setup in README. Proof: stub serves a 20 MB result; after drain the row has `mirror_url`, a `HEAD` on it returns the same `Content-Length`; two concurrent drains upload once (stub counts downloads); a drain with the storage PUT forced to fail increments `mirror_attempts` and sets the lease; after the lease a retry succeeds. Degradation: with the three env vars unset `plan` never returns `mirror` and rows keep Higgsfield URLs and the expiry label.
4. **Webhook kick.** `webhookUrlFor`, `kickToken`, `lookupKick`, `hf.submit` webhook param, `api/hooks/higgsfield`. Proof: stub posts the webhook; with no client poll and no cron the row reaches `completed` and `mirror_url` within seconds; a duplicate delivery and a delivery racing a poll converge (stub read count ≤ 2); a bad token gets 401 and the stub records no retry. Production-only attachment verified by asserting `webhookUrlFor` returns null when `VERCEL_ENV` is `preview`.
5. **Ops, docs, and measurement.** `scripts/measure-copy.ts` that, given a real key, submits one generation per model at min and max resolution, records result sizes and copy time to Supabase from the deployed region, and prints the table above with real numbers. README and PRODUCT.md operating context rewritten for the three kickers, Pro versus Hobby, and the storage decision. Admin log shows `mirror_attempts` so a stuck mirror is visible. Proof: the script runs end to end against the stub, and the docs' numbers table has a "measured on" line that the script fills.

Why the webhook is PR 4 and not PR 2. On Pro, cron plus poll already make every row converge within a minute of a closed tab, so the webhook only buys latency and lower cron load. Correctness therefore never depends on the one thing nobody can test without a key. On Hobby the order of value flips (daily cron makes the webhook the main closed-tab driver), which is a reason to merge PR 4 before going live, not a reason to build it before the mirror.

Principles that shaped this package. **model-the-domain** turned scattered status writes into one reducer with a rank table. **make-operations-idempotent** put every claim in a WHERE clause and made the lease judge staleness by time. **separate-before-serializing-shared-state** confirmed the row is a real single write target, so serialization is structural. **boundary-discipline** kept `next/server` out of the lifecycle via the `Scheduler` parameter and kept request validation in the route. **redesign-from-first-principles** produced the insert-first submit order. **laziness-protocol** chose one raw storage REST call over an SDK and no queue table. **attack-the-premise** rewrote constraint 1 from "functions time out" to "nothing drives rows when no tab is open". **foundational-thinking** put the stub in PR 1 as scaffold. **type-system-discipline** encoded the forward-only transitions as a rank table rather than runtime checks on each caller. **experience-first** chose the visible failed row over a silent orphaned charge and the working download button.
