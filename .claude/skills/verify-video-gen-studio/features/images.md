# Images

A member picks GPT Image 2 from the image group of the model select, writes a prompt, optionally attaches reference images, sees the estimated cost, and generates; the image appears on the stage, downloads in its format, and shows in the gallery and dashboard. The server's shared `OPENAI_API_KEY` pays, so a member needs no Higgsfield key, and without that key the model is listed as `playground.unavailable` (사용 불가).

The journey finds every element by message key with `ev.t`, as in [Playground](./playground.md), so it runs in every language. The Korean text follows in parentheses.

## Sub-features

- `img-model-groups` the `playground.model` select (모델) groups its options under `playground.output` for video and image (영상, 이미지); GPT Image 2 · OpenAI sits in the image group.
- `img-no-key` without `OPENAI_API_KEY` on the server, the option reads `… · ` + `playground.unavailable` and is disabled, a `role=status` line reads `errors.noOpenAiKey` (it names `OPENAI_API_KEY`), and `POST /api/generations` for it answers 503.
- `img-drawer` GPT Image 2 lists the modes `mode.t2i` and `mode.r2i` (텍스트→이미지, 레퍼런스→이미지), the aspect pills `playground.aspect.pill` for 1:1 square, 3:2 landscape, 2:3 portrait, 16:9 landscape and 9:16 portrait (정사각 1:1, 가로 3:2, 세로 2:3, 가로 16:9, 세로 9:16), and the selects `params.quality`, `params.output_format`, `params.background` (품질, 파일 형식, 배경) whose options read `paramValues.<key>`; the reference counter has no video part (`playground.refs.videoCount`).
- `img-estimate` the cost bar shows a `$0.xxxx` estimate before submit, and it equals the row's `estimatedCostUsd`.
- `img-t2i` with nothing attached, `playground.generate` (생성하기) answers 201 with an in-progress row; the stage shows `playground.feed.imageNote` (OpenAI is making it), then the image `generation.image`; the fake got exactly one `images/generations` request; the `generation.download` glyph (다운로드) reads PNG and serves an attachment.
- `img-r2i` two references upload browser → Blob, the mode reads `mode.r2i` with `playground.modeSentence.edit`, and generating sends one `images/edits` request whose `images` are the two Blob URLs, at 1536x864 for 16:9; a JPEG choice yields a JPEG download.
- `img-gallery` the gallery tile `gallery.openDetail` holds an `<img>`, the detail dialog `gallery.detail.title` (생성 상세) shows the stored image, `gallery.retention.permanent` (영구), and the same download link.
- `img-dashboard` the per-model card (모델별) lists GPT Image 2 and the recent table reads `GPT Image 2 · ` + `mode.t2i` with length `—`.

## How to get to it (user POV)

- Sign in; `/playground`; `playground.model` → GPT Image 2.
- Header nav `pages.gallery` and `pages.dashboard` for the results.

## Driving it with vgs

Preconditions:

- The app talks to `npm run fake:hf` for both providers and storage: `HIGGSFIELD_BASE_URL`, `OPENAI_BASE_URL=<fake>/openai/v1`, `OPENAI_API_KEY` (any value), `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fake_fake`, `VERCEL_BLOB_API_URL`, `BLOB_PUBLIC_BASE_URL` and `NEXT_PUBLIC_VERCEL_BLOB_API_URL` set to the fake (README → 가짜 Higgsfield로 돌리기). `VGS_FAKE_HF` names the fake's base URL.
- The database is a disposable local one: this journey creates generation rows, and the production cron would take rows left in the shared database.
- For `img-no-key`, launch the app without `OPENAI_API_KEY`; the journey then proves the disabled state and stops.
- Pick the language with `VGS_LOCALE`. The gallery and dashboard steps pass in English and Chinese once those pages are translated.

- **Model groups.** `vgs run images` signs in and reads the select's optgroups (`log.md` line `img-model-groups`).
- **Drawer.** It picks GPT Image 2 and checks the modes, pills and selects (`01-image-drawer`).
- **Generate.** It types a prompt, records the estimate and clicks `playground.generate` inside the drawer; the stage shows the running row (`image-t2i-running`) and then the image (`image-t2i-done`); the fake's `GET /_stats` `openai.requests` shows one request for that prompt.
- **Edit.** It attaches `public/mock/ref-landscape-1.jpg` and `-2.jpg` through `playground.drop.add` for images (`image-refs-dialog`), checks the mode sentence, picks the 16:9 landscape pill and JPEG, and generates (`image-r2i-done`).
- **Gallery and dashboard.** It opens the tile (`gallery-image-tile`, `gallery-image-detail`) and the dashboard (`dashboard-images`).
- **Proof.** `result.json` `ok: true`, with `img-t2i` and `img-r2i` lines in `log.md` naming the request count, the image size and the recorded cost.

## Gotchas

- The fake answers after `FAKE_OPENAI_DELAY_MS` (README); a real call takes tens of seconds to two minutes and costs money.
- A real OpenAI cannot fetch references stored in the local fake Blob; image edits only run end to end against the fake or a real Blob store.
- An image row cannot be canceled, and a poll never resends it: a row whose call got no answer ends as failed with `errors.imageUnanswered` (it may have been billed), not as a second request.
- The fake draws a 96 px PNG from the prompt; the stage and gallery show that small image scaled up.
- The drawer's `playground.generate` and the rail's `playground.rail.generate` share a name in English and Chinese, so the journey clicks the one inside the drawer.
