# Playground

The playground is where a member writes a prompt, optionally attaches reference images or videos, picks Seedance 2.0 or MiniMax H3, sees which generation mode will run and the estimated cost, and submits a generation whose progress and result appear on the stage feed.

## Sub-features

- `pg-drawer` the 생성 설정 drawer renders prompt, references (marked 선택), generation mode, model, aspect, parameters, cost bar, and 생성하기.
- `pg-model-select` the 모델 native select lists exactly the enabled catalog models, Seedance 2.0 · ByteDance and MiniMax H3 · MiniMax, with the rate when one is set. Hailuo is never offered.
- `pg-mode` list 생성 방식 shows 텍스트→영상, 이미지→영상, 레퍼런스→영상; the current one carries `aria-current`. Nothing attached reads 텍스트→영상, any reference reads 레퍼런스→영상, and exactly one image with no video offers checkbox 이 이미지로 시작, which switches to 이미지→영상.
- `pg-prompt` typing shows a live character count hint.
- `pg-aspect-pills` Seedance exposes 출력 화면비 as pills; exactly one is `aria-pressed`, and the hint reads 가로/세로/정사각. Seedance 이미지→영상 has no pills (the frame follows the image).
- `pg-model-switch` MiniMax H3 shows pills starting on 자동, offers 길이(초) 5 | 10 | 15, has no 해상도, and notes the fixed 2K output. Switching models keeps the references.
- `pg-refs-dialog` 레퍼런스 추가 opens a modal that says references are optional, with image/video drop zones; picking a file uploads (with a key) or explains why not; a video shows its length; Esc closes and focus returns.
- `pg-blocker` when the request cannot go (H3 without a prompt, more images than the model takes) the cost bar says why in a `role=status` line and 생성하기 is disabled.
- `pg-generate-gate` without an API key a status banner shows and 생성하기 is disabled; with one, 생성하기 submits and a queued item appears on the stage.
- `pg-generate-modes` against the fake: every model in every mode reaches its own Higgsfield endpoint with the right media fields, the 생성 counter equals the row's cost, and every row completes.
- `pg-stage` results snap one per viewport with rail glyphs 생성/취소/다운로드/갤러리/다시 and prev/next; captions read the model and mode ("MiniMax H3 · 텍스트→영상") and mark a live row's cost 예상.
- `pg-poll` while an item on the feed is 대기 or 생성 중, the page sends one `GET /api/generations?ids=<uuid>,<uuid>` per tick for every live item with backoff (2 s, then ×1.5 up to 10 s, ±200 ms jitter that does not compound); every poll is a 200 whose `items` contain each requested uuid, the stage shows the 생성 진행 중 progress bar, and no poll goes out when nothing is live.

## How to get to it (user POV)

- Sign in; the app lands on `/playground`.
- Header nav 플레이그라운드.
- The 다시 glyph on the stage reloads a previous item's model, prompt, settings and 이 이미지로 시작 choice into the drawer (references are not kept).

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- At least one model is enabled in 어드민 → 모델 · 단가 (both ship enabled).
- `public/mock/ref-landscape-1.jpg`, `ref-landscape-2.jpg` and `fixtures/clip-3s.webm` (in this skill) exist (committed).
- For `pg-generate-modes`: launch the app with `HIGGSFIELD_BASE_URL` and the Blob env pointing at `npm run fake:hf` (README → 가짜 Higgsfield로 돌리기), sign in as a member whose key is fake (`VGS_USER`/`VGS_PASS`; an admin can assign `fake:key` in 어드민), and set `VGS_FAKE_HF` to the fake's base URL. Set the two models' rates in 어드민 first to check the estimate against the stored cost.
- Set `VGS_ALLOW_SPEND=1` only when a paid submit is wanted; the account then needs a Higgsfield key.
- For `pg-poll`, a live row must exist for the account: `npm run db:mock` inserts one `[목업] 생성 중` row (`MOCK_LIVE=3` inserts three). It has no request id, so no Higgsfield call ever happens for it. `pg-generate-modes` rows count as live while they run.

- **Open drawer.** Sign in to `/playground`. Run `vgs run playground`; `01-drawer` shows the complementary region 생성 설정.
- **List models.** Read the 모델 select options; the note in `log.md` lists them (Seedance 2.0 · ByteDance, MiniMax H3 · MiniMax when both enabled).
- **Mode with nothing attached.** List 생성 방식 has 텍스트→영상 as `aria-current`, and the reference counter ends with 선택.
- **Type prompt.** Fill 프롬프트. A hint ending in `자` appears beside the label.
- **Pick portrait.** Select Seedance and click the pill containing `9:16` in group 출력 화면비. Its `aria-pressed` is `true` and it is the only pressed pill; 해상도 offers 480p, 720p, 1080p, 4k (`02-seedance-portrait`).
- **Switch model.** Select MiniMax H3. Pill 자동 is pressed, 길이(초) offers exactly `5`, `10`, `15`, there is no 해상도, and a note mentioning `2K로 고정` is visible (`03-h3`). The journey switches back to Seedance.
- **Open references.** Click 레퍼런스 추가. Dialog 레퍼런스 추가 says 레퍼런스는 선택입니다 (`04-refs-dialog-empty`).
- **Pick an image.** Set the image file input to `public/mock/ref-landscape-1.jpg`. Either a thumbnail appears in list 첨부한 레퍼런스 (key present) or a `role=alert` explains the refusal (no key). The note records which (`05-refs-dialog-after-pick`).
- **Close with Esc.** The dialog disappears and focus is on 레퍼런스 추가 again.
- **Start from the image.** With the thumbnail there, the mode reads 레퍼런스→영상 and checkbox 이 이미지로 시작 shows; checking it reads 이미지→영상 and the Seedance pills disappear (`06-start-from-image`). The journey unchecks it and removes the image; the mode reads 텍스트→영상 again.
- **Generate gate.** If the `role=status` banner (`errors.noKey`, `API 키가 아직 할당되지 않았습니다` in Korean) is visible, 생성하기 is disabled. With `VGS_FAKE_HF`, the next step runs. With a key and `VGS_ALLOW_SPEND=1`, 생성하기 is clicked and an article appears in region 결과 무대 (`generate-gate`).
- **Every mode against the fake.** For each model the journey attaches two images and the 3 s clip (refusing to click 생성하기 unless the uploads went to `VGS_FAKE_HF`), checks 레퍼런스→영상 and, for Seedance, `입력 영상 3.0s` in the cost line, and generates; then one image with 이 이미지로 시작 (이미지→영상); then nothing (텍스트→영상). For H3 it first clears the prompt and checks the `프롬프트가 필요합니다` status line with 생성하기 disabled (`h3-needs-prompt`). After each 생성하기 it reads the fake's `GET /_stats` `submits` for that row's Idempotency-Key: the endpoint is `…/reference-to-video`, `…/image-to-video` or `…/text-to-video`, the body has `image_urls` (2) and `video_urls` (1), `image_url`, or no media, Seedance image-to-video has no `aspect_ratio`, and the 생성 counter equals the row's `estimatedCostUsd`. It then waits until all six rows completed. `log.md` has one `pg-generate-modes` line per row with the body.
- **Watch the polling.** With a live row on the feed, the journey waits for two poll ticks and checks every id in every `GET /api/generations?ids=` batch it saw: the id is a live uuid from `GET /api/generations?limit=12` or one this run submitted, the status is 200, and the id is among the returned `items`. `log.md` gets `poll requests N, all 200` and the tick gaps; `poll.json` keeps every request. Without a live row it records `poll requests 0`. `poll` shows the stage with the request log overlaid by the harness. `VGS_POLL_WAIT_MS=30000` holds the page for 30 s so the backoff gaps can be read; `VGS_POLL_NAV=1` leaves for 갤러리 and returns, and the note records that no poll went out while away and how soon the first poll came back.
- **Proof.** `result.json` `ok: true`; `02-seedance-portrait.aria.txt` shows one pressed pill; `06-start-from-image.aria.txt` shows 이미지→영상 current; six `pg-generate-modes` lines with the bodies; `log.md` has `poll requests N, all 200` (or `poll requests 0` when nothing is live).

## Gotchas

- Changing the model resets parameters to that model's defaults and keeps the references. MiniMax H3 takes 5 images, Seedance 6; over the limit the cost bar says so and 생성하기 stays off.
- 이 이미지로 시작 shows only for exactly one image and no video. Its choice is remembered while hidden, so removing a second image brings 이미지→영상 back.
- The picker only takes `video/mp4`, and a video whose length the browser cannot read is refused before upload. The fixture is a VP9 clip handed to the picker as an mp4; Chromium reads its length, the fake stores any bytes, and real Higgsfield needs a real mp4.
- Uploads over 4 MB need `BLOB_READ_WRITE_TOKEN`; without it the dialog hint says `4 MB 이하`.
- A real 생성하기 costs money and takes minutes; Higgsfield gives no ETA, the rail shows elapsed time. Cancel (취소) only works while the item is `queued`.
- The price hint reads `단가 미설정` and the cost bar `미정` until an admin enters a rate; that is expected, not a defect.
- On the 390px layout the stage is above the drawer; the empty state offers 생성 설정으로 이동 to scroll down.
- The poll backoff adds up to 500 ms of random jitter per tick and the next tick is scheduled only after the previous responses arrive, so observed gaps run longer than 2000, 3000, 4500, 6750, 10000 ms; judge the shape, not exact values.
- A `[목업] 생성 중` row never completes. Clear it with `npm run db:mock -- --clear` when done, or every later playground run keeps polling it.
- The page polls every live row of the account, including rows another lane or person submitted. A live row with a request id makes the server call Higgsfield on each poll, and when that call fails the poll is a 500 and `pg-poll` fails. The failure names the id; check whose row it is before blaming the polling path.
- The database is production's, and its cron sweeps live rows with real Higgsfield and each owner's key. A `pg-generate-modes` row left live (a run killed midway) gets status calls that a fake key turns into 401s; delete the run's rows afterwards.
