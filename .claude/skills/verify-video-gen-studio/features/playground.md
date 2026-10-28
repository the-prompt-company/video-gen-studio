# Playground

The playground is where a member writes a prompt, attaches reference images or videos, picks a model and output aspect, sees the estimated cost, and submits a generation whose progress and result appear on the stage feed.

## Sub-features

- `pg-drawer` the 생성 설정 drawer renders prompt, references, model, aspect, parameters, cost bar, and 생성하기.
- `pg-model-select` the 모델 native select lists the enabled catalog models with vendor and price.
- `pg-prompt` typing shows a live character count hint.
- `pg-aspect-pills` Seedance exposes 출력 화면비 as pills; exactly one is `aria-pressed`, and the hint reads 가로/세로/정사각.
- `pg-model-switch` switching to Hailuo removes the pills, shows the fixed-768p note, and offers 길이(초) 6 | 10.
- `pg-refs-dialog` 레퍼런스 추가 opens a modal with image/video drop zones; picking a file uploads (with a key) or explains why not; Esc closes and focus returns.
- `pg-generate-gate` without an API key a status banner shows and 생성하기 is disabled; with one, 생성하기 submits and a queued item appears on the stage.
- `pg-stage` results snap one per viewport with rail glyphs 생성/취소/다운로드/갤러리/다시 and prev/next.
- `pg-poll` while an item on the feed is 대기 or 생성 중, the page polls `GET /api/generations/<its uuid>` with backoff (2 s, then ×1.5 up to 10 s, plus jitter); every poll is a 200 whose `item.id` is that uuid, the stage shows the 생성 진행 중 progress bar, and no poll goes out when nothing is live.

## How to get to it (user POV)

- Sign in; the app lands on `/playground`.
- Header nav 플레이그라운드.
- The 다시 glyph on the stage reloads a previous item's prompt and settings into the drawer.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- At least one model is enabled in 어드민 → 모델 · 단가 (both ship enabled).
- `public/mock/ref-landscape-1.jpg` exists (committed).
- Set `VGS_ALLOW_SPEND=1` only when a paid submit is wanted; the account then needs a Higgsfield key.
- For `pg-poll`, a live row must exist for the account: `npm run db:mock` inserts one `[목업] 생성 중` row (`MOCK_LIVE=3` inserts three). It has no request id, so no Higgsfield call ever happens for it.

- **Open drawer.** Sign in to `/playground`. Run `vgs run playground`; `01-drawer` shows the complementary region 생성 설정.
- **List models.** Read the 모델 select options; the note in `log.md` lists them (Seedance 2.0 · ByteDance, Hailuo 2.3 Standard · MiniMax when both enabled).
- **Type prompt.** Fill 프롬프트. A hint ending in `자` appears beside the label.
- **Pick portrait.** Select Seedance and click the pill containing `9:16` in group 출력 화면비. Its `aria-pressed` is `true` and it is the only pressed pill (`02-seedance-portrait`).
- **Switch model.** Select Hailuo. The 출력 화면비 group is gone, 길이(초) offers exactly `6` and `10`, and a note mentioning `768p` is visible (`03-hailuo`).
- **Open references.** Click 레퍼런스 추가. Dialog 레퍼런스 추가 is visible (`04-refs-dialog-empty`).
- **Pick an image.** Set the image file input to `public/mock/ref-landscape-1.jpg`. Either a thumbnail appears in list 첨부한 레퍼런스 (key present) or a `role=alert` explains the refusal (no key). The note records which (`05-refs-dialog-after-pick`).
- **Close with Esc.** The dialog disappears and focus is on 레퍼런스 추가 again.
- **Generate gate.** If the `role=status` banner (`API 키가 아직 할당되지 않았습니다`) is visible, 생성하기 is disabled. With a key and `VGS_ALLOW_SPEND=1`, 생성하기 is clicked and an article appears in region 결과 무대 (`06-generate-gate`).
- **Watch the polling.** With a `[목업] 생성 중` row on the feed, the journey waits for two poll ticks and checks every `GET /api/generations/<id>` it saw: the id is a live uuid from `GET /api/generations?limit=12`, the status is 200, and the body's `item.id` equals the path id. `log.md` gets `poll requests N, all 200` and the tick gaps; `poll.json` keeps every request. Without a live row it records `poll requests 0`. `07-poll` shows the stage with the request log overlaid by the harness. `VGS_POLL_WAIT_MS=30000` holds the page for 30 s so the backoff gaps can be read; `VGS_POLL_NAV=1` leaves for 갤러리 and returns, and the note records that no poll went out while away and how soon the first poll came back.
- **Proof.** `result.json` `ok: true`; `02-seedance-portrait.aria.txt` shows one pressed pill; `05-*.aria.txt` shows the thumbnail or the alert text; `log.md` has `poll requests N, all 200` (or `poll requests 0` when nothing is live).

## Gotchas

- Changing the model resets parameters **and clears attached references**. Attach references after choosing the model.
- Hailuo has no aspect option; its output follows the first image's ratio, so a landscape result needs a landscape image.
- Uploads over 4 MB need `BLOB_READ_WRITE_TOKEN`; without it the dialog hint says `4 MB 이하`.
- A real 생성하기 costs money and takes minutes; Higgsfield gives no ETA, the rail shows elapsed time. Cancel (취소) only works while the item is `queued`.
- The price hint reads `단가 미설정` and the cost bar `미정` until an admin enters a price; that is expected, not a defect.
- On the 390px layout the stage is above the drawer; the empty state offers 생성 설정으로 이동 to scroll down.
- The poll backoff adds up to 500 ms of random jitter per tick and the next tick is scheduled only after the previous responses arrive, so observed gaps run longer than 2000, 3000, 4500, 6750, 10000 ms; judge the shape, not exact values.
- A `[목업] 생성 중` row never completes. Clear it with `npm run db:mock -- --clear` when done, or every later playground run keeps polling it.
- The page polls every live row of the account, including rows another lane or person submitted. A live row with a request id makes the server call Higgsfield on each poll, and when that call fails the poll is a 500 and `pg-poll` fails. The failure names the id; check whose row it is before blaming the polling path.
