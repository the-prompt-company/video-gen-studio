# Candidate 1: the row is the job, the webhook is a doorbell

User goal, restated. Make the generation phase of Video Gen Studio work well on Vercel even though functions stop at 300 s, even when 20 people fire about 300 generations within a few hours at launch, and decide whether Supabase is the right place to store and serve the finished videos.

Evidence labels used below. **Verified** means read in the repo or in a doc fetched this session. **Inferred** means reasoned from code I read but not run. **Guess** means a number nobody has measured.

## Problem

The premise as stated is "a generation can take longer than 300 s, so the function times out." I wrote it down and tested it against the code, and it is false. `POST /api/generations` submits and returns in seconds, and `GET /api/generations/:id` makes one Higgsfield status call per request (verified, `route.ts`, `[id]/route.ts`, `generations.ts`). No function waits for Higgsfield. What the 300 s limit and the platform really constrain is different:

1. **Nothing advances a row unless a browser polls it.** Close the tab and the row stays `queued` or `in_progress`. Cost, `expiresAt` and the reference-blob cleanup are written late or never (verified, `syncStatus` is the only writer and only the poll route calls it).
2. **The open-tab poll is broken today.** `Playground.tsx` builds the poll list with `liveKey.split(",").map(Number)`, but `generations.id` is a uuid (verified, `schema.ts`, `0000_spotty_rictor.sql`). Every tick fetches `/api/generations/NaN`. Postgres rejects `"NaN"` as a uuid, `errorResponse` answers 500, and the client swallows it (inferred, not run). The line arrived in commit `d2fdc8a` (verified, `git log -S`). So a real generation never reaches 완료 on screen, its cost is never recorded, and its refs are never cleaned up. The feed GET does not sync either.
3. **Results vanish after 7 days** unless someone copies them (verified, Higgsfield docs via grounding). The copy is the one server step that moves bytes, so it is the one step the 300 s limit can actually bind.
4. **A burst multiplies status calls per key.** The poll effect restarts with a 2 s delay every time the live set changes (verified, the effect depends on `liveKey`). In a burst the set changes every few seconds, so a user with 15 live items sends roughly 15 requests every 4 s, each one calling Higgsfield with that user's key (inferred). Higgsfield documents no per-key rate or concurrency limit (verified absent).
5. **Every query crosses the Pacific.** Functions run in `iad1` and Supabase is in `ap-northeast-2` (verified, grounding), so each poll pays about 3 database round trips of roughly 180 ms each (RTT is a guess from geography).

Constraints the design must honor. Per-user Higgsfield keys stay. The client poll stays as the local-dev path, since localhost has no public URL for webhooks. Hobby must degrade, not break. Mock rows (`[목업]`) carry relative `/mock/*.webm` URLs and no `request_id`, and nothing may ever call Higgsfield or copy for them (verified, `scripts/mock.ts`). The Idempotency-Key returns the original `request_id` without charging again, and reusing a key with a different body returns 422 (verified, fetched `docs.higgsfield.ai/docs/concepts/idempotency.md`). A resend must therefore rebuild the exact body from the row.

## Usage (caller's view)

README excerpt (동작 원리, rewritten):

> 생성 한 건은 `generations` 행 하나이고, 그 행이 곧 작업입니다. 행을 앞으로 움직이는 코드는 `src/lib/generations.ts` 하나뿐입니다. 누가 부르든(브라우저 폴링, Higgsfield 웹훅, 1분 크론) 같은 함수가 "지금 이 행에서 할 수 있는 다음 일"을 합니다. 즉 Higgsfield 제출, 상태 조회, 완료 처리(비용 기록, 레퍼런스 정리), Supabase Storage로 영상 복사입니다. 같은 일을 두 번 해도 결과가 같습니다. 웹훅은 "상태가 바뀌었으니 확인해 보라"는 초인종일 뿐이고, 본문은 믿지 않고 사용자의 키로 상태를 다시 조회합니다. 영상은 완료 직후 몇 초 동안 Higgsfield URL로 재생되고, 복사가 끝나면 Supabase URL로 바뀌며 더는 만료되지 않습니다.

Call sites, as the route handlers will read after the change.

```ts
// src/app/api/generations/route.ts, POST
const gen = await submitGeneration(user, { spec, prompt, params, imageUrls, videoUrls });
const http = gen.status === "failed" ? 502 : gen.status === "pending" ? 202 : 201;
return Response.json({ item: publicGeneration(gen), error: gen.error ?? undefined, estimatedCostUsd }, { status: http });

// src/app/api/generations/route.ts, GET ?ids=a,b,c (the client poll: one request per tick for all live items)
const rows = await ownedRows(user, ids);
return Response.json({ items: (await Promise.all(rows.map(settle))).map((g) => publicGeneration(g)) });

// src/app/api/generations/[id]/route.ts, DELETE
return Response.json({ item: publicGeneration(await cancelGeneration(row)) });

// src/app/api/hooks/higgsfield/route.ts, POST ?g=<id>&t=<token>
const outcome = await onProviderHook(new URL(req.url));
return new Response(null, { status: { done: 204, unauthorized: 401, retry: 503 }[outcome] });

// src/app/api/cron/settle/route.ts, GET (Vercel Cron, every minute on Pro)
return Response.json(await sweep({ deadline: Date.now() + 240_000 }));
```

What a component reads.

```tsx
<video src={g.video?.url} />
<a href={g.video?.downloadUrl} download>다운로드</a>
{g.video?.kind === "provider" && <span>보관 {expiresIn(g.video.expiresAt)}</span>}
<StatusBadge status={g.status} />   // label and tone come from one exhaustive Record
```

## Shape

### Data first

One table stays the source of truth. The `generations` row is the durable job record. Two groups of columns, each written by one step of one module:

- **Lifecycle columns.** `status`, `request_id`, `next_check_at`, `result_url`, `expires_at`, `completed_at`, `cost_usd`, `error`.
- **Media columns.** `storage_path`, `size_bytes`, `mirror_attempts`, `mirror_next_at`, `mirror_error`.

Every UPDATE sets only its own group, so a copy finishing and a late status write never overwrite each other (per separate-before-serializing-shared-state). The sharing is a row, not a field.

The status vocabulary moves to one client-safe tuple, `GENERATION_STATUSES`, with a `RANK` table: `pending 0 < queued 1 < in_progress 2 < {completed, failed, nsfw, canceled} 3`. Every write that changes `status` is a conditional UPDATE: `WHERE status = ANY(predecessorsOf(to))`, and `predecessorsOf` is derived from `RANK`. A row can only move to a strictly higher rank. That single rule is why every race in the table below converges (per make-operations-idempotent and model-the-domain). Today the live set is written out by hand in four places (`Playground.tsx` `LIVE`, `StatusBadge.tsx`, `[id]/route.ts`, `generations.ts` `TERMINAL`) (verified). They all collapse into `isLive()` from the tuple, and the label and tone maps become `Record<GenerationStatus, string>`, so adding `pending` fails the build until it has a label (per encode-lessons-in-structure).

Two "due" clocks drive all background work, and both double as claims:

- `next_check_at` is the earliest time anyone may ask Higgsfield about the row. A caller claims a check with `UPDATE … SET next_check_at = now() + 15 s WHERE id = $1 AND next_check_at <= now() RETURNING id`. One caller wins and the rest return the row as read. For a `pending` row the same column holds the submit lease and the 429 back-off.
- `mirror_next_at` is the copy lease and the back-off in one column. A claim pushes it at least 360 s ahead, which is longer than the 300 s `maxDuration` of every route that copies. So an expired lease proves the previous copier is dead, whatever point it stopped at.

The storage column stores the object key (`<id>.mp4`), not a URL. `publicGeneration` derives the URL from the env at read time, so moving the bucket or vendor is a copy plus an env change, with no data migration. The unused `blob_url` column is dropped (verified, nothing writes it).

### The single owner

`src/lib/generations.ts` is the only module that writes the lifecycle and media columns. Inside it, `apply()` is the only statement that writes `status` after insert. A lint rule (`no-restricted-syntax` on `.update(schema.generations)` outside that file) makes a second writer fail `npm run lint`.

Data flow.

1. `higgsfield.ts` parses wire JSON into domain outcomes: `SubmitOutcome` (accepted, deferred, rejected) and `ProviderState` (running, completed, ended, missing). Wire types become private. A 429 or 5xx on a read throws `ProviderUnavailable` (per boundary-discipline).
2. `decide(row, observation, ctx)` is a pure function holding the whole transition table. It returns a `Step`: `move` (to a status with a patch), `wait` (pending row, only `next_check_at` changes), or `none`.
3. `apply(row, step)` runs the conditional UPDATE. Zero rows means another actor already moved the row at least as far, so it rereads and reports `moved: false`. Only the caller that actually moved the row schedules the terminal effects (ref cleanup, then the copy), so they run once.
4. `storeVideo(row)` claims the copy, fetches `result_url` into memory (timeout 240 s), upserts to `videos/<id>.mp4` with a one-year Cache-Control, then sets `storage_path` and `size_bytes`. It logs one JSON line with `bytes`, `fetchMs` and `uploadMs`, so the first real day answers the open size and copy-time questions.

The webhook is a doorbell. The hook route checks an HMAC token in its own URL (`?g=<id>&t=<hmac>`, keyed from `AUTH_SECRET`), then forces a status check with the owner's key. It never reads the payload. That one choice removes the per-account `whsec_` secret problem, because 20 user keys may belong to several Higgsfield accounts (unknown). It also removes a second parser of provider state, and it means a forged delivery cannot plant a URL that we then copy into our bucket. If the status call fails, or the row is still `pending` with no `request_id` (a hook that arrived before the submit's UPDATE landed), the route answers 503 and Higgsfield redelivers for up to 2 h (verified, webhook docs via grounding). Higgsfield's retry queue thus covers the lifecycle transition, and our own sweep covers only the copy and missed hooks.

Triggers and their policy, as one table inside the module instead of branches:

| Reason | Who | Provider check | Provider error | Copy |
|---|---|---|---|---|
| poll | browser, `GET /api/generations?ids=` | only if `next_check_at` is due | swallowed, row returned as read | `after()` |
| hook | Higgsfield, `POST /api/hooks/higgsfield` | forced | 503, Higgsfield redelivers | `after()` |
| sweep | Vercel Cron every minute, `GET /api/cron/settle` | only if due | logged, next tick retries | inline, sequential, within 240 s |

Submit becomes insert-first (PR 6). The row is inserted as `pending`, and the submit uses `Idempotency-Key = row id` with a body rebuilt from the row by `buildArguments`. A 429, 5xx, network error or timeout leaves the row `pending` with `next_check_at = now() + Retry-After` (clamped 5 to 300 s), shown as 제출 대기. The next poll, sweep or visit resends it, and Higgsfield returns the original `request_id` if the first attempt did land (verified doc). Other 4xx responses become `failed` with the reason, so admins see rejected submissions in 로그. A `pending` row older than 30 minutes becomes `failed` instead of starting a paid generation the user no longer expects.

### Convergence

| Repeat or race | What happens | End state |
|---|---|---|
| Duplicate webhook deliveries | Both force a check. Both decide `move → completed`. The first UPDATE matches `status IN (pending, queued, in_progress)`. The second matches zero rows and rereads. | One transition. `cost_usd` and `completed_at` are written once. The copy is scheduled once. |
| Webhook says completed, a stale poll says in_progress | The poll's UPDATE requires `status IN (pending, queued)`. | Never moves backward. |
| 50 tabs, or 15 items in one batched poll | `next_check_at` claim lets one caller per row per 15 s through. | At most 1 Higgsfield call per row per 15 s. |
| Crash after Higgsfield accepted, before our UPDATE | The row stays `pending`. Its 30 s submit lease expires and the next actor resends with the same key and body. | Higgsfield returns the original id with no second charge (verified). |
| Crash or timeout mid-copy | `storage_path` stays null and `mirror_next_at` sits at least 360 s ahead. | The next claim re-uploads to the same key with upsert. |
| Webhook `after()` copy and sweep copy at once | The claim is one conditional UPDATE, so one caller gets the row back. | One upload. A second upload would still be the same bytes at the same key. |
| Cancel and completion race | Cancel calls Higgsfield first, then `apply(move canceled)`. If completion landed first, the move matches zero rows. | Whatever Higgsfield reports. |
| Cancel while a submit is in flight | The pending cancel also requires `next_check_at <= now()`, meaning no live submit lease. | 409 "제출 중", no orphan generation. |
| Crash between the terminal move and `after(storeVideo)` | The sweep's due query finds completed rows with a request id and no `storage_path`. | Copied on the next tick. |

### Interface depth

The public surface of `generations.ts` is seven functions: `submitGeneration`, `settle`, `cancelGeneration`, `onProviderHook`, `sweep`, `publicGeneration` and `apiKeyFor`. Behind them sit the Higgsfield protocol, idempotent resubmission, the deferral policy, two claim clocks, the transition table, cost computation, ref cleanup, the copy, and the URL derivation. Each caller makes one call per operation, and no caller has to know the order of steps. `settle` takes no reason parameter, because only the poll routes call it. The hook and sweep policies stay internal behind their own verbs. `storage.ts` exposes four functions and hides the bucket, auth and URL format. `higgsfield.ts` exposes domain outcomes, not wire JSON.

### What it deliberately does not do

- It holds no function open while Higgsfield renders.
- It never parses the webhook body or verifies Standard Webhooks signatures.
- It runs no queue of its own and does not cap in-flight generations per user. A Higgsfield 429 becomes a `pending` row, which gives the queued experience without the infrastructure.
- It does not stream copies. It buffers the file, which gives an exact byte count and a simple upload. That is fine up to a few hundred MB in a 2 GB function, and the guessed 4k 15 s size is 50 to 150 MB.
- It never deletes stored videos (retention is indefinite, per the defaults).
- It uses no Vercel Workflow, no Queues, no new index, and no Supabase client beyond `@supabase/storage-js`.

## Synthesis decision

## Tradeoffs accepted

- We accept one extra Higgsfield status call per webhook in exchange for no per-account secrets, no second parser and no trust in inbound payloads.
- We accept 15 s of staleness on an open-tab poll when a webhook is missed, in exchange for at most one provider call per row per 15 s during a burst.
- We accept that a video plays from the Higgsfield URL for the few seconds before its copy lands, in exchange for showing 완료 the moment the provider says so.
- We accept buffering whole files in function memory in exchange for exact sizes and a one-call upload. Revisit if measured sizes pass about 500 MB.
- We accept a public bucket with unguessable uuid keys, where anyone holding a URL can watch the video, in exchange for cacheable, stable URLs and no per-render signing.
- We accept that Blob reference files leak if a function dies between the terminal move and cleanup, in exchange for not tracking cleanup state. The leak is a few MB of temporary inputs.
- We accept a `pending` status that, if Higgsfield never answers 429, exists for about one second per generation. In exchange, the launch burst cannot turn into a wall of 502 errors.
- We accept a per-minute cron that usually finds nothing (about 43,200 near-empty invocations a month), in exchange for convergence within a minute without any open tab.
- We accept a 30-minute submit deadline, which fails deferred rows on Hobby when no tab is open, in exchange for never starting a paid generation hours after the click.

## Alternatives considered

- **Cron-only reconciler, no webhook.** One trigger and one code path. On Hobby the cron runs once a day, so a closed tab means a day of waiting. On Pro it adds up to a minute of latency to every completion and polls every live row every minute. It exposes no extra complexity to callers but hides less, because latency becomes a property of the schedule. The doorbell costs one route and works on every plan.
- **Vercel Workflow per generation** (`'use workflow'`, a hook step for the webhook, a step for the copy). It hides retries and durability well. It also creates a second state store (the workflow run) that must agree with `generations.status`, which is split ownership. It brings a beta-grade dependency, usage pricing, and a different local-dev story. Higgsfield does the waiting, so the only step that needs durability is the copy, and a 360 s lease plus the sweep provides it.
- **Trusted webhook payload with Standard Webhooks signatures.** It saves one status call per generation. But it needs one revealed `whsec_` secret per Higgsfield account behind the 20 keys. Deliveries are unsigned until the secret is revealed, so a forged `payload.video.url` would get copied into our bucket. And `payload` plus the status endpoint would be two parsers of one state, so two ways to do one task.
- **Our own submission queue** (Vercel Queues, or a per-user in-flight cap). It would protect against a per-key concurrency limit nobody has observed. The `pending` state gives users the same experience (items wait and start themselves) with no new infrastructure. Revisit if the first burst shows Higgsfield accepting submits but starving them in `queued`. The cap would then be one more predicate on the same `pending` state.
- **Browser-only pipeline** (fix the NaN, let the client trigger the copy). It needs the least code, but every closed tab loses the copy and the cost record, and the 7-day expiry stays a user problem.
- **Supabase-side execution** (pg_cron with pg_net calling the sweep route every minute, or an Edge Function that receives hooks and copies within Supabase's network). This is the best Hobby path, because pg_cron does not depend on Vercel's cron limits (availability on Supabase Free is from memory, not verified). It is rejected for v1 because the target is Vercel Pro, and it splits operations across two consoles. It is the documented fallback if the team stays on Hobby.

## Open questions and risks

- What are real result sizes per model, resolution and duration? `size_bytes` answers it after the first real day. Until then every storage figure below is a guess.
- How long does a copy take from `icn1` (or `iad1`) for a 100 MB file? The `video_stored` log line answers it, and the PR 4 probe answers it before any key exists.
- Do all 20 keys belong to one Higgsfield account? The doorbell design does not need the answer. It matters only if someone later wants signature checks.
- What are Higgsfield's per-key rate and concurrency limits? The fake lever simulates them. The real answer is the count of deferred submits and `ProviderUnavailable` logs in the first burst.
- After `expires_at`, does the status endpoint return 404 or `completed` with a dead URL? The fetched doc does not say. Both end in a terminal row with no copy, and the gallery shows 만료됨.
- Is 30 minutes the right deadline for a deferred submit? That is a product call.
- Is a public bucket acceptable, given that anyone with a link can watch? If not, switch to a private bucket with batched `createSignedUrls` in the gallery page, accepting more egress (URLs change per render, so browser caches miss) and links that die mid-session.
- Can a Hobby project pin its function region to `icn1`, and does a per-minute cron fail a Hobby deploy? I recall yes on both and have not verified either.
- Preview deployments share the production database (verified, verify skill notes). Hooks registered from a preview point at production, which then settles the row in the same database. That works today, but it would break if previews ever get their own database.
- Do public-bucket CDN hits count as Supabase "cached egress"? The fetched doc ties cached egress to Smart CDN but does not say so for public buckets.

## Next implementation step

Remove `.map(Number)` from the poll list in `Playground.tsx` (PR 1), because today no generation ever finishes on screen.

---

## Type sketch and signatures

The sketch shows the end state after all six PRs. Bodies throw `not implemented`, and `// TODO` lines are pseudocode for the tricky parts.

### `src/lib/generation-status.ts` (new, client-safe, no server imports)

```ts
export const GENERATION_STATUSES = [
  "pending", "queued", "in_progress", "completed", "failed", "nsfw", "canceled",
] as const; // "pending" arrives in PR 6; PR 3 ships the other six
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Lifecycle order. A row only ever moves to a strictly higher rank; that is what makes racing writers converge. */
export const RANK = {
  pending: 0, queued: 1, in_progress: 2,
  completed: 3, failed: 3, nsfw: 3, canceled: 3,
} as const satisfies Record<GenerationStatus, 0 | 1 | 2 | 3>;

export type LiveStatus = { [S in GenerationStatus]: (typeof RANK)[S] extends 3 ? never : S }[GenerationStatus];
export type TerminalStatus = Exclude<GenerationStatus, LiveStatus>;

export function isLive(s: GenerationStatus): s is LiveStatus {
  throw new Error("not implemented"); // RANK[s] < 3
}

/** Statuses a row may hold for a write that moves it to `to`. Derived from RANK, never listed by hand. */
export function predecessorsOf(to: GenerationStatus): GenerationStatus[] {
  throw new Error("not implemented"); // GENERATION_STATUSES.filter((s) => RANK[s] < RANK[to])
}

export const STATUS_LABEL: Record<GenerationStatus, string> = {
  pending: "제출 대기", queued: "대기", in_progress: "생성 중",
  completed: "완료", failed: "실패", nsfw: "NSFW 차단", canceled: "취소",
};
export const STATUS_TONE: Record<GenerationStatus, string> = {
  pending: "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30",
  // queued … canceled moved verbatim from format.ts
} as Record<GenerationStatus, string>; // sketch only; the real map lists all seven, no cast
```

`format.ts` loses `STATUS_LABEL` and `STATUS_TONE`. `StatusBadge`, `Gallery`, `LogsPanel` and `Playground` import them from here.

### `src/db/schema.ts` (diff)

```ts
import type { RequestId } from "../lib/higgsfield";   // relative: drizzle-kit loads this file without the @/ alias
import type { ObjectKey } from "../lib/storage";
import { GENERATION_STATUSES } from "../lib/generation-status";

export const generations = pgTable("generations", {
  // … id, userId, modelId, prompt, params, imageRefs, videoRefs unchanged
- status: text("status", { enum: ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"] }).notNull().default("queued"),
+ status: text("status", { enum: GENERATION_STATUSES }).notNull().default("pending"),
- requestId: text("request_id"),
+ requestId: text("request_id").$type<RequestId>(),
+ /** Earliest time any actor may ask Higgsfield about this row. Claimed by a conditional UPDATE; also the pending submit lease and 429 back-off. */
+ nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
  resultUrl: text("result_url"),            // Higgsfield CDN URL; dies at expiresAt
- blobUrl: text("blob_url"),
+ /** Object key in the videos bucket. Set only after the upload finished, so non-null means playable from storage. */
+ storagePath: text("storage_path").$type<ObjectKey>(),
+ sizeBytes: integer("size_bytes"),
+ mirrorAttempts: integer("mirror_attempts").notNull().default(0),
+ /** Copy lease and back-off in one column. A claim pushes it at least MIRROR_LEASE_S (360 s) ahead. */
+ mirrorNextAt: timestamp("mirror_next_at", { withTimezone: true }),
+ mirrorError: text("mirror_error"),
  // … expiresAt, durationS, costUsd, error, createdAt, completedAt unchanged
});
```

Migrations, generated by `npm run db:generate` and checked in.

```sql
-- 0001 (PR 3)
ALTER TABLE "generations" ADD COLUMN "next_check_at" timestamptz DEFAULT now() NOT NULL;

-- 0002 (PR 4). blob_url is always NULL (nothing writes it), so drop + add is lossless
-- and avoids drizzle-kit's interactive rename prompt.
ALTER TABLE "generations" DROP COLUMN "blob_url";
ALTER TABLE "generations" ADD COLUMN "storage_path" text;
ALTER TABLE "generations" ADD COLUMN "size_bytes" integer;
ALTER TABLE "generations" ADD COLUMN "mirror_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "generations" ADD COLUMN "mirror_next_at" timestamptz;
ALTER TABLE "generations" ADD COLUMN "mirror_error" text;

-- 0003 (PR 6). status is a plain text column (the enum is TypeScript-only), so only the default changes.
ALTER TABLE "generations" ALTER COLUMN "status" SET DEFAULT 'pending';
```

No new index. The sweep's due query filters on `status` (already indexed) over a table of thousands of rows.

### `src/lib/higgsfield.ts` (changed; the only parser of Higgsfield wire data)

```ts
const BASE = process.env.HIGGSFIELD_BASE_URL ?? "https://api.higgsfield.ai"; // the fake lever points this at localhost

export type ApiKey = string & { readonly __brand: "HiggsfieldApiKey" };
export type RequestId = string & { readonly __brand: "HiggsfieldRequestId" };

/** What one submit attempt established. Retryable failures are data, because the caller schedules them. */
export type SubmitOutcome =
  | { kind: "accepted"; requestId: RequestId }
  | { kind: "deferred"; retryAfterS: number; reason: string } // 429, 5xx, network, timeout: resend with the same key
  | { kind: "rejected"; error: string };                       // any other 4xx, including 422 key-reuse-with-different-body

/** What Higgsfield says about one request. */
export type ProviderState =
  | { kind: "running"; status: "queued" | "in_progress" }
  | { kind: "completed"; videoUrl: string; expiresAt: Date | null } // no URL in the response parses as ended/failed
  | { kind: "ended"; status: "failed" | "nsfw" | "canceled"; error: string | null; expiresAt: Date | null }
  | { kind: "missing" };                                             // 404

/** 429, 5xx, network error or timeout on a read. */
export class ProviderUnavailable extends Error {
  constructor(message: string, public readonly retryAfterS?: number) { super(message); }
}

export async function submit(
  key: ApiKey,
  modelId: string,
  args: Record<string, unknown>,
  opts: { idempotencyKey: string; webhookUrl: string | null }, // webhookUrl → ?hf_webhook=<encoded>
): Promise<SubmitOutcome> {
  throw new Error("not implemented"); // fetch with AbortSignal.timeout(20_000); map status codes to outcomes
}

export async function status(key: ApiKey, requestId: RequestId): Promise<ProviderState> {
  throw new Error("not implemented"); // AbortSignal.timeout(8_000) so a hook can still answer within 10 s
}

export async function cancel(key: ApiKey, requestId: RequestId): Promise<"canceled" | "not_cancelable"> {
  throw new Error("not implemented");
}

// generateUploadUrl / uploadBytes unchanged apart from taking ApiKey.
// HfSubmitResponse / HfStatusResponse become module-private.
```

### `src/lib/storage.ts` (new; the only module that knows the bucket, auth and URL format)

```ts
import { StorageClient } from "@supabase/storage-js";

export type ObjectKey = string & { readonly __brand: "ObjectKey" };

/** False when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset (local dev). Videos then keep playing from Higgsfield. */
export function storageEnabled(): boolean {
  throw new Error("not implemented");
}

export function videoKey(generationId: string): ObjectKey {
  throw new Error("not implemented"); // `${generationId}.mp4`
}

/**
 * Upsert to SUPABASE_VIDEO_BUCKET (default "videos"), cacheControl one year (keys are immutable).
 * Same key and same bytes from two writers leave the same object: concurrent copies waste bandwidth, never corrupt.
 */
export async function putVideo(key: ObjectKey, bytes: Uint8Array, contentType: string): Promise<void> {
  throw new Error("not implemented");
}

/** Public URL, plus one with ?download=<name> so the browser saves instead of navigating (cross-origin <a download> is ignored). */
export function videoUrls(key: ObjectKey, downloadName: string): { url: string; downloadUrl: string } {
  throw new Error("not implemented");
}
```

### `src/lib/crypto.ts` (addition)

```ts
/** base64url HMAC-SHA256 of `value` under a key derived from AUTH_SECRET and `purpose`, truncated to 32 chars. */
export function signToken(purpose: "hf-hook", value: string): string {
  throw new Error("not implemented");
}
export function verifyToken(purpose: "hf-hook", value: string, token: string): boolean {
  throw new Error("not implemented"); // timingSafeEqual
}
```

### `src/lib/generations.ts` (rewritten; single owner of the lifecycle and media columns)

```ts
import { after } from "next/server";
import type { Generation, NewGeneration, User } from "@/db/schema";
import type { ModelSpec } from "@/lib/catalog";
import type { GenerationStatus } from "@/lib/generation-status";
import * as hf from "@/lib/higgsfield";
import * as storage from "@/lib/storage";

// ── public surface ────────────────────────────────────────────────────────────

export type GenerationRequest = {
  spec: ModelSpec;
  prompt: string;
  params: Record<string, unknown>; // already coerced by coerceParams
  imageUrls: string[];
  videoUrls: string[];
};

export type PublicVideo =
  | { kind: "stored"; url: string; downloadUrl: string }
  | { kind: "provider"; url: string; downloadUrl: string; expiresAt: Date | null };

export type PublicGeneration = {
  id: string;
  username?: string;
  modelId: string;
  prompt: string;
  params: Record<string, unknown>;
  imageRefs: string[];
  videoRefs: string[];
  status: GenerationStatus;
  /** Non-null only when completed with a URL. Replaces resultUrl + expiresAt. */
  video: PublicVideo | null;
  durationS: number;
  costUsd: number;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type SweepReport = {
  submitted: number; checked: number; moved: number; stored: number; failures: number; truncated: boolean;
};

export function apiKeyFor(user: User): hf.ApiKey {
  throw new Error("not implemented"); // unchanged behavior, branded result; still used by /api/uploads
}

/**
 * Insert the row as pending, then submit with Idempotency-Key = row id and a body rebuilt from the row.
 * Returns the row as pending (deferred), queued (accepted) or failed (rejected).
 */
export async function submitGeneration(user: User, req: GenerationRequest): Promise<Generation> {
  throw new Error("not implemented");
  // TODO: const [row] = insert({ ...req fields, status: "pending", nextCheckAt: now }).returning()
  //       return submitPending(row)
}

/** Poll semantics: bring the row as far forward as Higgsfield and storage allow right now. Idempotent under any concurrency. */
export async function settle(gen: Generation): Promise<Generation> {
  return settleAs(gen, "poll");
}

/** Cancel while pending (not mid-submit) or queued. HttpError(409) otherwise. */
export async function cancelGeneration(gen: Generation): Promise<Generation> {
  throw new Error("not implemented");
  // TODO: pending → apply(move canceled) with extra guard next_check_at <= now(); zero rows → 409 "제출 중입니다"
  //       queued  → hf.cancel; "canceled" → apply(move canceled); "not_cancelable" → refresh(force) then 409
  //       else    → 409 "대기 중인 건만 취소할 수 있습니다"
}

/** The hook route's whole job. The body is never read: the hook only says "look now". */
export async function onProviderHook(url: URL): Promise<"done" | "unauthorized" | "retry"> {
  throw new Error("not implemented");
  // TODO: id = url.searchParams.get("g"); verifyToken("hf-hook", id, t) else "unauthorized"
  //       row = select by id; none → "done"
  //       try settleAs(row, "hook") → "done"; catch RetryLater → "retry"
}

/** Settle every due row, oldest first, until the deadline. Only the cron route calls this. */
export async function sweep(opts: { deadline: number }): Promise<SweepReport> {
  throw new Error("not implemented");
  // TODO: due = select where
  //         (status = 'pending')
  //         or (status in ('queued','in_progress') and request_id is not null and next_check_at <= now())
  //         or (status = 'completed' and request_id is not null and result_url is not null and storage_path is null
  //             and (mirror_next_at is null or mirror_next_at <= now()) and (expires_at is null or expires_at > now()))
  //       order by created_at limit 100
  //       for each, sequentially: if Date.now() > deadline → truncated; settleAs(row, "sweep")
}

export function publicGeneration(g: Generation, username?: string): PublicGeneration {
  throw new Error("not implemented");
  // TODO: video = status !== "completed" ? null
  //       : g.storagePath ? { kind: "stored", ...storage.videoUrls(g.storagePath, downloadName(g)) }
  //       : g.resultUrl ? { kind: "provider", url: g.resultUrl, downloadUrl: g.resultUrl, expiresAt: g.expiresAt }
  //       : null
}

// ── internals (not exported) ─────────────────────────────────────────────────

type SettleReason = "poll" | "hook" | "sweep";
type Policy = { forceCheck: boolean; copy: "after" | "inline"; surfaceProviderErrors: boolean };

const POLICY = {
  poll: { forceCheck: false, copy: "after", surfaceProviderErrors: false },
  hook: { forceCheck: true, copy: "after", surfaceProviderErrors: true },
  sweep: { forceCheck: false, copy: "inline", surfaceProviderErrors: false },
} as const satisfies Record<SettleReason, Policy>;

const CHECK_GAP_S = 15;                 // a live row is asked about at most once per 15 s, whoever asks
const SUBMIT_LEASE_S = 30;              // longer than the 20 s submit timeout
const SUBMIT_DEADLINE_MS = 30 * 60_000; // a deferred submit older than this fails instead of starting late
const MIRROR_LEASE_S = 360;             // longer than maxDuration (300 s) of every copying route: expired lease = dead copier
const COPY_TIMEOUT_MS = 240_000;        // fail cleanly before maxDuration
const MAX_COPY_BYTES = 1024 ** 3;       // refuse anything over 1 GB (guessed 4k 15 s is 50-150 MB)

/** Thrown only under the hook policy. onProviderHook maps it to 503 so Higgsfield redelivers. */
class RetryLater extends Error {}

type LifecyclePatch = Partial<Pick<NewGeneration,
  "requestId" | "nextCheckAt" | "resultUrl" | "expiresAt" | "completedAt" | "costUsd" | "error">>;

type Observation =
  | { source: "submit"; outcome: hf.SubmitOutcome }
  | { source: "status"; state: hf.ProviderState }
  | { source: "cancel" }
  | { source: "clock" }; // pending row past SUBMIT_DEADLINE_MS

type Step =
  | { kind: "move"; to: GenerationStatus; patch: LifecyclePatch }
  | { kind: "wait"; until: Date }
  | { kind: "none" };

/**
 * Pure. The whole transition table:
 *   pending  + accepted(id)        → move queued      { requestId, nextCheckAt: now + CHECK_GAP_S }
 *   pending  + deferred(s)         → wait now + clamp(s, 5, 300)
 *   pending  + rejected(err)       → move failed      { error, completedAt, costUsd: "0" }
 *   pending  + clock               → move failed      { error: "Higgsfield가 30분 동안 요청을 받지 않았습니다" }
 *   live     + running(s)          → move s if RANK[s] > RANK[current], else none
 *   live     + completed(url, exp) → move completed   { resultUrl, expiresAt, completedAt, costUsd: price × durationS }
 *   live     + ended(s, err, exp)  → move s           { error, expiresAt, completedAt, costUsd: "0" }
 *   live     + missing             → move failed      { error: "request not found", completedAt, costUsd: "0" }
 *   any      + cancel              → move canceled    { completedAt, costUsd: "0" }
 *   terminal + anything            → none
 */
function decide(gen: Generation, obs: Observation, ctx: { now: Date; pricePerSecUsd: number }): Step {
  throw new Error("not implemented");
}

/**
 * The only write to generations.status after insert:
 *   UPDATE generations SET status = $to, <patch> WHERE id = $id AND status = ANY(predecessorsOf($to)) [AND extraGuard] RETURNING *
 * Zero rows: another actor moved the row at least as far. Reread, moved = false.
 */
async function apply(
  gen: Generation,
  step: Extract<Step, { kind: "move" }>,
  extraGuard?: SQL,
): Promise<{ row: Generation; moved: boolean }> {
  throw new Error("not implemented");
}

async function settleAs(gen: Generation, reason: SettleReason): Promise<Generation> {
  throw new Error("not implemented");
  // TODO: p = POLICY[reason]
  //       if gen.status === "pending": if reason === "hook" throw RetryLater; row = await submitPending(gen)
  //       else if isLive(gen.status): { row, moved } = await refresh(gen, p); if moved && !isLive(row.status) run(onTerminal(row), p.copy)
  //       if row.status === "completed" && !row.storagePath && row.requestId && storage.storageEnabled(): run(storeVideo(row), p.copy)
  //       return row
  //   where run(task, "after") = after(() => task) and run(task, "inline") = await task
}

async function submitPending(gen: Generation): Promise<Generation> {
  throw new Error("not implemented");
  // TODO: if now - createdAt > SUBMIT_DEADLINE_MS → apply(decide(gen, clock))
  //       claim: UPDATE SET next_check_at = now() + SUBMIT_LEASE_S WHERE id AND status = 'pending' AND next_check_at <= now()
  //       not claimed → reread and return
  //       args = buildArguments(findModel(gen.modelId), gen.prompt, gen.params, gen.imageRefs, gen.videoRefs)
  //       outcome = hf.submit(ownerKey(gen.userId), gen.modelId, args, { idempotencyKey: gen.id, webhookUrl: hookUrl(gen.id) })
  //       step = decide(...); move → apply; wait → UPDATE SET next_check_at = until WHERE id AND status = 'pending'
}

async function refresh(gen: Generation, p: Policy): Promise<{ row: Generation; moved: boolean }> {
  throw new Error("not implemented");
  // TODO: claim: UPDATE SET next_check_at = now() + CHECK_GAP_S
  //              WHERE id AND status IN ('queued','in_progress') AND (p.forceCheck OR next_check_at <= now()) RETURNING id
  //       not claimed → { row: gen, moved: false }
  //       try state = hf.status(ownerKey(gen.userId), gen.requestId)
  //       catch ProviderUnavailable → p.surfaceProviderErrors ? throw RetryLater : { row: gen, moved: false }
  //       price = state.kind === "completed" ? priceFor(gen.modelId) : 0
  //       step = decide(gen, { source: "status", state }, { now, pricePerSecUsd: price }); none → { row: gen, moved: false }
  //       return apply(gen, step)
}

/** Claim, copy, record. Safe to call from any number of actors; only the claimant copies. */
async function storeVideo(gen: Generation): Promise<Generation> {
  throw new Error("not implemented");
  // TODO: claim: UPDATE SET mirror_attempts = mirror_attempts + 1,
  //                  mirror_next_at = now() + greatest(MIRROR_LEASE_S, least(60 * 2 ^ mirror_attempts, 21600)) * interval '1 second'
  //              WHERE id AND status = 'completed' AND request_id IS NOT NULL AND result_url IS NOT NULL
  //                AND storage_path IS NULL AND (mirror_next_at IS NULL OR mirror_next_at <= now())
  //                AND (expires_at IS NULL OR expires_at > now())
  //              RETURNING *
  //       not claimed → reread and return
  //       res = fetch(resultUrl, { signal: AbortSignal.timeout(COPY_TIMEOUT_MS) }); refuse content-length > MAX_COPY_BYTES
  //       bytes = new Uint8Array(await res.arrayBuffer())
  //       key = storage.videoKey(gen.id); storage.putVideo(key, bytes, res.headers.get("content-type") ?? "video/mp4")
  //       console.info(JSON.stringify({ evt: "video_stored", id, bytes, fetchMs, uploadMs, attempt }))
  //       UPDATE SET storage_path = key, size_bytes = bytes.byteLength, mirror_error = NULL WHERE id RETURNING *
  //       catch → UPDATE SET mirror_error = msg WHERE id (the claim already pushed mirror_next_at ahead)
}

/** Ref cleanup (unchanged logic from cleanupRefs), then the copy for completed rows. Runs once per terminal move. */
async function onTerminal(row: Generation): Promise<void> {
  throw new Error("not implemented");
}

async function ownerKey(userId: number): Promise<hf.ApiKey> {
  throw new Error("not implemented"); // decrypt users.api_key_enc; missing key on a pending row → failed "API 키 없음"
}

function hookUrl(generationId: string): string | null {
  throw new Error("not implemented");
  // TODO: base = PUBLIC_BASE_URL ?? (VERCEL_PROJECT_PRODUCTION_URL && `https://${...}`); none (local dev) → null
  //       `${base}/api/hooks/higgsfield?g=${id}&t=${signToken("hf-hook", id)}`; deterministic, so every resend is identical
}

async function priceFor(modelId: string): Promise<number> {
  throw new Error("not implemented"); // unchanged
}
```

`syncStatus`, `TERMINAL` and the exported `cleanupRefs` path are deleted. `ownedRows(user, ids)` lives in `src/app/api/generations/route.ts` next to the existing `ownRow`, because ownership is the route's auth concern.

### Routes

```ts
// src/app/api/hooks/higgsfield/route.ts (new)
export const maxDuration = 300; // after() copies run inside this budget; MIRROR_LEASE_S assumes it
export async function POST(req: Request): Promise<Response> {
  const outcome = await onProviderHook(new URL(req.url));
  return new Response(null, { status: { done: 204, unauthorized: 401, retry: 503 }[outcome] });
}

// src/app/api/cron/settle/route.ts (new)
export const maxDuration = 300;
export async function GET(req: Request): Promise<Response> {
  throw new Error("not implemented");
  // TODO: secret = process.env.CRON_SECRET; if !secret or header !== `Bearer ${secret}` → 401
  //       return Response.json(await sweep({ deadline: Date.now() + 240_000 }))
}

// src/app/api/generations/route.ts
export const maxDuration = 300; // the batched poll schedules copies with after()
// GET: ?ids=a,b,c (max 24) → ownedRows + settle each; without ids → the existing feed query, unchanged
// POST: validation unchanged → submitGeneration → 201 queued | 202 pending | 502 failed (item included in every case)

// src/app/api/generations/[id]/route.ts
export const maxDuration = 300;
// GET: ownRow → settle → publicGeneration (any authorized viewer may trigger it; the owner's key is used server-side)
// DELETE: ownRow, owner only → cancelGeneration
```

`proxy.ts` needs no change, because its matcher never covers `/api/*` (verified).

### Client

```ts
// Playground.tsx: one request per tick for all live items; the delay survives live-set changes
const delayRef = useRef(2000);                    // reset to 2000 only after this tab submits
useEffect(() => {
  if (!liveKey) return;
  // TODO: tick = fetch(`/api/generations?ids=${liveKey}`) → items.forEach(upsert)
  //       delayRef.current = min(10_000, delayRef.current * 1.5) + jitter; setTimeout(tick, delayRef.current)
}, [liveKey]);
// LIVE → isLive(); g.resultUrl → g.video?.url; download href → g.video?.downloadUrl
// generate(): upsert body.item even when !res.ok so failed and pending rows appear in the feed; show body.error

// Gallery.tsx: tiles attach src only near the viewport, the largest egress lever once videos are ours
function useNearViewport(rootMargin: string): { ref: RefObject<HTMLElement>; near: boolean } {
  throw new Error("not implemented"); // IntersectionObserver, sticky once true
}
// <video src={near ? g.video?.url : undefined} preload="metadata" … />
// Detail: "보관" row reads "영구" for kind "stored", "<date>까지 · N일 남음" for kind "provider"

// LogsPanel.tsx: open.video?.url. admin CSV: result_url column ← i.video?.url
```

### `vercel.json` (new)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"],
  "crons": [{ "path": "/api/cron/settle", "schedule": "* * * * *" }]
}
```

On Hobby the schedule must become daily (`0 18 * * *`, 03:00 KST). README says so.

### Levers (scripts, committed)

```ts
// scripts/fake-higgsfield.ts: `npm run fake:hf`, node:http on FAKE_HF_PORT (4010)
//   POST /<model id…>              Idempotency-Key → same request_id on repeat, 422 on a different body;
//                                  FAKE_HF_429_FIRST_N per key (Retry-After: FAKE_HF_RETRY_AFTER_S); reads ?hf_webhook
//   GET  /requests/:id/status      queued → in_progress → completed after FAKE_HF_DURATION_MS (range "60000-240000")
//   POST /requests/:id/cancel      cancelable while queued
//   GET  /media/:id.mp4            FAKE_HF_VIDEO_BYTES deterministic bytes, FAKE_HF_MEDIA_DELAY_MS to simulate a stall
//   webhook sender                 FAKE_HF_DROP_WEBHOOKS (fraction), FAKE_HF_DUP_WEBHOOKS (send each twice)
//   POST|PUT /storage/v1/object/:bucket/*   Supabase Storage subset: keeps sha256 and size, counts writes per key
//   GET  /_stats                   accepted submits per idempotency key, status calls per key per second, hooks sent, uploads per key

// scripts/lifecycle-check.ts: against a local Postgres plus the fake; exits non-zero on the first failed assertion
// scripts/burst.ts: 20 users × 15 submits through the real routes of a local `next dev`, signed session cookies
```

## Files touched

| File | PR | Change |
|---|---|---|
| `src/components/Playground.tsx` | 1, 3, 4, 6 | drop `.map(Number)`; batched poll and persistent delay; `video`; pending rows and errors in the feed |
| `scripts/mock.ts` | 1 | one `[목업]` row with status `in_progress` and no request id, so the poll is observable |
| `.claude/skills/verify-video-gen-studio/journeys/playground.mjs` | 1 | assert poll requests return 200 |
| `src/lib/higgsfield.ts` | 2, 3, 5 | `HIGGSFIELD_BASE_URL`; domain outcomes; `webhookUrl` |
| `scripts/fake-higgsfield.ts`, `package.json` (`fake:hf`) | 2 | new lever |
| `src/lib/generation-status.ts` | 3, 6 | new vocabulary; `pending` in 6 |
| `src/lib/format.ts`, `src/components/StatusBadge.tsx`, `src/components/admin/LogsPanel.tsx` | 3, 4 | import labels and tones; `video` |
| `src/db/schema.ts`, `drizzle/0001…`, `0002…`, `0003…` | 3, 4, 6 | columns above |
| `src/lib/generations.ts` | 3, 4, 5, 6 | the owner |
| `src/app/api/generations/route.ts`, `[id]/route.ts` | 3, 6 | thin shells over the owner; batched GET |
| `eslint.config.mjs` | 3 | `no-restricted-syntax` for `.update(schema.generations)` outside the owner |
| `scripts/lifecycle-check.ts` | 3 | race and crash assertions |
| `src/lib/storage.ts`, `package.json` (`@supabase/storage-js`) | 4 | new |
| `src/components/Gallery.tsx`, `src/app/api/admin/generations/route.ts` | 4 | `video` union, lazy src, CSV |
| `src/lib/crypto.ts`, `src/app/api/hooks/higgsfield/route.ts` | 5 | token and hook route |
| `src/app/api/cron/settle/route.ts`, `vercel.json` | 5 | sweep trigger, region, cron |
| `scripts/burst.ts` | 6 | end-to-end burst proof |
| `.env.example`, `README.md` | 2 to 6 | `HIGGSFIELD_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEO_BUCKET`, `PUBLIC_BASE_URL`, `CRON_SECRET`; 동작 원리 and Free 티어 sections |

## Storage decision

**Decision.** Store videos in Supabase Storage on the Pro plan ($25/mo), in a public bucket `videos`, keyed `<generation uuid>.mp4`, with a one-year Cache-Control. Supabase Free cannot hold the launch burst. Vercel Blob is viable and slightly cheaper, but it loses on region and on consolidation. R2 wins only past egress volumes this team will not reach.

Size guesses per video (guess, grounding ranges; Hailuo and 720p are my extrapolations):

| Output | Guess | Range |
|---|---|---|
| Seedance 480p 5 s | 2 MB | 1-3 |
| Hailuo 768p 6 s | 4 MB | 2-6 |
| Seedance 1080p 10 s | 18 MB | 10-25 |
| Seedance 4k 15 s | 100 MB | 50-150 |

Mixes. **A practice-heavy** (50% 480p, 30% Hailuo, 15% 1080p, 5% 4k): 1 + 1.2 + 2.7 + 5 = 9.9 MB average. **B delivery-heavy** (20% 480p, 20% Hailuo, 45% 1080p, 15% 4k): 0.4 + 0.8 + 8.1 + 15 = 24.3 MB average. **C** is all 4k 15 s at 150 MB, as an upper bound.

| | A | B | C |
|---|---|---|---|
| One 300-video burst | 3.0 GB | 7.3 GB | 45 GB |
| 12 months at 300/mo, kept forever | 36 GB | 88 GB | 540 GB |
| 12 months at 1,500/mo, kept forever | 178 GB | 437 GB | 2.7 TB |
| Supabase Pro storage overage in month 12 at 1,500/mo ($0.0213/GB over 100 GB) | $1.7/mo | $7.2/mo | $55/mo |

Egress (guess model). Each video is fetched in full about 5 times: the feed autoplay, gallery hover, the detail view, one download, and one colleague or admin view.

- Plays at 300/mo come to 15 GB (A) or 36 GB (B). At 1,500/mo they come to 74 GB (A) or 182 GB (B).
- The gallery grid today renders up to 120 `<video preload="metadata">` tiles per open (verified, `gallery/page.tsx` limit 120, `Gallery.tsx`). At about 0.5 MB fetched per tile (guess), that is 60 MB per open. At 20 users × 2 opens × 22 days, it is about 53 GB/mo of pure overhead. The `useNearViewport` change cuts it to roughly 12 tiles per open, about 5 GB/mo (inferred).
- B at 1,500/mo with the lazy grid comes to about 190 GB/mo. That is under Pro's 250 GB uncached quota, and Pro adds 250 GB of cached egress (verified, fetched Supabase egress doc). Overage would be $0.09/GB uncached and $0.03/GB cached.

Why not Supabase Free (verified quotas). It has 1 GB of storage, which is 100 videos of mix A or 41 of mix B, so the first burst overflows it 3 to 7 times. Its 50 MB upload cap rejects most guessed 4k 15 s results. Its 5 GB + 5 GB egress is gone in one burst of mix B. It also pauses the project, including the database, after a week idle.

Why not Vercel Blob (verified, fetched pricing, iad1 rates; icn1 rates are "Regional" and were not fetched). Storage is $0.023/GB-mo, data transfer $0.05/GB, Fast Origin Transfer $0.06/GB on cache misses, advanced operations $5 per 1M, simple operations $0.40 per 1M. Pro pays these out of the $20 monthly credit, then on demand. B at 1,500/mo in month 12 comes to about 437 × 0.023 + 190 × 0.05 + 0.3 × 190 × 0.06 ≈ $23/mo, so the money is the same order as Supabase. Blob loses for three reasons. Supabase Pro is needed anyway, because the database must not pause and must keep backups for a company tool. Supabase's bucket sits in Seoul next to the database and the users. And one vendor console beats two. Blob stays in use for large reference uploads, unchanged.

Why not Cloudflare R2 (from memory, not fetched: about $0.015/GB-mo with no egress fee). It is the cheapest at volume, but it needs a new vendor, new keys, and a custom domain or r2.dev for public reads. Switch when Supabase egress overage exceeds the $25 plan price for two consecutive months. Because the row stores a key rather than a URL, the switch is an object copy plus a `storage.ts` change.

What changes for the gallery and feed. Today `<video src>` and the download link point at the Higgsfield CDN. Higgsfield pays that egress, the file dies after 7 days, and the gallery shows 보관 N일 남음. The cross-origin `download` attribute is ignored, so 다운로드 opens the video instead of saving it (known browser behavior, not tested here). After PR 4, `video.url` points at the Supabase public URL within seconds of completion. The Higgsfield URL fills only that gap. Egress is now on our bill, which is why the grid attaches `src` lazily. 보관 N일 남음 appears only for not-yet-stored videos, and 다운로드 uses `?download=` and saves the file.

The 300 s limit and the copy. A 100 MB copy takes about 2 to 10 s from `icn1` and about 5 to 30 s from `iad1`, where the upload leg crosses the Pacific (guess, unmeasured). Either is far inside 300 s. The 240 s copy timeout, the 360 s lease and the back-off (6 min rising to 6 h, about 35 tries inside the 7-day window) cover a slow day. The PR 4 probe and the `video_stored` log replace the guess with a number.

Signed-URL alternative. Use a private bucket and `createSignedUrls(keys, 3600)` in the gallery page and `publicGeneration`. Choose it only if videos must not be shareable by link. Its costs are a storage round trip per page render, URLs that change every render (more egress, because caches miss), and `<video>` sources that expire in long-open tabs.

## Burst arithmetic

Assumptions (guess). 300 submissions in 1 to 3 hours. A generation runs 120 to 300 s. A worst-case peak has all 20 users clicking 15 times in the first minutes, so 300 rows are live at once if Higgsfield accepts them all.

| Quantity | Today | After |
|---|---|---|
| Client requests per user with 15 live items | about 15 per 4 s (delay resets on every live-set change), so 3.75 req/s | 1 batched request per tick, settling at 1 per 10 s, so 0.1 req/s |
| Peak app requests, 20 users | about 75 req/s | about 2 to 5 req/s (the delay resets only on this tab's own submit) |
| Higgsfield status calls at peak | one per poll, about 75/s, so 3.75/s per key | at most 1 per live row per 15 s: 300/15 = 20/s total, 1/s per key, plus 1 per webhook |
| DB queries per poll request | 3 (user, row, update) per item | 2 + 1 claim per due item, per batch |
| Connection time per second at peak from `iad1` (about 180 ms per query, guess) | 75 × 3 × 0.18 ≈ 40 connection-seconds/s, so roughly 8 instances' pools of 5 saturated | about 5 × 4 × 0.005 ≈ 0.1 from `icn1` |
| Steady burst (300 over 2 h, 3 min each) | about 7.5 live on average, about 2 req/s | well under 1 req/s |
| Vercel invocations per month | polls only | at most 9k polls + 300 submits + 300 hooks + 43,200 cron ticks, about 53k |

The Supabase pooler (about 200 connections on Micro, verified via grounding) and postgres-js `max: 5` per instance are not the bottleneck even today. Today's real risk at peak is per-key status-call volume against an undocumented Higgsfield limit, plus transpacific round trips stacking up in each instance's 5-connection pool. Batching, the 15 s claim and `icn1` remove both (inferred, to be measured by `scripts/burst.ts` and a 30-run latency comparison).

## Hobby vs Pro

| | Pro (target) | Hobby (worse, not broken) |
|---|---|---|
| Webhook doorbell, `after()` copy | yes | yes, identical |
| Sweep | every minute | daily; vercel.json schedule changed |
| Missed webhook, tab closed | converges within about 1 min | converges on next visit or the daily sweep |
| Copy before the 7-day expiry | within seconds (hook) or 1 min (sweep) | within seconds (hook), else the daily sweep, still inside 7 days |
| Deferred submit, tab closed | resent within 1 min | resent on next visit; past 30 min it fails with a reason |
| maxDuration | 300 s default (800 available) | 300 s |
| Terms | commercial use allowed | non-commercial only (verified, README); the real reason to be on Pro |

## PR split

Each PR is one change with its own proof, in dependency order.

1. **Fix the feed poll ids.** Drop `.map(Number)` in `Playground.tsx`. Add one live `[목업]` row to `scripts/mock.ts`. Proof: the playground journey records the poll's network requests. Before the fix it shows `/api/generations/NaN` returning 500. After, it shows `/api/generations/<uuid>` returning 200. Ships alone, today.
2. **Fake Higgsfield lever.** `HIGGSFIELD_BASE_URL` in `higgsfield.ts`, plus `scripts/fake-higgsfield.ts` and `npm run fake:hf`. Proof: against a local Postgres and the fake, a playground submit (`VGS_ALLOW_SPEND=1`, which spends nothing here) reaches 완료 through today's poll path, and `/_stats` shows one accepted submit. This scaffolds every later proof (per foundational-thinking and build-the-lever).
3. **One lifecycle owner.** Adds `generation-status.ts`; parses `higgsfield.ts` into domain outcomes; adds `next_check_at`; adds `decide` / `apply` / claims; routes cancel through the owner; adds the batched `GET ?ids=` and a delay that survives live-set changes; deletes `syncStatus`; adds the lint rule. Submit stays submit-then-insert, but the row id is minted first and used as the Idempotency-Key. Proof: `scripts/lifecycle-check.ts` asserts the following. 50 concurrent `settle` calls on one row produce at most 1 fake status call per 15 s and exactly one terminal write (`completed_at` and cost set once). Duplicated completions converge. A cancel racing a completion ends in the provider's state. `npm run lint` fails on a planted second writer.
4. **Copy to Supabase Storage.** Adds `storage.ts`, the media columns, `storeVideo` with lease and back-off, scheduling via `after()` on the poll path, the `PublicVideo` union across Playground, Gallery, LogsPanel and CSV, the lazy gallery `src`, and README bucket setup. Proof, with the fake:
   - The object's sha256 and size match the fake's media, and `size_bytes` is recorded.
   - The gallery journey plays from the Supabase host and shows 영구.
   - A stalled media fetch (`FAKE_HF_MEDIA_DELAY_MS` > 240 s) leaves `mirror_error` set, and the copy succeeds after the lease.
   - A doubled trigger produces exactly one upload in `/_stats`.
   - On a preview deployment against the real bucket, a `[목업]`-tagged probe row (request id `probe-…`, `result_url` pointing at a public 100 MB mp4) produces a `video_stored` line with `fetchMs` and `uploadMs`. That answers the copy-time question before any key exists.
5. **Server-side triggers.** Adds `signToken`, the `hf_webhook` registration, `onProviderHook` and the hook route; adds `sweep` and the cron route with `CRON_SECRET`; adds `vercel.json` with `icn1` and the per-minute cron; adds the README 동작 원리 and Hobby notes. Proof, with the fake:
   - After a submit the page is closed. The row reaches completed and stored with zero client polls after close (`/_stats` shows status calls only from hooks).
   - Duplicated hooks produce one transition.
   - A bad token returns 401 and triggers no status call.
   - A hook for a still-pending row returns 503, and the fake's redelivery succeeds.
   - With `FAKE_HF_DROP_WEBHOOKS=1`, rows converge within two sweep ticks (curl the cron route locally; Vercel cron logs in production).
   - Rows stuck since `d2fdc8a` heal on the first production tick.
   - The region move is measured as p50 and p95 of `GET /api/generations?ids=` over 30 runs before and after, with database RTT named as the limiter (per explain-the-number).
6. **Pending and deferred submits.** Adds `pending` to the tuple, which makes the build demand its label and tone. Submit becomes insert-first, 429/5xx become a wait, the 30-minute deadline applies, and pending cancel is guarded. Proof: `scripts/burst.ts` runs 20 fake users × 15 submits with `FAKE_HF_429_FIRST_N=5`, 10% dropped hooks and duplicated hooks, then checks:
   - All 300 rows end terminal, and every completed row is stored.
   - `/_stats` shows exactly one accepted submit per idempotency key and at most 1 status call per key per second.
   - No user ever saw a 502 for a 429.
   - The script reports p50 and p95 click-to-완료.

   This PR lands before the team's launch burst. The cost of skipping it is users re-clicking through 큐가 가득 참 errors against limits nobody has measured.

## Red-flag screen

- **Shallow module.** Not present. The owner exposes seven verbs and hides the protocol, claims, transitions, cost, cleanup and the copy.
- **Information leakage.** Removed. Wire types are private to `higgsfield.ts`, the URL format is private to `storage.ts`, and there is one status vocabulary.
- **Temporal decomposition.** Avoided. Submit, check and copy live in one module because they guard one row's invariants, not in phase-named files.
- **Pass-through methods.** Not present. Routes are thin shells that map auth and HTTP codes. `settle` is the one-line exception, and it exists to keep the reason parameter private.
- **Split ownership.** Fixed. Today `syncStatus` and the DELETE route both write `status` (verified). After PR 3, `apply` is the one writer and lint enforces it.
- **Two ways to do one task.** Avoided. Poll, hook and sweep all reach `settleAs`, and the webhook body is never parsed as a second source of state.
- **Importable internals.** `decide`, `apply`, the claims and `RetryLater` are unexported.
- **Hand-synced lists.** Fixed. The four hand-written live sets become `isLive()`, and the labels and tones become exhaustive Records.

## Principles applied

- **Attack the premise.** I wrote "a function waits for Higgsfield" down and tested it against the code. It is false, so the design spends nothing on long-running functions and goes after the real binders: no server-side trigger, a broken poll, the 7-day expiry, and the copy.
- **Make operations idempotent.** Conditional UPDATEs ranked by `RANK`, time leases judged against `maxDuration`, upsert to deterministic keys, and Idempotency-Key = row id with the body rebuilt from the row.
- **Separate before serializing shared state.** The lifecycle and media columns are written by different steps, so they never conflict. Copies race harmlessly, so the lease exists to save bandwidth, not for correctness.
- **Model the domain.** The `RANK` table, the `decide` transition table and the `POLICY` table replace scattered `status === "queued" || …` checks.
- **Boundary discipline.** Higgsfield JSON is parsed once in `higgsfield.ts`. The webhook payload is never trusted.
- **Type system discipline.** Branded `ApiKey`, `RequestId` and `ObjectKey`, a `PublicVideo` union, and `Record<GenerationStatus, …>`.
- **Laziness protocol and subtract before you add.** Drop `blob_url` and `syncStatus`. No signature verification, no own queue, no Workflow, no new index, no streaming upload.
- **Foundational thinking and build the lever.** The fake Higgsfield (PR 2) comes before any feature, because no account has a key and every later proof needs it.
- **Encode lessons in structure.** The lint rule keeps a single writer. Exhaustive Records make a new status fail the build.
- **Experience first.** No 7-day loss, no 429 errors in a burst, a download button that downloads, and pages served from Seoul.
- **Explain the number.** Every size and egress figure is labeled a guess. `size_bytes`, the `video_stored` timings and the 30-run region comparison are the levers that replace them.
- **Sequence verifiable units.** Six PRs, each with a red/green proof, ordered so the lever exists before the code it proves.
- **Redesign from first principles.** Had webhooks and copying been day-one requirements, the row would have been the job from the start. That is the shape here, rather than a mirror bolted onto `syncStatus`.
