# Grounding: make the generation phase robust on Vercel for a 20-person team

Repo: `C:\Users\a\project_tpc\video-generation-workflow-page\web` (Next.js 16 App Router, React 19, Drizzle + postgres-js on Supabase Postgres, deployed to Vercel). Korean UI. Read the files named below; do not rely on this summary alone.

## The user's request (verbatim intent)

"다음의 제약조건을 넘어서 생성 페이즈가 잘 작동하게 만들어줘"

1. Deploying to Vercel. Functions have a 300 s runtime limit. A video generation call at Higgsfield may or may not exceed 300 s.
2. 20 people on an early platform. At first they may fire many generations in a short time (think 300 videos within hours).
3. Supabase is intended for storing and showing the generated videos. Review whether that is the right choice when 20 people make 300 videos.

Deliverable of the overall program is a plan (multi-phase, one section per PR). Your job is one candidate design package for the shape of the generation pipeline, which that plan will be written from.

## Current pipeline (read these files)

- `src/app/api/generations/route.ts` POST: validates, calls Higgsfield submit (seconds), inserts row `status=queued` with `requestId`. 429 from Higgsfield is surfaced to the user as a 502 with "큐가 가득 참, N초 후 재시도".
- `src/app/api/generations/[id]/route.ts` GET: returns the row; if the row is live (queued/in_progress) and owned by the caller, calls `syncStatus` which does ONE Higgsfield status call and persists changes. DELETE cancels while queued.
- `src/lib/generations.ts` `syncStatus`: writes terminal status, `resultUrl` (Higgsfield CDN URL), `expiresAt`, cost = price × durationS; cleans up Vercel Blob reference uploads. `publicGeneration` returns `blobUrl ?? resultUrl` as the playable URL. The `blobUrl` column exists but nothing writes it today (it was reserved for a Vercel Blob mirror).
- `src/lib/higgsfield.ts`: submit / status / cancel / upload. Submit takes an `Idempotency-Key`.
- `src/db/schema.ts`: `generations` has `status` enum queued|in_progress|completed|failed|nsfw|canceled, `requestId`, `resultUrl`, `blobUrl`, `expiresAt`, `durationS`, `costUsd`, `error`, `createdAt`, `completedAt`; indexes on (userId, createdAt) and (status).
- `src/components/Playground.tsx`: the browser polls `GET /api/generations/:id` for live ids with backoff 2 s → ×1.5 → 10 s cap, only while the tab is open. On load it fetches the recent feed and resumes polling for live rows.
- `src/components/Gallery.tsx`: lists completed rows, plays `resultUrl`, shows "보관 N일 남음" from `expiresAt`.
- `src/db/index.ts`: postgres-js pool `max: 5`, `prepare: false`, Supabase transaction pooler (port 6543), cached on globalThis.
- `README.md`: states no server-side cron because Hobby allows one cron per day; results live only 7 days at Higgsfield; Blob mirroring was left off because of the Hobby 1 GB Blob cap.
- Each user has their own Higgsfield API key (encrypted in `users.api_key_enc`). The server decrypts it per request.

## Verified facts (fetched 2026-10-28)

Higgsfield (docs.higgsfield.ai, pages `docs/how-to/webhooks.md`, `docs/concepts/requests.md`):
- Generation is asynchronous. Submit returns immediately with `request_id`, `status_url`, `expires_after` (604800 s = 7 days by default). Output files are deleted after `expires_at`; copy media to your own storage to keep it longer.
- Webhooks exist. Add query param `hf_webhook=<url-encoded HTTPS URL>` to the generation POST. Higgsfield POSTs JSON `{request_id, status, error, payload, expires_at?}` on terminal status (completed / failed / nsfw). Video result is `payload.video.url`. Receiver must answer within 10 s. 2xx = delivered. 5xx/network errors are retried for up to 2 hours. 4xx not retried. Duplicates possible. Deliveries are signed per the Standard Webhooks spec (headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; secret `whsec_…` revealed once in the Higgsfield Console, one per account; unsigned until revealed). npm package `standardwebhooks` verifies. Fallback is polling the status endpoint.
- Statuses: queued (cancelable) → in_progress → completed | failed | nsfw | canceled.
- Rate limits, per-key concurrency and queue depth are NOT documented. The 429 with Retry-After seen in our code came from the python SDK behavior.

Vercel (vercel.com/docs/functions/limitations, docs/cron-jobs/usage-and-pricing, docs/workflows):
- Max duration: Hobby 300 s (fixed). Pro 300 s default, 800 s max, 1800 s beta. Fluid compute, Node 24. Request/response body 4.5 MB (outbound fetches are not limited by this). Memory 2 GB default.
- Cron: Hobby once per day (±59 min). Pro every minute. 100 crons per project.
- Vercel Workflows (`npm i workflow`, `'use workflow'` / `'use step'`, sleep and hooks for external events) exist for unlimited-duration durable logic, usage-priced, built on Vercel Queues. Treat as beta-ish and as a heavier dependency.
- `@vercel/functions` `waitUntil()` lets a handler respond and keep doing work until maxDuration (not re-fetched this session; treat as known API).
- Hobby plan is non-commercial by ToS; a 20-person company tool belongs on Pro ($20/seat). README already says this.

Supabase (supabase.com/pricing, docs/guides/storage/uploads/standard-uploads):
- Free: 500 MB DB, 1 GB file storage, 5 GB egress, 50 MB max upload, paused after 1 week idle. Pro $25/mo: 8 GB disk, 100 GB storage, 250 GB egress included, overage $0.0213/GB storage and $0.09/GB egress, 500 GB max upload, pooler ~200 connections on Micro.
- Standard upload API (`supabase.storage.from(bucket).upload(path, body, {upsert, contentType})`) is "ideal" ≤ 6 MB but technically up to 5 GB; TUS resumable recommended above 6 MB. Upsert to an existing path is allowed with `upsert: true` (last writer wins).
- The project currently has only `DATABASE_URL` configured. Using Storage needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or an S3-compatible key) and a bucket. Nobody has measured a real result file size yet. Rough guess only: 480p 5 s ≈ 1–3 MB, 1080p 10 s ≈ 10–25 MB, 4k 15 s ≈ 50–150 MB. Label all such numbers as guesses until measured.

## Premise check (write this into your rationale and argue with it)

Constraint 1 as stated ("the generation API may exceed 300 s so the function times out") does not bind the current design. No function waits for the generation. Submit and each status poll finish in seconds. What the 300 s limit really constrains: (a) any server step that downloads a result and uploads it to storage must fit in one invocation, (b) nothing server-side runs when no browser is polling, so a closed tab leaves rows stuck in queued/in_progress until the next page load, and cost/expiry are recorded late or never, (c) a result not copied within 7 days is lost.

Constraint 2 (burst): 300 submissions in an hour means ~300 × (20–40 polls) ≈ 10k polling requests/hour ≈ 3 req/s at the Next.js API, each doing a DB read and (today) a Higgsfield status call. Higgsfield per-key limits are unknown. Supabase pooler and postgres-js `max: 5` per instance are not a bottleneck at this scale, but state that with numbers.

Constraint 3 (Supabase for video storage): decide Free vs Pro vs Vercel Blob vs other with numbers for 300 videos/month at the guessed sizes, and for 20 viewers. Name what the gallery/feed does today with Higgsfield CDN URLs and what changes.

## Defaults already taken (challenge with evidence if you disagree)

- Target Vercel Pro. Say explicitly what degrades on Hobby and keep the design working there (worse, not broken).
- Keep the existing client polling loop as a fallback and for local development (no public URL for webhooks on localhost).
- Keep per-user Higgsfield keys. No shared queue of our own in v1 unless you show it is needed.
- Store mirrored videos in Supabase Storage. Public bucket with unguessable `<generation uuid>.mp4` paths by default; note the signed-URL alternative.
- Retention: keep mirrored videos indefinitely for now.

## Open empirical questions you cannot settle here (list them, do not guess an answer)

- Real result file sizes per model/resolution/duration.
- Whether Higgsfield delivers the webhook to a Vercel route reliably and what its per-key concurrency limit is. No account here has an API key assigned, so this cannot be run now.
- Time to copy a 100 MB result from Higgsfield CDN into Supabase Storage from a Vercel function in `iad1` (Supabase is in ap-northeast-2).

## What to produce

Read `C:\Users\a\.claude\plugins\cache\cursor-plugins\pstack\0.15.36\skills\architect\SKILL.md` and its `references/runner-prompt.md`, `references/rationale-template.md`, `references/design-red-flags.md`. Produce one candidate design package in your output directory as `design.md`:

1. Rationale per the template (Problem, Usage from the caller's view first, Shape, Tradeoffs, Alternatives, Open questions, Next step). Leave "Synthesis decision" empty.
2. Type sketch and signatures (TypeScript, `not implemented` bodies) for every new or changed module, plus the schema diff (Drizzle) and the list of files touched. Name the single owner of the generation lifecycle transition and show that running a transition twice, or a webhook and a poll racing, converges.
3. The storage decision with the arithmetic.
4. A proposed PR split (3–6 PRs), each one change with its own proof, in dependency order.

Do not implement anything. Do not edit the repo. Write only inside your output directory.
