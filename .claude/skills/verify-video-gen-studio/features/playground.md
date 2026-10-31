# Playground

The playground is where a member writes a prompt, picks Seedance 2.0 or MiniMax H3 and a mode (text, frames, references), attaches what that mode takes, sees the estimated cost, and generates; each generation appears as a turn in the stream, polled until it ends. [Composer](./composer.md) covers the composer's own behaviour in depth; this recipe covers the models, the modes against the fake, the generate gate and polling.

Every handle below is a message key that the journey reads with `ev.t`, so the recipe runs in Korean, English and Chinese. The Korean text follows in parentheses. Model names, ratios such as `9:16`, resolutions and the `—` placeholder are the same in every language.

## Sub-features

- `pg-composer` region `playground.composer` (생성 입력창) holds the prompt (`playground.prompt`), the model chip, + (`playground.refs.add`), the settings chip, the estimate and `playground.generate` (생성하기); region `playground.stream` (생성 기록) holds the turns.
- `pg-model-menu` dialog `playground.modelMenu` (모델과 방식) lists exactly the enabled catalog models under their output tab, Seedance 2.0 · ByteDance and MiniMax H3 · MiniMax for video, with `playground.rateHint` when a rate is set. Hailuo is never offered.
- `pg-mode` a video model offers `mode.t2v`, `mode.i2v`, `mode.r2v` as `playground.kind.text` / `firstFrame` / `reference`; the chip reads the model and the mode picked. A reference added in text mode switches to references and says so (`playground.note.switched`).
- `pg-aspect-pills` Seedance's settings hold group `playground.aspect.label` with pills named `playground.aspect.pill` (`세로 9:16`); exactly one is `aria-pressed`, and the settings chip's summary reads it. Seedance frames have no pills.
- `pg-model-switch` MiniMax H3 starts on `playground.aspect.auto` (자동), offers `params.duration` 5 | 10 | 15 as pills (`playground.summary.duration`), has no `params.resolution`, and shows `families.h3.note` about the fixed 2K output. Switching models keeps the attachments.
- `pg-refs-add` + opens dialog `playground.refs.add` with `playground.refs.menuNote`; its image row opens the file picker; with a key the file uploads and a thumbnail appears in list `playground.refs.attached`, without one a `role=alert` explains; Esc closes and focus returns to +.
- `pg-blocker` when the request cannot go (H3 without a prompt, references with nothing attached, more images than the model takes) a `role=status` line says why (`errors.promptRequired`, `errors.referenceRequired`, `errors.tooManyImages`) and `playground.generate` is disabled.
- `pg-generate-gate` without an API key a status line reads `errors.noKey` and `playground.generate` is disabled; with one, it submits and a turn appears in the stream.
- `pg-generate-modes` against the fake: every model in every mode reaches its own Higgsfield endpoint with the right media fields (references: `image_urls` and `video_urls`; frames: `image_url` then `end_image_url`; text: none), the estimate the composer showed equals the row's cost, and every row completes.
- `pg-poll` while a turn of a thread this tab has shown is queued or in progress (the stream's thread first, at most 24 ids), the page sends one `GET /api/generations?ids=<uuid>,<uuid>` per tick with backoff (2 s, then ×1.5 up to 10 s, ±200 ms jitter that does not compound); every poll is a 200 whose `items` contain each requested uuid, the stream shows the `playground.feed.progress` line (생성 진행 중), and no poll goes out when nothing is live.

## How to get to it (user POV)

- Sign in; the app lands on `/playground`.
- Header nav `pages.playground` (플레이그라운드).
- A turn's `playground.actions.reuse` (다시) puts that generation's model, mode, prompt and settings back in the composer (attachments are not kept).

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- At least one model is enabled in 어드민 → 모델 · 단가 (both ship enabled).
- `public/mock/ref-landscape-1.jpg`, `ref-landscape-2.jpg` and `fixtures/clip-3s.webm` (in this skill) exist (committed).
- For `pg-generate-modes`: launch the app with `HIGGSFIELD_BASE_URL` and the Blob env pointing at `npm run fake:hf` (README → 가짜 Higgsfield로 돌리기), sign in as a member whose key is fake (`VGS_USER`/`VGS_PASS`; an admin can assign `fake-id:fake-secret` to itself in 어드민), and set `VGS_FAKE_HF` to the fake's base URL. Set the two models' rates in 어드민 first to check the estimate against the stored cost.
- Set `VGS_ALLOW_SPEND=1` only when a paid submit is wanted; the account then needs a Higgsfield key.
- For `pg-poll`, a live row must be on the stream's thread: `pg-generate-modes` rows count as live while they run, in the thread their first generation created. `npm run db:mock` rows (`[목업] 생성 중`, `MOCK_LIVE=3` for three) have no thread, so they sit in the earlier history and are polled only when the journey shows it. They have no request id, so no Higgsfield call ever happens for them.
- Pick the language with `VGS_LOCALE` (`ko-KR` by default, `en-US`, `zh-CN`).

- **Composer.** Sign in to `/playground`. Run `vgs run playground`; `01-composer` shows region `playground.composer`.
- **List models.** The model menu's video tab lists the models; the note in `log.md` lists them (Seedance 2.0 · ByteDance, MiniMax H3 · MiniMax when both enabled) (`model-menu`).
- **Modes.** Seedance in text mode offers three mode rows.
- **Pick portrait.** In Seedance's settings, click the pill containing `9:16` in group `playground.aspect.label`. It is the only pressed pill, `params.resolution` offers 480p, 720p, 1080p, 4k (`seedance-portrait`), and the settings chip's summary reads the portrait pill.
- **Switch model.** MiniMax H3's settings start on `playground.aspect.auto`, offer 5, 10 and 15 s, have no `params.resolution`, and show `families.h3.note` (`h3`).
- **Add a reference.** + opens dialog `playground.refs.add` (`add-menu`); its image row's file picker takes `public/mock/ref-landscape-1.jpg`. Either a thumbnail appears (key present) or a `role=alert` explains (no key). Esc closes the menu and focus is on + again (`after-pick`). With the thumbnail, the chip reads `mode.r2v` with `playground.note.switched`; 프레임 reads `mode.i2v` with no aspect pills (`start-frame`), and 텍스트 takes the image away with 되돌리기 offered.
- **Generate gate.** If the status line `errors.noKey` shows, `playground.generate` is disabled. With `VGS_FAKE_HF`, the next step runs. With a key and `VGS_ALLOW_SPEND=1`, `playground.generate` is clicked and a turn appears in the stream (`generate-gate`).
- **Every mode against the fake.** For each model the journey attaches two images and the 3 s clip in references (refusing to click `playground.generate` unless the uploads went to `VGS_FAKE_HF`), checks `playground.fact.inputVideo` with `3.0` for Seedance, and generates; then switches to 프레임, which keeps the two images as start and end frames, and generates; then 텍스트, and generates. For H3 it first clears the prompt with nothing attached and checks the status line with `playground.generate` disabled (`h3-blocked`). After each submit it reads the fake's `GET /_stats` `submits` for that row's Idempotency-Key: the endpoint, the media fields above, no `aspect_ratio` for Seedance image-to-video, and the estimate the composer showed against the row's `estimatedCostUsd`. It then waits until all six rows completed. `log.md` has one `pg-generate-modes` line per row with the body.
- **Watch the polling.** With a live row in the stream, the journey waits for two poll ticks and checks every id in every `GET /api/generations?ids=` batch it saw: the id is a live uuid from `GET /api/generations?thread=<the URL's thread>&limit=12` or one this run submitted, the status is 200, and the id is among the returned `items`. `log.md` gets `poll requests N, all 200` and the tick gaps; `poll.json` keeps every request. Without a live row it records `poll requests 0`. `poll` shows the stream with the request log overlaid by the harness. `VGS_POLL_WAIT_MS=30000` holds the page for 30 s so the backoff gaps can be read; `VGS_POLL_NAV=1` leaves for `pages.gallery` and comes back with Back (the header's `pages.playground` link would open a new thread), and the note records that no poll went out while away and how soon the first poll came back.
- **Proof.** `result.json` `ok: true`; `seedance-portrait.aria.txt` shows one pressed pill; six `pg-generate-modes` lines with the bodies; `log.md` has `poll requests N, all 200` (or `poll requests 0` when nothing is live).

## Gotchas

- The journey's own read-backs (`GET /api/generations?ids=` while it waits for the six rows) run in the page and count among the polls, so the tick gaps mix its 1 s reads with the page's backoff.
- Changing the model resets parameters to that model's defaults and keeps the attachments. MiniMax H3 takes 5 images, Seedance 6; over the limit the status line says so and `playground.generate` stays off.
- 프레임 takes images only and keeps the first two as start and end; anything else is taken away with 되돌리기 offered.
- The picker only takes `video/mp4`, and a video whose length the browser cannot read is refused before upload (`playground.upload.noLength`). The fixture is a VP9 clip handed to the picker as an mp4; Chromium reads its length, the fake stores any bytes, and real Higgsfield needs a real mp4.
- Uploads over 4 MB need `BLOB_READ_WRITE_TOKEN`; without it the video row's hint is `playground.refs.fileHint` with 4 MB (`mp4 · 4 MB 이하`), and a bigger file is refused with `playground.upload.blobForLarge`.
- A real submit costs money and takes minutes; Higgsfield gives no ETA, the turn shows elapsed time. Cancel (`playground.actions.cancel`) only shows while the row is waiting to submit or queued.
- The price hint reads `playground.rateUnset` (단가 미설정) and the estimate `playground.cost.unset` (미정) until an admin enters a rate; that is expected, not a defect.
- The poll backoff adds up to 500 ms of random jitter per tick and the next tick is scheduled only after the previous responses arrive, so observed gaps run longer than 2000, 3000, 4500, 6750, 10000 ms; judge the shape, not exact values.
- A `[목업] 생성 중` row never completes. Clear it with `npm run db:mock -- --clear` when done, or every later playground run keeps polling it.
- The page polls the live rows of every thread it has shown, including rows another tab of the same member submitted into them. A live row with a request id makes the server call Higgsfield on each poll, and when that call fails the poll is a 500 and `pg-poll` fails. The failure names the id; check whose row it is before blaming the polling path.
- Run this against a local database. The production cron sweeps live rows with real Higgsfield and each owner's key, and a `pg-generate-modes` row left live (a run killed midway) gets status calls that a fake key turns into 401s.
