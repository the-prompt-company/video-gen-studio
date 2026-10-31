# Images

A member picks GPT Image 2 from the image tab of the model menu, writes a prompt, optionally attaches reference images, sees the estimated cost, and generates; the image appears as a turn in the stream, downloads in its format, and shows in the gallery and dashboard. The server's shared `OPENAI_API_KEY` pays, so a member needs no Higgsfield key, and without that key the model's row reads `playground.unavailable` (사용 불가) and cannot be picked.

The journey finds every element by message key with `ev.t`, as in [Playground](./playground.md), so it runs in every language. The Korean text follows in parentheses.

## Sub-features

- `img-model-groups` dialog `playground.modelMenu` (모델) has the output tabs `playground.output` for video and image (영상, 이미지); GPT Image 2 · OpenAI sits under the image tab.
- `img-no-key` without `OPENAI_API_KEY` on the server, the row reads `playground.unavailable` with `errors.noOpenAiKey` (it names `OPENAI_API_KEY`) and is disabled, and `POST /api/generations` for it answers 503.
- `img-composer` GPT Image 2's row says it takes up to 16 images and no frames (`playground.takes`), no row names a mode, and with nothing attached the chip reads GPT Image 2 alone; its settings hold the aspect pills `playground.aspect.pill` for 1:1 square, 3:2 landscape, 2:3 portrait, 16:9 landscape and 9:16 portrait (정사각 1:1, 가로 3:2, 세로 2:3, 가로 16:9, 세로 9:16) and pill groups `params.quality`, `params.output_format`, `params.background` (품질, 파일 형식, 배경) whose pills read `paramValues.<key>`; the add menu has no video row.
- `img-estimate` the composer shows a `$0.xxxx` estimate before submit, and it equals the row's `estimatedCostUsd`.
- `img-t2i` in text mode, `playground.generate` (생성하기) answers 201 with an in-progress row; its turn shows `playground.feed.imageNote` (OpenAI is making it), then the image `generation.image`; the fake got exactly one `images/generations` request; the turn's `generation.download` link (다운로드) reads PNG and serves an attachment.
- `img-r2i` two references upload browser → Blob, the line under them reads `mode.r2i` and neither image offers a frame menu, and generating sends one `images/edits` request whose `images` are the two Blob URLs, at 1536x864 for 16:9; a JPEG pick yields a JPEG download.
- `img-gallery` the gallery tile `gallery.openDetail` holds an `<img>`, the detail dialog `gallery.detail.title` (생성 상세) shows the stored image, `gallery.retention.permanent` (영구), and the same download link.
- `img-dashboard` the per-model card (모델별) lists GPT Image 2 and the recent table reads `GPT Image 2 · ` + `mode.t2i` with length `—`.

## How to get to it (user POV)

- Sign in; `/playground`; the model chip → 이미지 → GPT Image 2.
- Header nav `pages.gallery` and `pages.dashboard` for the results.

## Driving it with vgs

Preconditions:

- The app talks to `npm run fake:hf` for both providers and storage: `HIGGSFIELD_BASE_URL`, `OPENAI_BASE_URL=<fake>/openai/v1`, `OPENAI_API_KEY` (any value), `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fake_fake`, `VERCEL_BLOB_API_URL`, `BLOB_PUBLIC_BASE_URL` and `NEXT_PUBLIC_VERCEL_BLOB_API_URL` set to the fake (README → 가짜 Higgsfield로 돌리기). `VGS_FAKE_HF` names the fake's base URL.
- The database is a disposable local one: this journey creates generation rows, and the production cron would take rows left in the shared database.
- For `img-no-key`, launch the app without `OPENAI_API_KEY`; the journey then proves the disabled state and stops.
- Pick the language with `VGS_LOCALE`.

- **Model menu.** `vgs run images` signs in, opens the model menu's image tab and picks GPT Image 2 (`log.md` line `img-model-groups`).
- **Composer.** It checks the modes, the pills and the add menu, types a prompt and records the estimate (`image-composer`).
- **Generate.** It clicks `playground.generate`; the turn shows the running row (`image-t2i-running`) and then the image (`image-t2i-done`); the fake's `GET /_stats` `openai.requests` shows one request for that prompt.
- **Edit.** It attaches `public/mock/ref-landscape-1.jpg` and `-2.jpg` through the composer's image input (`image-refs`), picks the 16:9 landscape pill and JPEG, and generates (`image-r2i-done`).
- **Gallery and dashboard.** It opens the tile (`gallery-image-tile`, `gallery-image-detail`) and the dashboard (`dashboard-images`).
- **Proof.** `result.json` `ok: true`, with `img-t2i` and `img-r2i` lines in `log.md` naming the request count, the image size and the recorded cost.

## Gotchas

- The fake answers after `FAKE_OPENAI_DELAY_MS` (README); a real call takes tens of seconds to two minutes and costs money.
- A real OpenAI cannot fetch references stored in the local fake Blob; image edits only run end to end against the fake or a real Blob store.
- An image row cannot be canceled, and a poll never resends it: a row whose call got no answer ends as failed with `errors.imageUnanswered` (it may have been billed), not as a second request.
- The fake draws a 96 px PNG from the prompt; the stream and gallery show that small image scaled up.
