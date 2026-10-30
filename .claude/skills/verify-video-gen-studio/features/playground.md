# Playground

The playground is where a member writes a prompt, optionally attaches reference images or videos, picks Seedance 2.0 or MiniMax H3, sees which generation mode will run and the estimated cost, and submits a generation whose progress and result appear on the stage feed.

Every handle below is a message key that the journey reads with `ev.t`, so the recipe runs in Korean, English and Chinese. The Korean text follows in parentheses. Model names, ratios such as `9:16`, resolutions and the `—` placeholder are the same in every language.

## Sub-features

- `pg-drawer` the `playground.drawer` drawer (생성 설정) renders prompt, references (marked `playground.refs.optional`, 선택), generation mode, model, aspect, parameters, cost bar, and the `playground.generate` button (생성하기).
- `pg-model-select` the `playground.model` native select (모델) lists exactly the enabled catalog models, Seedance 2.0 · ByteDance and MiniMax H3 · MiniMax, with the rate (`prices.rate`) when one is set. Hailuo is never offered.
- `pg-mode` list `playground.modes` (생성 방식) shows `mode.t2v`, `mode.i2v`, `mode.r2v` (텍스트→영상, 이미지→영상, 레퍼런스→영상); the current one carries `aria-current`. Nothing attached reads `mode.t2v`, any reference reads `mode.r2v`, and exactly one image with no video offers checkbox `playground.startFromImage` (이 이미지로 시작), which switches to `mode.i2v`. The sentence under the list is `playground.modeSentence.*`, whose `refs` select picks the particle (`이미지 2장과 영상 1개를`).
- `pg-prompt` typing shows a live character count, `playground.promptLength` (`23자`).
- `pg-aspect-pills` Seedance exposes group `playground.aspect.label` (출력 화면비) as pills named `playground.aspect.pill` (`세로 9:16`); exactly one is `aria-pressed`, and the hint reads `generation.shape` (가로/세로/정사각). Seedance image-to-video has no pills (the frame follows the image), and the note under one image reads `playground.aspect.firstFrameNote` (`정사각으로` for a square image).
- `pg-model-switch` MiniMax H3 shows pills starting on `playground.aspect.auto` (자동), offers `params.duration` (길이(초)) 5 | 10 | 15, has no `params.resolution` (해상도), and shows `families.h3.note` about the fixed 2K output. Switching models keeps the references.
- `pg-refs-dialog` the `playground.refs.add` button (레퍼런스 추가) opens dialog `playground.refs.add`, which reads `playground.refs.note` (references are optional) above image and video drop zones; picking a file uploads (with a key) or explains why not; a video shows its length; Esc closes and focus returns.
- `pg-blocker` when the request cannot go (H3 without a prompt, more images than the model takes) the cost bar says why in a `role=status` line (`errors.promptRequired`, `errors.tooManyImages`) and `playground.generate` is disabled.
- `pg-generate-gate` without an API key a status banner reads `errors.noKey` and `playground.generate` is disabled; with one, it submits and a queued item appears on the stage.
- `pg-generate-modes` against the fake: every model in every mode reaches its own Higgsfield endpoint with the right media fields, the counter under the rail's `playground.rail.generate` glyph (생성) equals the row's cost, and every row completes.
- `pg-stage` region `playground.stage` (결과 무대) shows one result per snap with rail glyphs `playground.rail.generate` / `playground.rail.cancel` / `generation.download` / `pages.gallery` / `playground.rail.reuse` (생성/취소/다운로드/갤러리/다시) and prev/next; captions read the model and mode (`MiniMax H3 · ` + `mode.t2v`) and mark a live row's cost `playground.feed.estimated` (예상).
- `pg-poll` while an item of a thread this tab has shown is queued or in progress (the stage's thread first, at most 24 ids), the page sends one `GET /api/generations?ids=<uuid>,<uuid>` per tick for every live item with backoff (2 s, then ×1.5 up to 10 s, ±200 ms jitter that does not compound); every poll is a 200 whose `items` contain each requested uuid, the stage shows the `playground.feed.progress` progress bar (생성 진행 중), and no poll goes out when nothing is live.

## How to get to it (user POV)

- Sign in; the app lands on `/playground`.
- Header nav `pages.playground` (플레이그라운드).
- The `playground.rail.reuse` glyph (다시) on the stage reloads a previous item's model, prompt, settings and start-from-image choice into the drawer (references are not kept).

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- At least one model is enabled in 어드민 → 모델 · 단가 (both ship enabled).
- `public/mock/ref-landscape-1.jpg`, `ref-landscape-2.jpg` and `fixtures/clip-3s.webm` (in this skill) exist (committed).
- For `pg-generate-modes`: launch the app with `HIGGSFIELD_BASE_URL` and the Blob env pointing at `npm run fake:hf` (README → 가짜 Higgsfield로 돌리기), sign in as a member whose key is fake (`VGS_USER`/`VGS_PASS`; an admin can assign `fake:key` in 어드민), and set `VGS_FAKE_HF` to the fake's base URL. Set the two models' rates in 어드민 first to check the estimate against the stored cost.
- Set `VGS_ALLOW_SPEND=1` only when a paid submit is wanted; the account then needs a Higgsfield key.
- For `pg-poll`, a live row must be on the stage's thread: `pg-generate-modes` rows count as live while they run, in the thread their first generation created. `npm run db:mock` rows (`[목업] 생성 중`, `MOCK_LIVE=3` for three) have no thread, so they sit in the earlier history and are polled only when the journey shows it. They have no request id, so no Higgsfield call ever happens for them.
- Pick the language with `VGS_LOCALE` (`ko-KR` by default, `en-US`, `zh-CN`).

- **Open drawer.** Sign in to `/playground`. Run `vgs run playground`; `01-drawer` shows the complementary region `playground.drawer`.
- **List models.** Read the `playground.model` select options; the note in `log.md` lists them (Seedance 2.0 · ByteDance, MiniMax H3 · MiniMax when both enabled).
- **Mode with nothing attached.** List `playground.modes` has `mode.t2v` as `aria-current`, and the reference counter ends with `playground.refs.optional`.
- **Type prompt.** Fill `playground.prompt`. The hint `playground.promptLength` with the prompt's length appears beside the label.
- **Pick portrait.** Select Seedance and click the pill containing `9:16` in group `playground.aspect.label`. Its `aria-pressed` is `true`, it is the only pressed pill, the hint reads `generation.shape` for portrait, and `params.resolution` offers 480p, 720p, 1080p, 4k (`02-seedance-portrait`).
- **Switch model.** Select MiniMax H3. Pill `playground.aspect.auto` is pressed, `params.duration` offers exactly `5`, `10`, `15`, there is no `params.resolution`, and `families.h3.note` is visible (`03-h3`). The journey switches back to Seedance.
- **Open references.** Click `playground.refs.add`. Dialog `playground.refs.add` shows `playground.refs.note` (`04-refs-dialog-empty`).
- **Pick an image.** Set the image file input to `public/mock/ref-landscape-1.jpg`. Either a thumbnail appears in list `playground.refs.attached` (첨부한 레퍼런스, key present) or a `role=alert` explains the refusal (no key). The note records which (`05-refs-dialog-after-pick`).
- **Close with Esc.** The dialog disappears and focus is on `playground.refs.add` again.
- **Start from the image.** With the thumbnail there, the mode reads `mode.r2v` and checkbox `playground.startFromImage` shows; checking it reads `mode.i2v` and the Seedance pills disappear (`06-start-from-image`). The journey unchecks it and removes the image with the thumbnail's one button (`playground.refs.removeLabel`); the mode reads `mode.t2v` again.
- **Generate gate.** If the `role=status` banner `errors.noKey` (`API 키가 아직 할당되지 않았습니다` in Korean) is visible, `playground.generate` is disabled. With `VGS_FAKE_HF`, the next step runs. With a key and `VGS_ALLOW_SPEND=1`, `playground.generate` is clicked and an article appears in region `playground.stage` (`generate-gate`).
- **Every mode against the fake.** For each model the journey attaches two images and the 3 s clip (refusing to click `playground.generate` unless the uploads went to `VGS_FAKE_HF`), checks `mode.r2v` and, for Seedance, `playground.fact.inputVideo` with `3.0` (`입력 영상 3.0s`) in the cost line, and generates; then one image with `playground.startFromImage` (`mode.i2v`); then nothing (`mode.t2v`). For H3 it first clears the prompt and checks the `errors.promptRequired` status line with `playground.generate` disabled (`h3-needs-prompt`). After each submit it reads the fake's `GET /_stats` `submits` for that row's Idempotency-Key: the endpoint is `…/reference-to-video`, `…/image-to-video` or `…/text-to-video`, the body has `image_urls` (2) and `video_urls` (1), `image_url`, or no media, Seedance image-to-video has no `aspect_ratio`, and the counter under the rail's `playground.rail.generate` glyph equals the row's `estimatedCostUsd`. It then waits until all six rows completed. `log.md` has one `pg-generate-modes` line per row with the body.
- **Watch the polling.** With a live row on the feed, the journey waits for two poll ticks and checks every id in every `GET /api/generations?ids=` batch it saw: the id is a live uuid from `GET /api/generations?thread=<the URL's thread>&limit=12` or one this run submitted, the status is 200, and the id is among the returned `items`. `log.md` gets `poll requests N, all 200` and the tick gaps; `poll.json` keeps every request. Without a live row it records `poll requests 0`. `poll` shows the stage with the request log overlaid by the harness. `VGS_POLL_WAIT_MS=30000` holds the page for 30 s so the backoff gaps can be read; `VGS_POLL_NAV=1` leaves for `pages.gallery` and comes back with Back (the header's `pages.playground` link would open a new thread), and the note records that no poll went out while away and how soon the first poll came back.
- **Proof.** `result.json` `ok: true`; `02-seedance-portrait.aria.txt` shows one pressed pill; `06-start-from-image.aria.txt` shows `mode.i2v` current; six `pg-generate-modes` lines with the bodies; `log.md` has `poll requests N, all 200` (or `poll requests 0` when nothing is live).

## Gotchas

- In English and Chinese the rail glyph `playground.rail.generate` and the drawer button `playground.generate` share a name (`Generate`, `生成`). Look the glyph up inside region `playground.stage` and the button inside the drawer, both with `exact: true`.
- Changing the model resets parameters to that model's defaults and keeps the references. MiniMax H3 takes 5 images, Seedance 6; over the limit the cost bar says so and `playground.generate` stays off.
- `playground.startFromImage` shows only for exactly one image and no video. Its choice is remembered while hidden, so removing a second image brings `mode.i2v` back.
- The picker only takes `video/mp4`, and a video whose length the browser cannot read is refused before upload (`playground.upload.noLength`). The fixture is a VP9 clip handed to the picker as an mp4; Chromium reads its length, the fake stores any bytes, and real Higgsfield needs a real mp4.
- Uploads over 4 MB need `BLOB_READ_WRITE_TOKEN`; without it the video drop zone's hint is `playground.refs.fileHint` with 4 MB (`mp4 · 4 MB 이하`), and a bigger file is refused with `playground.upload.blobForLarge`.
- A real submit costs money and takes minutes; Higgsfield gives no ETA, the rail shows elapsed time. Cancel (`playground.rail.cancel`) only works while the item is `queued`.
- The price hint reads `playground.rateUnset` (단가 미설정) and the cost bar `playground.cost.unset` (미정) until an admin enters a rate; that is expected, not a defect.
- On the 390px layout the stage is above the drawer; the empty state offers `playground.empty.toSettings` (생성 설정으로 이동), which scrolls to the drawer by its id `generation-settings`.
- The poll backoff adds up to 500 ms of random jitter per tick and the next tick is scheduled only after the previous responses arrive, so observed gaps run longer than 2000, 3000, 4500, 6750, 10000 ms; judge the shape, not exact values.
- A `[목업] 생성 중` row never completes. Clear it with `npm run db:mock -- --clear` when done, or every later playground run keeps polling it.
- The page polls the live rows of every thread it has shown, including rows another tab of the same member submitted into them. A live row with a request id makes the server call Higgsfield on each poll, and when that call fails the poll is a 500 and `pg-poll` fails. The failure names the id; check whose row it is before blaming the polling path.
- The database is production's, and its cron sweeps live rows with real Higgsfield and each owner's key. A `pg-generate-modes` row left live (a run killed midway) gets status calls that a fake key turns into 401s; delete the run's rows afterwards.
